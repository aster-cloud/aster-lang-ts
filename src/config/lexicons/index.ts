/**
 * @module config/lexicons
 *
 * Lexicon 模块入口 - 导出所有词法表相关功能。
 *
 * **使用方式**：
 * ```typescript
 * import { LexiconRegistry, EN_US, ZH_CN } from './config/lexicons/index.js';
 *
 * // 注册词法表
 * LexiconRegistry.register(EN_US);
 * LexiconRegistry.register(ZH_CN);
 *
 * // 获取当前词法表
 * const lexicon = LexiconRegistry.getDefault();
 * ```
 */

// 导入以便在初始化函数中使用
import { LexiconRegistry as Registry } from './registry.js';
import { EN_US as EnglishLexicon } from './en-US.js';
import { ZH_CN as ChineseLexicon } from './zh-CN.js';
import { DE_DE as GermanLexicon } from './de-DE.js';

// 类型导出
export type {
  Lexicon,
  PunctuationConfig,
  CanonicalizationConfig,
  CanonicalizationRule,
  ErrorMessages,
  LexiconValidationResult,
  KeywordIndex,
} from './types.js';

// 类型工具函数
export {
  buildKeywordIndex,
  getMultiWordKeywords,
  findSemanticTokenKind,
  isLexiconKeyword,
} from './types.js';

// 注册表
export { LexiconRegistry } from './registry.js';
export type { ILexiconRegistry } from './registry.js';

// 词法表实现
export { EN_US } from './en-US.js';
export { ZH_CN } from './zh-CN.js';
export { DE_DE } from './de-DE.js';

// SemanticTokenKind 重导出（便于使用）
export {
  SemanticTokenKind,
  getAllSemanticTokenKinds,
  isSemanticTokenKind,
  SEMANTIC_TOKEN_CATEGORIES,
} from '../token-kind.js';

/**
 * 初始化默认词法表。
 *
 * 在应用启动时调用此函数，注册所有内置词法表。
 * 此函数是幂等的，可安全重复调用。
 */
export function initializeDefaultLexicons(): void {
  if (!Registry.has('en-US')) {
    Registry.register(EnglishLexicon);
  }
  if (!Registry.has('zh-CN')) {
    Registry.register(ChineseLexicon);
  }
  if (!Registry.has('de-DE')) {
    Registry.register(GermanLexicon);
  }
}
