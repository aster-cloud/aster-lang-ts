/**
 * JSON overlay 加载器
 *
 * 从 LexiconExporter 导出的 JSON 中解析 overlay 数据，
 * 将 JSON 格式转换为 TypeScript 运行时对象。
 */

import type { TypeInferenceRule, PrimitiveTypeName } from '../../types/type-inference.js';
import type { ValueGenerationRule } from '../../parser/input-generator.js';
import type { LspUiTexts } from './lsp-ui-texts.js';

interface RawTypeInferenceRule {
  readonly pattern: string;
  readonly flags?: string;
  readonly type: string;
  readonly priority: number;
}

interface RawInputGenerationRule {
  readonly pattern: string;
  readonly flags?: string;
  readonly value: unknown;
  readonly priority: number;
}

interface TypeInferenceOverlay {
  readonly version: number;
  readonly rules: readonly RawTypeInferenceRule[];
}

interface InputGenerationOverlay {
  readonly version: number;
  readonly rules: readonly RawInputGenerationRule[];
}

interface DiagnosticMessagesOverlay {
  readonly version: number;
  readonly messages: Readonly<Record<string, string>>;
}

interface DiagnosticHelpOverlay {
  readonly version: number;
  readonly help: Readonly<Record<string, string>>;
}

interface LspUiTextsOverlay {
  readonly version: number;
  readonly texts: Readonly<Record<string, string>>;
}

export interface OverlayData {
  readonly typeInferenceRules?: TypeInferenceOverlay;
  readonly inputGenerationRules?: InputGenerationOverlay;
  readonly diagnosticMessages?: DiagnosticMessagesOverlay;
  readonly diagnosticHelp?: DiagnosticHelpOverlay;
  readonly lspUiTexts?: LspUiTextsOverlay;
}

export function loadTypeInferenceRules(overlay: TypeInferenceOverlay): readonly TypeInferenceRule[] {
  return overlay.rules.map(r => ({
    pattern: new RegExp(r.pattern, r.flags ?? ''),
    type: r.type as PrimitiveTypeName,
    priority: r.priority,
  }));
}

export function loadInputGenerationRules(overlay: InputGenerationOverlay): readonly ValueGenerationRule[] {
  return overlay.rules.map(r => ({
    pattern: new RegExp(r.pattern, r.flags ?? ''),
    generate: () => r.value,
    priority: r.priority,
  }));
}

export function loadDiagnosticMessages(overlay: DiagnosticMessagesOverlay): Readonly<Partial<Record<string, string>>> {
  return overlay.messages;
}

export function loadDiagnosticHelp(overlay: DiagnosticHelpOverlay): Readonly<Partial<Record<string, string>>> {
  return overlay.help;
}

export function loadLspUiTexts(overlay: LspUiTextsOverlay): Readonly<LspUiTexts> {
  return overlay.texts as unknown as LspUiTexts;
}
