/**
 * @module frontend
 *
 * 编译器前端模块：词法分析和源码规范化。
 *
 * 包含：
 * - 规范化器 (canonicalizer)
 * - 词法分析器 (lexer)
 * - Token 定义 (tokens)
 * - 关键词翻译 (keyword-translator)
 */

export { canonicalize } from './canonicalizer.js';
export type { CanonicalizerOptions } from './canonicalizer.js';
export { lex } from './lexer.js';
export { TokenKind, KW } from './tokens.js';
export {
  createKeywordTranslator,
  buildKeywordTranslationIndex,
  buildFullTranslationIndex,
  translateTokens,
  translateTokensWithMarkers,
  translateToken,
  needsKeywordTranslation,
} from './keyword-translator.js';
export type {
  KeywordTranslationIndex,
  MarkerKeywordIndex,
  TranslationIndexResult,
} from './keyword-translator.js';
