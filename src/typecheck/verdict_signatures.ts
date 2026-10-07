/**
 * Verdict 内置模块签名表（ADR 0039 §2.2）。
 * Java 侧镜像：aster-lang-core/.../typecheck/governance/VerdictSignatures.java，两份必须同值。
 */
export const VERDICT_TYPE_NAME = 'Verdict';
export const VERDICT_PREFIX = 'Verdict.';

export const VERDICT_ARITY: ReadonlyMap<string, number> = new Map([
  ['Verdict.allow', 0],
  ['Verdict.deny', 1],
  ['Verdict.require_approval', 2],
  ['Verdict.escalate', 1],
]);

export function isVerdictCall(name: string): boolean { return VERDICT_ARITY.has(name); }
export function hasVerdictPrefix(name: string): boolean { return name.startsWith(VERDICT_PREFIX); }
export function verdictArity(name: string): number | undefined { return VERDICT_ARITY.get(name); }

/** Verdict 值上可读取的字段，全部为 Text（值形状见 ADR 0039 §2.1，Java 侧同表）。 */
export const VERDICT_FIELDS: ReadonlySet<string> = new Set(['outcome', 'role', 'reason']);

export function isVerdictField(name: string): boolean { return VERDICT_FIELDS.has(name); }

/** 静态类型是否为 Verdict 名义类型。 */
export function isVerdictType(t: { kind: string; name?: string } | undefined): boolean {
  return t?.kind === 'TypeName' && t.name === VERDICT_TYPE_NAME;
}
