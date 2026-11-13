/**
 * Core IR v2 的规范序列化出口与不变式检查（ADR 0055 §3、§5）。
 *
 * - `serializeCoreIr`：输出 core `CanonicalJson` 规则下的字节（键按码点升序、数组保序、
 *   null 显式输出、只允许 safe integer）。凡是给持久化、哈希或 parity 用的 IR 都经这里产出。
 *   规范十进制串（Double.value、Range.min/max）由 lowering 负责，这里只原样转义。
 * - `validateCoreIrInvariants`：schema 表达不了的约束，规则与 locales `core-ir/README.md`
 *   「不变式」一节、`build.gradle.kts` 的参考实现 `coreIrInvariantProblems` 逐条对应。
 *
 * 本模块是纯函数，不依赖 ajv 与 Node API，可进浏览器入口；严格读入见 `read-core-ir.ts`。
 */
import { canonicalJson } from './canonical-json.js';
import type { IrBlock, IrCaseBody, IrFunc, IrModule, IrStmt } from './core-ir-v2.generated.js';

/** 不变式问题：`path` 为 JSON Pointer，`code` 取 README「不变式」表中的值。 */
export interface CoreIrProblem {
  readonly path: string;
  readonly code: string;
}

/** 授权型具体效应名（schema `$defs/BuiltinEffect`）。 */
const BUILTIN_EFFECTS: ReadonlySet<string> = new Set(['io', 'cpu']);

/** 保留效应名（schema `$defs/ReservedEffectName`），效应参数不得与其大小写不敏感地相同。 */
const RESERVED_EFFECT_NAMES: ReadonlySet<string> = new Set(['io', 'cpu', 'pure', 'async']);

/** 「返回 Verdict」判定用的调用名（与 core `GovernanceChecker.returnsVerdict` 同义）。 */
const VERDICT_CALLS: ReadonlySet<string> = new Set([
  'Verdict.allow',
  'Verdict.deny',
  'Verdict.require_approval',
  'Verdict.escalate',
]);

/** 把 Core IR v2 模块序列化为规范字节。遇到 undefined、非 safe integer 等非规范值即抛 CanonicalJsonError。 */
export function serializeCoreIr(m: IrModule): string {
  return canonicalJson(m);
}

/** 检查 schema 之外的不变式；输入须已通过 schema。结果按 (path, code) 排序。 */
export function validateCoreIrInvariants(m: IrModule): CoreIrProblem[] {
  const out: CoreIrProblem[] = [];
  collectDuplicateArgs(m, '', out);
  const hasProfile = m.profile !== null;
  m.decls.forEach((decl, i) => {
    if (decl.kind === 'Func') out.push(...funcProblems(decl, `/decls/${i}`, hasProfile));
  });
  return out.sort(compareProblems);
}

function compareProblems(a: CoreIrProblem, b: CoreIrProblem): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return 0;
}

/** 同一注解内参数名重复：报后出现的那个参数（树中任何位置的 annotations / retAnnotations）。 */
function collectDuplicateArgs(node: unknown, path: string, out: CoreIrProblem[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectDuplicateArgs(child, `${path}/${i}`, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    if ((key === 'annotations' || key === 'retAnnotations') && Array.isArray(child)) {
      child.forEach((ann, j) => duplicateArgsOf(ann, `${path}/${key}/${j}`, out));
    }
    collectDuplicateArgs(child, `${path}/${key}`, out);
  }
}

function duplicateArgsOf(annotation: unknown, path: string, out: CoreIrProblem[]): void {
  const args = (annotation as { args?: unknown }).args;
  if (!Array.isArray(args)) return;
  const seen = new Set<string>();
  args.forEach((arg, k) => {
    const name = String((arg as { name?: unknown }).name);
    if (seen.has(name)) out.push({ path: `${path}/args/${k}`, code: 'dup-annotation-arg' });
    seen.add(name);
  });
}

function funcProblems(func: IrFunc, path: string, hasProfile: boolean): CoreIrProblem[] {
  const out: CoreIrProblem[] = [];
  func.effectParams.forEach((p, k) => {
    if (RESERVED_EFFECT_NAMES.has(asciiLower(p))) {
      out.push({ path: `${path}/effectParams/${k}`, code: 'effect-param-shadows-builtin' });
    }
  });
  // effects 按首次声明顺序去重：重复条目报后出现的那个；非 io / cpu 的条目必须是已声明的效应变量
  const seen = new Set<string>();
  func.effects.forEach((name, k) => {
    if (seen.has(name)) out.push({ path: `${path}/effects/${k}`, code: 'duplicate-effect' });
    else if (!BUILTIN_EFFECTS.has(name) && !func.effectParams.includes(name)) {
      out.push({ path: `${path}/effects/${k}`, code: 'undeclared-effect-var' });
    }
    seen.add(name);
  });
  // ADR 0055 #12：档案模块中返回 Verdict 的规则必须是数组，其余函数必须为 null
  if (Array.isArray(func.inputRefs) !== (hasProfile && returnsVerdict(func))) {
    out.push({ path: `${path}/inputRefs`, code: 'input-refs-state' });
  }
  return out;
}

/** 按 ASCII 大小写不敏感比较所用的小写化（保留效应名都是 ASCII）。 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 32));
}

/** 「返回 Verdict」：ret 是 TypeName Verdict，或可达的某个 Return 是 Verdict.* 调用。 */
export function returnsVerdict(func: IrFunc): boolean {
  if (func.ret.kind === 'TypeName' && func.ret.name === 'Verdict') return true;
  return anyReturnIsVerdictCall(func.body);
}

function anyReturnIsVerdictCall(stmt: IrStmt | IrCaseBody | IrBlock | null): boolean {
  if (stmt === null) return false;
  switch (stmt.kind) {
    case 'Return': {
      const e = stmt.expr;
      return e.kind === 'Call' && e.target.kind === 'Name' && VERDICT_CALLS.has(e.target.name);
    }
    case 'Block':
    case 'Scope':
      return stmt.statements.some(anyReturnIsVerdictCall);
    case 'If':
      return anyReturnIsVerdictCall(stmt.thenBlock) || anyReturnIsVerdictCall(stmt.elseBlock);
    case 'Match':
      return stmt.cases.some(c => anyReturnIsVerdictCall(c.body));
    default:
      return false;
  }
}
