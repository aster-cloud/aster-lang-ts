/**
 * lowering 阶段异常 → 结构化诊断（aster-lang-ts#302）。
 *
 * lowering（AST → Core IR）只会以两种方式失败：
 * - AST 不变量守卫抛出带共享码 E600–E605 的 {@link DiagnosticError}（见 Diagnostics.unknown*）；
 * - 其它任何异常（引擎缺陷）。后者统一记为 E606，异常消息作为 `detail` 参数。
 *
 * 两者都转成与名称解析 / 类型检查同形的 {@link TypecheckDiagnostic}：`data` 即命名参数，
 * 消费方按 code + data 取译文（localizeDiagnostics 亦据此渲染）。
 */

import type { TypecheckDiagnostic } from '../types.js';
import { DiagnosticError } from './diagnostics.js';
import { ERROR_METADATA, ErrorCode, formatErrorMessage } from './error_codes.js';

/** 共享码表中 category=lowering 的码。 */
export function isLoweringCode(code: string): code is ErrorCode {
  return ERROR_METADATA[code as ErrorCode]?.category === 'lowering';
}

/**
 * 把 lowering 阶段抛出的异常转成诊断。
 *
 * @returns lowering 诊断；若是带非 lowering 码（如解析码）的 DiagnosticError 则返回 undefined，
 *          由调用方按解析诊断处理。
 */
export function toLoweringDiagnostic(error: unknown): TypecheckDiagnostic | undefined {
  if (error instanceof DiagnosticError) {
    const d = error.diagnostic;
    if (!isLoweringCode(d.code)) return undefined;
    return {
      severity: 'error',
      code: d.code,
      message: d.message,
      span: d.span,
      help: ERROR_METADATA[d.code].help,
      data: { ...d.params },
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  const params = { detail };
  return {
    severity: 'error',
    code: ErrorCode.LOWER_INTERNAL_ERROR,
    message: formatErrorMessage(ErrorCode.LOWER_INTERNAL_ERROR, params),
    help: ERROR_METADATA[ErrorCode.LOWER_INTERNAL_ERROR].help,
    data: params,
  };
}
