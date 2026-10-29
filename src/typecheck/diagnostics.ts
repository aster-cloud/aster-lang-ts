import type { Core, Span, TypecheckDiagnostic } from '../types.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { attachDiagnosticMessages } from '../config/lexicons/diagnostic-messages.js';
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

/** 模板中的占位符是否都能由参数填上（缺参数时渲染会留下字面的 {name}）。 */
function canRender(template: string, params: Record<string, unknown>): boolean {
  return [...template.matchAll(/\{(\w+)\}/g)].every((m) => params[m[1]!] !== undefined && params[m[1]!] !== null);
}

/**
 * 把已产出的诊断按 lexicon 的诊断译文本地化（返回新数组，不修改输入）。
 *
 * 名称解析（R1/R2）与浏览器类型检查在产出诊断时不知道 lexicon，这里按错误码与诊断的
 * data（DiagnosticBuilder 记录的模板参数）用目标语言模板重新渲染 message；参数不足以
 * 填满模板时保留原 message。原诊断带 help 时换成目标语言的 help。lexicon 没有诊断译文
 * （如 en-US）或未传时原样返回。
 */
export function localizeDiagnostics<T extends TypecheckDiagnostic>(diagnostics: readonly T[], lexicon: Lexicon | undefined): T[] {
  if (!lexicon) return [...diagnostics];
  const { diagnosticMessages: messages, diagnosticHelp: help } = attachDiagnosticMessages(lexicon);
  if (!messages && !help) return [...diagnostics];
  return diagnostics.map((d) => {
    const params = d.data !== null && typeof d.data === 'object' ? (d.data as Record<string, unknown>) : {};
    const template = messages?.[d.code];
    const localizedHelp = d.help === undefined ? undefined : help?.[d.code];
    const message = template !== undefined && canRender(template, params) ? formatMessage(template, params) : d.message;
    return localizedHelp === undefined ? { ...d, message } : { ...d, message, help: localizedHelp };
  });
}

export class DiagnosticBuilder {
  private readonly diagnostics: TypecheckDiagnostic[] = [];
  private readonly localizedMessages: Readonly<Partial<Record<string, string>>> | undefined;
  private readonly localizedHelp: Readonly<Partial<Record<string, string>>> | undefined;

  constructor(options?: {
    diagnosticMessages?: Readonly<Partial<Record<string, string>>> | undefined;
    diagnosticHelp?: Readonly<Partial<Record<string, string>>> | undefined;
  }) {
    this.localizedMessages = options?.diagnosticMessages;
    this.localizedHelp = options?.diagnosticHelp;
  }

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
    // 优先使用 lexicon 翻译，回退到英文基线
    const template = this.localizedMessages?.[code] ?? ERROR_MESSAGES[code] ?? metadata.message;
    const help = this.localizedHelp?.[code] ?? metadata.help;
    const severity = severityOverride ?? metadata.severity;

    const diagnostic: TypecheckDiagnostic = {
      severity,
      code,
      message: formatMessage(template, params),
    };

    if (span) diagnostic.span = span;
    if (help) diagnostic.help = help;
    if (Object.keys(params).length > 0) diagnostic.data = params;

    this.diagnostics.push(diagnostic);
    return this;
  }
}
