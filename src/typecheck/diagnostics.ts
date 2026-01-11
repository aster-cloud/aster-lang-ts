import type { Core, Span, TypecheckDiagnostic } from '../types.js';
import { ErrorCode, ERROR_MESSAGES, ERROR_METADATA } from '../diagnostics/error_codes.js';
import { TypeSystem } from './type_system.js';

type Severity = 'error' | 'warning' | 'info';

function formatMessage(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) return `{${key}}`;
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  });
}

export class DiagnosticBuilder {
  private readonly diagnostics: TypecheckDiagnostic[] = [];

  error(code: ErrorCode, span: Span | undefined, params: Record<string, unknown> = {}): this {
    return this.add(code, span, params, 'error');
  }

  warning(code: ErrorCode, span: Span | undefined, params: Record<string, unknown> = {}): this {
    return this.add(code, span, params, 'warning');
  }

  info(code: ErrorCode, span: Span | undefined, params: Record<string, unknown> = {}): this {
    return this.add(code, span, params, 'info');
  }

  typeMismatch(expected: Core.Type, actual: Core.Type, span: Span | undefined): this {
    return this.error(ErrorCode.TYPE_MISMATCH, span, {
      expected: TypeSystem.format(expected),
      actual: TypeSystem.format(actual),
    });
  }

  undefinedVariable(name: string, span: Span | undefined): this {
    return this.error(ErrorCode.UNDEFINED_VARIABLE, span, { name });
  }

  effectViolation(declared: string[], inferred: string[], span: Span | undefined): this {
    const declaredSet = new Set(declared);
    const inferredSet = new Set(inferred);

    const missing = [...inferredSet].filter(effect => !declaredSet.has(effect));
    const redundant = [...declaredSet].filter(effect => !inferredSet.has(effect));

    for (const effect of missing) {
      if (effect === 'io') {
        this.error(ErrorCode.EFF_INFER_MISSING_IO, span, { func: '' });
      } else if (effect === 'cpu') {
        this.error(ErrorCode.EFF_INFER_MISSING_CPU, span, { func: '' });
      } else {
        this.error(ErrorCode.EFF_CAP_MISSING, span, { func: '', cap: effect, declared: declared.join(', ') });
      }
    }

    for (const effect of redundant) {
      if (effect === 'io') {
        this.warning(ErrorCode.EFF_INFER_REDUNDANT_IO, span, { func: '' });
      } else if (effect === 'cpu') {
        if (declaredSet.has('io')) {
          this.warning(ErrorCode.EFF_INFER_REDUNDANT_CPU_WITH_IO, span, { func: '' });
        } else {
          this.warning(ErrorCode.EFF_INFER_REDUNDANT_CPU, span, { func: '' });
        }
      } else {
        this.info(ErrorCode.EFF_CAP_SUPERFLUOUS, span, { func: '', cap: effect });
      }
    }

    return this;
  }

  getDiagnostics(): TypecheckDiagnostic[] {
    return [...this.diagnostics];
  }

  hasErrors(): boolean {
    return this.diagnostics.some(diag => diag.severity === 'error');
  }

  private add(code: ErrorCode, span: Span | undefined, params: Record<string, unknown>, severityOverride?: Severity): this {
    const metadata = ERROR_METADATA[code];
    const template = ERROR_MESSAGES[code] ?? metadata.message;
    const severity = severityOverride ?? metadata.severity;

    const diagnostic: TypecheckDiagnostic = {
      severity,
      code,
      message: formatMessage(template, params),
    };

    if (span) diagnostic.span = span;
    if (metadata.help) diagnostic.help = metadata.help;
    if (Object.keys(params).length > 0) diagnostic.data = params;

    this.diagnostics.push(diagnostic);
    return this;
  }
}
