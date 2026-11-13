/**
 * 测试专用：把手写的宽松 Core IR 字面量补成 Core IR v2 形状（ADR 0055 #19「全部恒输出」）。
 *
 * 只给单元测试手工构造 IR 用，便于沿用既有用例里「只写关心字段」的写法；产品代码没有任何 v1 读方或
 * 形状兼容（readCoreIr 严格拒收）。补齐规则与 src/core/core_ir.ts 的构造函数一致：
 * - 带 kind 的节点补 NO_ORIGIN；
 * - Func / Field / Param / Module / Import / Workflow / Step / Lambda / PatCtor 补齐恒输出字段；
 * - v1 字段改写：Import.name/asName → path/alias，PatCtor.names → args 中的 PatName，
 *   Lambda.retType → ret，效应名 IO/CPU → io/cpu（pure / async 丢弃），Double.value → 规范十进制串；
 * - 删除 v2 不存在的字段：declaredEffects、piiLevel、piiCategories。
 */
import { NO_ORIGIN } from '../../src/core/core_ir.js';
import { canonicalDecimalFromLiteral } from '../../src/core/canonical-decimal.js';

type Json = Record<string, unknown>;

const isObject = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x);

/** 把宽松字面量（任意深度）补成 v2 形状；返回 any 以便直接赋给 Core.* 类型。 */
export function toV2(node: unknown): any {
  if (Array.isArray(node)) return node.map(toV2);
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === 'origin' ? v : toV2(v);
  if (typeof out.kind === 'string') {
    out.origin ??= NO_ORIGIN;
    fillKind(out);
  }
  for (const key of ['params', 'fields'] as const) {
    if (Array.isArray(out[key]) && (out.kind === 'Func' || out.kind === 'Data' || out.kind === 'Lambda')) {
      out[key] = (out[key] as Json[]).map(fillMember);
    }
  }
  return out;
}

function fillMember(m: Json): Json {
  return { annotations: [], constraints: [], typeInferred: false, ...m };
}

function fillKind(n: Json): void {
  switch (n.kind) {
    case 'Module':
      n.schemaVersion ??= 2;
      n.name ??= null;
      n.profile ??= null;
      n.decls ??= [];
      return;
    case 'Import':
      n.path ??= n.name;
      n.alias ??= n.asName ?? null;
      n.version ??= null;
      delete n.name;
      delete n.asName;
      return;
    case 'Func': {
      const effectParams = (n.effectParams as string[] | undefined) ?? [];
      n.typeParams ??= [];
      n.params ??= [];
      n.retTypeInferred ??= false;
      n.annotations = ((n.annotations as Json[] | undefined) ?? []).map((a) => ({ args: [], ...a }));
      n.retAnnotations ??= [];
      n.effects = v2Effects((n.effects as string[] | undefined) ?? [], effectParams);
      n.effectParams = effectParams;
      n.effectCaps ??= [];
      n.effectCapsExplicit ??= false;
      n.inputRefs ??= null;
      delete n.declaredEffects;
      delete n.piiLevel;
      delete n.piiCategories;
      return;
    }
    case 'PatCtor': {
      const names = ((n.names as string[] | undefined) ?? []).map((name) => ({ kind: 'PatName', name, origin: n.origin }));
      n.args = [...names, ...((n.args as unknown[] | undefined) ?? [])];
      delete n.names;
      return;
    }
    case 'Lambda':
      n.ret ??= n.retType;
      n.captures ??= [];
      delete n.retType;
      return;
    case 'workflow':
      n.retry ??= null;
      n.timeout ??= null;
      n.effectCaps ??= [];
      return;
    case 'step':
      n.compensate ??= null;
      n.dependencies ??= [];
      n.effectCaps ??= [];
      return;
    case 'If':
      n.elseBlock ??= null;
      return;
    case 'Double':
      if (typeof n.value === 'number') n.value = canonicalDecimalFromLiteral(String(n.value));
      return;
    default:
      return;
  }
}

/**
 * v2 effects：io / cpu 改为小写，丢弃不授权的 pure / async，其余名字（效应变量，或测试故意构造的
 * 未声明名字）原样保留；按首次出现去重。
 */
function v2Effects(effects: readonly unknown[], _effectParams: readonly string[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    const raw = typeof e === 'string' ? e : String((e as { name?: unknown }).name);
    const lower = raw.toLowerCase();
    if (lower === 'pure' || lower === 'async') continue;
    const name = lower === 'io' || lower === 'cpu' ? lower : raw;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** 深拷贝并去掉全部 origin，用于只比较形状的断言。 */
export function withoutOrigin<T>(node: T): T {
  return JSON.parse(JSON.stringify(node, (k, v) => (k === 'origin' ? undefined : v))) as T;
}
