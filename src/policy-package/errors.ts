/**
 * 包格式 v1 CLI 的错误码、退出码与固定 message（ADR 0059 §4.1、修订 2 R1 / R2）。
 *
 * 唯一真相源是 aster-lang-test `conformance/package-v1/exit-codes.json`（`codes` ∪ `codesSince["1.1"]`，本 CLI 支持 1.0 与 1.1）；本表逐条照抄，
 * `test/unit/policy-package/exit-codes-parity.test.ts` 以兄弟仓文件守住两者一致。
 * 信封里的 `error.message` 必须逐字等于本表的 message，诊断细节一律写 stderr（修订 2 R1），
 * 否则两个 CLI 的失败信封不可能逐字节相同。
 */

/** 全部错误码与其退出码、固定 message。 */
export const ERROR_CODES = {
  COMPILE_ERROR: { exit: 4, message: 'source failed to compile' },
  DISPLAY_AMBIGUOUS: { exit: 2, message: 'edited display text maps onto the package layout in more than one way' },
  DISPLAY_REJECTED: { exit: 2, message: 'edited display text would hide a value from readers' },
  DISPLAY_UNMAPPABLE: { exit: 2, message: 'edited display text does not map onto the package layout' },
  ENTRY_NOT_FOUND: { exit: 2, message: 'entry function not found or not runnable' },
  EVAL_ERROR: { exit: 1, message: 'policy evaluation failed' },
  INPUT_INVALID: { exit: 2, message: "input does not match the entry's input schema" },
  PKG_DISPLAY_INVALID: { exit: 4, message: 'package display layout is not valid' },
  PKG_INTEGRITY: { exit: 3, message: 'package integrity check failed' },
  PKG_INVALID_MANIFEST: { exit: 4, message: 'manifest is not valid' },
  PKG_IR_DRIFT: {
    exit: 4,
    message: 'locally compiled IR differs from the package; use an A package or the CLI version recorded in runtime.cli.version',
  },
  PKG_SIGNATURE: { exit: 3, message: 'manifest signature is invalid' },
  PKG_UNSIGNED: { exit: 3, message: 'package is unsigned; pass --allow-unsigned to accept it' },
  PKG_UNSUPPORTED_FORMAT: { exit: 4, message: 'package format version is not supported' },
  PKG_UNSUPPORTED_IR: { exit: 4, message: 'Core IR version is not supported' },
  PKG_UNTRUSTED_KID: { exit: 3, message: 'signing key id is not in the trust anchor' },
  PROBE_MISMATCH: { exit: 1, message: 'a probe result differs from its expected output' },
  RESOURCE_EXHAUSTED: { exit: 5, message: 'evaluation exhausted a resource limit' },
  TIMEOUT: { exit: 5, message: 'evaluation timed out' },
  USAGE: { exit: 2, message: 'invalid command line' },
} as const satisfies Record<string, { exit: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * 检查阶段（README「检查顺序」）。阶段决定失败信封里 `meta` 的取值，以及 `verify` 中报告失败的检查项。
 */
export type Stage =
  | 'usage'
  | 'read'
  | 'manifest'
  | 'signature'
  | 'integrity'
  | 'ir'
  // 包格式 1.1 显示排版（ADR 0059 修订 4）：包排版 L1–L7、verify 的 L8–L9、run --display 的还原 / 派生排版 / 派生编译
  | 'display'
  | 'display-ir'
  | 'reconstruct'
  | 'derived'
  | 'compile'
  | 'entry'
  | 'input'
  | 'eval';

/** CLI 流水线中的失败：携带错误码、所处阶段与只写 stderr 的诊断文本。 */
export class PackageError extends Error {
  readonly exitCode: number;

  constructor(
    readonly code: ErrorCode,
    readonly stage: Stage,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'PackageError';
    this.exitCode = ERROR_CODES[code].exit;
  }
}

/** 以给定阶段与码抛出的便捷函数（返回 never，便于在表达式位置使用）。 */
export function fail(stage: Stage, code: ErrorCode, detail: string): never {
  throw new PackageError(code, stage, detail);
}
