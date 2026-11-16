/**
 * `--input` 校验与宿主值转换（README「输入」，ADR 0059 修订 1 A1、修订 2 R7）。
 *
 * 判定（任一不满足即 `INPUT_INVALID`）：
 *   1. 字节 ≤ 16 MiB；严格 JSON（嵌套深度 ≤ 64，整数 token 无损读成 bigint）；
 *   2. 顶层是对象，键**恰为**入口的全部形参名（逐字节；0 参入口只接受 `{}`）；
 *   3. 每个形参按 Core IR 类型逐层校验：Int 为 int32 整数 token；Long 为安全整数 token 或 int64 十进制字符串；
 *      Double 为任意有限数字；Decimal 为至多 80 位数字的十进制字符串；List / Map / Maybe（`null` 为 None）/
 *      无载荷 Enum（变体名）/ Data（全部字段必填、无多余字段）。Result、函数类型等不能作为输入。
 * 与参照实现 `scripts/lib/package-v1/input.mjs` 同一判定。校验通过的树再由 {@link toGuestContext} 转成解释器的宿主值。
 */
import Decimal from 'decimal.js';
import { fail } from './errors.js';
import { MAX_INPUT_BYTES } from './paths.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';

/** 输入允许的最大嵌套层数。 */
export const MAX_INPUT_DEPTH = 64;
/** Decimal 字符串的最大数字位数（不计符号与小数点），与 decimal.js `precision: 80` 一致。 */
export const DECIMAL_MAX_DIGITS = 80;

const INT32_MIN = -2147483648n;
const INT32_MAX = 2147483647n;
const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?(?![\s\S])/;
const LONG_STRING = /^-?(0|[1-9][0-9]{0,18})(?![\s\S])/;

/** IR 中输入校验关心的最小结构（直接读取 Core IR v2 JSON 树）。 */
interface IrTypeNode {
  readonly kind: string;
  readonly name?: string;
  readonly type?: IrTypeNode;
  readonly val?: IrTypeNode;
}
interface IrDeclNode {
  readonly kind: string;
  readonly name: string;
  readonly params?: readonly { readonly name: string; readonly type: IrTypeNode }[];
  readonly fields?: readonly { readonly name: string; readonly type: IrTypeNode }[];
  readonly variants?: readonly string[];
}
/** 输入校验与求值用到的 IR 视图。 */
export interface IrView {
  readonly decls: readonly IrDeclNode[];
}

interface TypeTables {
  readonly datas: ReadonlyMap<string, IrDeclNode>;
  readonly enums: ReadonlyMap<string, IrDeclNode>;
}

const invalid = (why: string): never => fail('input', 'INPUT_INVALID', why);

function tablesOf(ir: IrView): TypeTables {
  return {
    datas: new Map(ir.decls.filter((d) => d.kind === 'Data').map((d) => [d.name, d])),
    enums: new Map(ir.decls.filter((d) => d.kind === 'Enum').map((d) => [d.name, d])),
  };
}

/** IR 中名为 entry 的函数；不存在返回 undefined。 */
export function findFunc(ir: IrView, entry: string): IrDeclNode | undefined {
  return ir.decls.find((d) => d.kind === 'Func' && d.name === entry);
}

function checkKeys(obj: { [key: string]: JsonValue }, names: readonly string[], path: string): void {
  const keys = Object.keys(obj);
  const want = new Set(names);
  if (keys.length !== want.size || keys.some((k) => !want.has(k))) invalid(`${path}：键必须恰为 ${[...want].join(', ')}`);
}

function checkScalar(v: JsonValue, name: string, path: string): boolean {
  switch (name) {
    case 'Int':
      if (typeof v !== 'bigint') invalid(`${path}：Int 必须是整数 token`);
      if ((v as bigint) < INT32_MIN || (v as bigint) > INT32_MAX) invalid(`${path}：Int 超出 int32`);
      return true;
    case 'Long':
      if (typeof v === 'bigint') {
        if (v < -SAFE || v > SAFE) invalid(`${path}：Long 的整数 token 超出 ±(2⁵³−1)，须用十进制字符串`);
        return true;
      }
      if (typeof v !== 'string' || !LONG_STRING.test(v)) invalid(`${path}：Long 必须是安全整数 token 或十进制字符串`);
      if (BigInt(v as string) < INT64_MIN || BigInt(v as string) > INT64_MAX) invalid(`${path}：Long 超出 int64`);
      return true;
    case 'Double':
      if (typeof v !== 'bigint' && typeof v !== 'number') invalid(`${path}：Double 必须是数字`);
      if (typeof v === 'bigint' && !Number.isFinite(Number(v))) invalid(`${path}：Double 溢出`);
      return true;
    case 'Decimal':
      if (typeof v !== 'string' || !DECIMAL.test(v)) invalid(`${path}：Decimal 必须是十进制字符串`);
      if ((v as string).replace(/[-.]/g, '').length > DECIMAL_MAX_DIGITS) invalid(`${path}：Decimal 超过 ${DECIMAL_MAX_DIGITS} 位数字`);
      return true;
    case 'Text':
      if (typeof v !== 'string') invalid(`${path}：期望字符串`);
      return true;
    case 'Bool':
      if (typeof v !== 'boolean') invalid(`${path}：期望布尔`);
      return true;
    default:
      return false;
  }
}

function checkType(v: JsonValue, type: IrTypeNode, t: TypeTables, path: string): void {
  switch (type.kind) {
    case 'List':
      if (!Array.isArray(v)) return invalid(`${path}：期望数组`);
      v.forEach((x, i) => checkType(x, type.type!, t, `${path}[${i}]`));
      return;
    case 'Map':
      if (!isJsonObject(v)) return invalid(`${path}：期望对象`);
      for (const [k, x] of Object.entries(v)) checkType(x, type.val!, t, `${path}.${k}`);
      return;
    case 'Maybe':
    case 'Option':
      if (v !== null) checkType(v, type.type!, t, path);
      return;
    case 'TypeName':
      break;
    default:
      return invalid(`${path}：不支持作为输入的类型 ${type.kind}`);
  }
  const name = type.name!;
  if (checkScalar(v, name, path)) return;
  const en = t.enums.get(name);
  if (en) {
    if (typeof v !== 'string' || !en.variants!.includes(v)) invalid(`${path}：不是 ${name} 的变体名`);
    return;
  }
  const data = t.datas.get(name) ?? invalid(`${path}：未知类型 ${name}`);
  if (!isJsonObject(v)) return invalid(`${path}：期望对象`);
  const fields = data.fields ?? [];
  checkKeys(v, fields.map((f) => f.name), path);
  for (const f of fields) checkType(v[f.name]!, f.type, t, `${path}.${f.name}`);
}

/** 校验已解析的输入树（probes 的 `input` 也走这里）。entry 必须在 IR 中（调用方已判 ENTRY_NOT_FOUND）。 */
export function validateInputTree(v: JsonValue, ir: IrView, entry: string): { [key: string]: JsonValue } {
  const func = findFunc(ir, entry) ?? fail('entry', 'ENTRY_NOT_FOUND', `入口 ${entry} 不在 IR 中`);
  if (!isJsonObject(v)) return invalid('顶层必须是对象');
  const params = func.params ?? [];
  checkKeys(v, params.map((p) => p.name), '$');
  const t = tablesOf(ir);
  for (const p of params) checkType(v[p.name]!, p.type, t, `$.${p.name}`);
  return v;
}

/** 校验 `--input` 的原始字节；通过返回解析后的树（整数为 bigint）。 */
export function parseInput(bytes: Uint8Array, ir: IrView, entry: string): { [key: string]: JsonValue } {
  if (bytes.length > MAX_INPUT_BYTES) invalid('输入超过 16 MiB');
  let v: JsonValue;
  try {
    v = parseStrictJson(bytes, { maxDepth: MAX_INPUT_DEPTH, lossless: true });
  } catch (e) {
    return invalid(`不是严格 JSON：${(e as Error).message}`);
  }
  return validateInputTree(v, ir, entry);
}

/**
 * 已校验的输入树 → 解释器上下文：Decimal 字符串 → decimal.js 实例；Long → bigint；Int / Double → number；
 * List / Map / Data 递归（Data 字段按声明序）；Maybe：`null` 为 None，否则为内层值（解释器接受这两种宿主形态）；
 * Enum：变体名字符串。与 aster-lang-test 夹具复算期望值时的转换相同。
 */
export function toGuestContext(input: { [key: string]: JsonValue }, ir: IrView, entry: string): Record<string, unknown> {
  const t = tablesOf(ir);
  const conv = (v: JsonValue, type: IrTypeNode): unknown => {
    switch (type.kind) {
      case 'List':
        return (v as JsonValue[]).map((x) => conv(x, type.type!));
      case 'Map':
        return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, conv(x as JsonValue, type.val!)]));
      case 'Maybe':
      case 'Option':
        return v === null ? null : conv(v, type.type!);
      default:
        break;
    }
    switch (type.name) {
      case 'Decimal':
        return new Decimal(v as string);
      case 'Long':
        return BigInt(v as bigint | string);
      case 'Int':
      case 'Double':
        return Number(v);
      default:
        break;
    }
    const data = t.datas.get(type.name!);
    if (data) {
      const o = v as { [key: string]: JsonValue };
      return Object.fromEntries((data.fields ?? []).map((f) => [f.name, conv(o[f.name]!, f.type)]));
    }
    return v;
  };
  const func = findFunc(ir, entry)!;
  return Object.fromEntries((func.params ?? []).map((p) => [p.name, conv(input[p.name]!, p.type)]));
}
