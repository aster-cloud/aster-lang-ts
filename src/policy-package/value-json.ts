/**
 * 值规范 JSON（ADR 0059 修订 1 A1、修订 2 R9；规则见 aster-lang-test `conformance/package-v1/VALUE-FORMS.md`）。
 *
 * `run` 信封里的 `value` 与 probes 的比较都用它。分两步：
 *   1. {@link guestToTree}：ts 解释器的运行时值 → 与平台 `/evaluate-json` 的 `result` 同一棵树
 *      （Long 为 bigint、Decimal 为普通十进制字符串、Enum 删去 ts 多出的 `"__type":"?"`）；
 *   2. {@link valueJson}：树 → 字节。对象键按 Unicode 码点升序；无空白；字符串按 RFC 8785 §3.2.2.2 转义；
 *      整数（含 Long，不限 2⁵³）精确十进制；非整数 Double 按 ECMAScript `Number::toString`（RFC 8785 §3.2.2.3）；
 *      `-0` 输出 `0`；NaN / ±Infinity、孤立代理项、嵌套超过 64 层都失败（CLI 报 `EVAL_ERROR`）。
 * 不用空 TypeContext 的 `canonicalJson`：它拒绝非整数与超出 ±(2⁵³−1) 的整数（P0 结果 §3）。
 */
import Decimal from 'decimal.js';
import { compareByCodePoint } from '../core/canonical-json.js';
import { hasLoneSurrogate } from './strict-json.js';

export class ValueJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueJsonError';
  }
}

/** 值的最大嵌套层级：顶层为第 0 层，任何值位于第 65 层及更深即失败（与 `serializeGuestValue` 的上限相同）。 */
export const MAX_VALUE_LEVEL = 64;

/** 值树：整数为 bigint，非整数为 number（向量与 probes 的无损读取结果也是这种形态）。 */
export type ValueTree = null | boolean | number | bigint | string | ValueTree[] | { [key: string]: ValueTree };

function stringLiteral(s: string): string {
  if (hasLoneSurrogate(s)) throw new ValueJsonError('字符串含孤立代理项');
  return JSON.stringify(s);
}

/** 值树 → 值规范 JSON 文本。 */
export function valueJson(value: ValueTree, level = 0): string {
  if (level > MAX_VALUE_LEVEL) throw new ValueJsonError(`值嵌套超过 ${MAX_VALUE_LEVEL} 层`);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return value.toString();
    case 'number':
      if (!Number.isFinite(value)) throw new ValueJsonError(`值中不得出现 ${value}`);
      // ECMAScript Number::toString 即 RFC 8785 §3.2.2.3；String(-0) === "0"
      return String(value);
    case 'string':
      return stringLiteral(value);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map((v) => valueJson(v, level + 1)).join(',')}]`;
  const keys = Object.keys(value).sort(compareByCodePoint);
  return `{${keys.map((k) => `${stringLiteral(k)}:${valueJson(value[k]!, level + 1)}`).join(',')}}`;
}

/** Decimal → 普通十进制写法：无指数、去掉小数部分末尾的 0、整数值不带小数点、零为 `"0"`。 */
function decimalString(d: Decimal): string {
  if (!d.isFinite()) throw new ValueJsonError(`Decimal 值中不得出现 ${d.toString()}`);
  return d.isZero() ? '0' : d.toFixed();
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * 解释器运行时值 → 值树（与 `serializeGuestValue` 同一遍历口径：Map 按条目、数组保序、
 * struct 取自有可枚举键并跳过 undefined；另删去 `"__type":"?"`）。函数值、类实例等非数据值失败。
 * 层级上限在这里同样执行，防止环形结构无限递归。
 */
export function guestToTree(v: unknown, level = 0): ValueTree {
  if (level > MAX_VALUE_LEVEL) throw new ValueJsonError(`值嵌套超过 ${MAX_VALUE_LEVEL} 层`);
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'boolean':
    case 'string':
    case 'bigint':
      return v;
    case 'number':
      if (!Number.isFinite(v)) throw new ValueJsonError(`值中不得出现 ${v}`);
      return v;
    case 'object':
      break;
    default:
      throw new ValueJsonError(`不是数据值：${typeof v}`);
  }
  if (v instanceof Decimal) return decimalString(v);
  if (Array.isArray(v)) return v.map((x) => guestToTree(x, level + 1));
  const out: { [key: string]: ValueTree } = {};
  const put = (k: string, x: unknown): void => {
    Object.defineProperty(out, k, { value: guestToTree(x, level + 1), enumerable: true, writable: true, configurable: true });
  };
  if (v instanceof Map) {
    for (const [k, x] of v) put(String(k), x);
    return out;
  }
  if (!isPlainObject(v)) throw new ValueJsonError(`不是数据值：${Object.prototype.toString.call(v)}`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) continue;
    if (k === '__type' && o[k] === '?') continue;
    put(k, o[k]);
  }
  return out;
}

/** 解释器运行时值 → 值规范 JSON 文本。 */
export function toValueJson(value: unknown): string {
  return valueJson(guestToTree(value));
}

