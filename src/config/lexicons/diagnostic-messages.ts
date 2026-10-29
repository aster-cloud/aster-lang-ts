/**
 * 语言特定的诊断消息翻译（overlay 模式）
 *
 * 不修改 @generated 的 lexicon 文件，而是通过 attach 函数
 * 在运行时将翻译附加到 Lexicon 对象上。
 *
 * 译文唯一来源是语言包的 overlays/<语言 id>/diagnostic-*.json（aster-lang-locales 的 zh/de、
 * aster-lang-hi 的 hi）。它们经 core exportLexicons 进入 lexicons.json，再由
 * scripts/generate-diagnostic-overlays.ts 生成 diagnostic-overlays.generated.ts；
 * 本模块加载时把生成表逐个经 registerOverlay* 注册。本仓不保留任何内联译文：
 * 缺译文的语言或错误码回落到 shared/error_codes.json 的英文。
 */

import type { Lexicon } from './types.js';
import type { OverlayData } from './overlay-loader.js';
import { loadDiagnosticMessages, loadDiagnosticHelp } from './overlay-loader.js';
import { DIAGNOSTIC_OVERLAYS } from './diagnostic-overlays.generated.js';

// 导出供 error-codes-parity / diagnostic-overlays 测试校验覆盖面、孤儿码与占位符。
export const MESSAGES_BY_LEXICON: Record<string, Readonly<Partial<Record<string, string>>>> = {};

export const HELP_BY_LEXICON: Record<string, Readonly<Partial<Record<string, string>>>> = {};

/**
 * 从 JSON overlay 数据注册诊断消息翻译（覆盖同一语言已注册的译文）。
 */
export function registerOverlayDiagnosticMessages(lexiconId: string, overlay: NonNullable<OverlayData['diagnosticMessages']>): void {
  MESSAGES_BY_LEXICON[lexiconId] = loadDiagnosticMessages(overlay);
}

/**
 * 从 JSON overlay 数据注册诊断帮助文本翻译（覆盖同一语言已注册的译文）。
 */
export function registerOverlayDiagnosticHelp(lexiconId: string, overlay: NonNullable<OverlayData['diagnosticHelp']>): void {
  HELP_BY_LEXICON[lexiconId] = loadDiagnosticHelp(overlay);
}

/** 为 lexicon 附加诊断消息翻译（不修改原对象） */
export function attachDiagnosticMessages(lexicon: Lexicon): Lexicon {
  if (lexicon.diagnosticMessages && lexicon.diagnosticHelp) return lexicon;
  const messages = lexicon.diagnosticMessages ?? MESSAGES_BY_LEXICON[lexicon.id];
  const help = lexicon.diagnosticHelp ?? HELP_BY_LEXICON[lexicon.id];
  return {
    ...lexicon,
    ...(messages !== undefined && { diagnosticMessages: messages }),
    ...(help !== undefined && { diagnosticHelp: help }),
  };
}

for (const [lexiconId, overlay] of Object.entries(DIAGNOSTIC_OVERLAYS)) {
  if (overlay.diagnosticMessages) registerOverlayDiagnosticMessages(lexiconId, overlay.diagnosticMessages);
  if (overlay.diagnosticHelp) registerOverlayDiagnosticHelp(lexiconId, overlay.diagnosticHelp);
}
