/**
 * @module diagnostics
 *
 * 诊断系统模块。
 *
 * 包含：
 * - 结构化诊断 (Diagnostic, DiagnosticBuilder, DiagnosticError)
 * - 诊断严重级别 (DiagnosticSeverity)
 * - 诊断代码 (DiagnosticCode)
 * - 错误码定义 (ErrorCode, ErrorMetadata)
 */

export {
  DiagnosticSeverity,
  DiagnosticCode,
  DiagnosticError,
  DiagnosticBuilder,
  Diagnostics,
  formatDiagnostic,
  dummyPosition,
  type Diagnostic,
  type FixIt,
} from './diagnostics.js';

export {
  ErrorCode,
  ERROR_MESSAGES,
  ERROR_METADATA,
  formatErrorMessage,
  getErrorMetadata,
  type ErrorCategory,
  type ErrorSeverity,
  type ErrorMetadata,
} from './error_codes.js';
