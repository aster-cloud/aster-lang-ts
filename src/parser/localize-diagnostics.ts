/**
 * @module parser/localize-diagnostics
 *
 * 把语法诊断文案里引号中的英文规范关键词回译成作者所用 locale 的拼写。
 *
 * 为什么需要：parseWithLexicon 先把 zh/de 关键词翻译成英文 token 再解析，
 * 解析器的报错文案（如 "Expected 'return' after 'then'"）因此带着作者从未写过的
 * 英文关键词。这里只改写「引号内、且恰好是某个规范关键词」的片段：
 * 标识符、标点与其余文字保持原样。与 aster-api CnlErrorListener 的回译行为一致。
 */

import type { Diagnostic } from '../diagnostics/diagnostics.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { EN_US } from '../config/lexicons/en-US.js';

/** 小写规范拼写 → locale 主拼写。目标与规范 lexicon 相同时返回空表（即不改写）。 */
export function buildKeywordBackTranslation(lexicon: Lexicon): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  if (lexicon.id === EN_US.id) return map;
  for (const [kind, canonical] of Object.entries(EN_US.keywords)) {
    const local = (lexicon.keywords as Record<string, string | undefined>)[kind];
    if (!canonical || !local) continue;
    const key = canonical.toLowerCase();
    // 同一规范拼写对应多个语义时保留第一个，避免互相覆盖
    if (!map.has(key)) map.set(key, local);
  }
  return map;
}

/** 回译一条消息里所有被单引号包裹的规范关键词。 */
export function localizeKeywordsInMessage(message: string, table: ReadonlyMap<string, string>): string {
  if (table.size === 0) return message;
  return message.replace(/'([^'\n]+)'/g, (whole, inner: string) => {
    const local = table.get(inner.toLowerCase());
    return local === undefined ? whole : `'${local}'`;
  });
}

/** 返回回译后的新诊断数组（不修改入参）。 */
export function localizeDiagnostics(diagnostics: readonly Diagnostic[], lexicon: Lexicon): Diagnostic[] {
  const table = buildKeywordBackTranslation(lexicon);
  if (table.size === 0) return [...diagnostics];
  return diagnostics.map(d => {
    const message = localizeKeywordsInMessage(d.message, table);
    const related = d.relatedInformation?.map(r => ({
      ...r,
      message: localizeKeywordsInMessage(r.message, table),
    }));
    // fixIts.replacement 是要插回源码的文本，不在此改写（属于修复建议本身的正确性，另行处理）
    return {
      ...d,
      message,
      ...(related ? { relatedInformation: related } : {}),
    };
  });
}
