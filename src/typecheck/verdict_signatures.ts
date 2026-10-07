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
