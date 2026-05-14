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
// en-US 是 backbone，永远 export
export { EN_US } from './en-US.js';

// zh-CN / de-DE 暂时仍在主包内，给现有消费者一个迁移窗口。
// 下个 major 版本会移到 @aster-cloud/aster-lang-ts-{zh,de} 独立包。
// 标 @deprecated 让 IDE 在使用处给出黄线提醒。
/** @deprecated 将迁移到独立 npm 包 @aster-cloud/aster-lang-ts-zh。 */
export { ZH_CN } from './zh-CN.js';
/** @deprecated 将迁移到独立 npm 包 @aster-cloud/aster-lang-ts-de。 */
export { DE_DE } from './de-DE.js';

// FallbackLexicon 工厂 + 类型守卫（公开，便于消费者直接用 + 测试）
export {
  createFallbackLexicon,
  isFallbackLexicon,
  FallbackLexicon,
} from './fallback-lexicon.js';

// SemanticTokenKind 重导出（便于使用）
export {
  SemanticTokenKind,
  getAllSemanticTokenKinds,
  isSemanticTokenKind,
  SEMANTIC_TOKEN_CATEGORIES,
} from '../token-kind.js';

/**
 * 初始化默认词法表 = **仅注册 en-US 作为 backbone**。
 *
 * zh-CN / de-DE 不再自动注册。消费者按需调 `LexiconRegistry.register(ZH_CN)`
 * 或迁移到 npm 分包（@aster-cloud/aster-lang-ts-{lang}，未来发布）。
 *
 * 主包仍 export `ZH_CN` / `DE_DE` 常量，便于一次性 import；但**不**默认注册，
 * 减少主包 bundle 体积，并让 fallback-lexicon 在 target 缺 keyword 时
 * 自动回退到 en-US。
 *
 * 此函数幂等，可安全重复调用。
 */
export function initializeDefaultLexicons(): void {
  // 仅在首次注册 en-US 时才回置 default，避免覆盖调用方主动 setDefault 的选择
  // 例如：测试或运行时切换到 zh-CN 后再次进入 lexer.getEffectiveLexicon 不应被回滚
  if (!Registry.has('en-US')) {
    Registry.register(EnglishLexicon);
    Registry.setDefault('en-US');
  }
}

/**
 * 一次性注册主包内置的所有语言（en + zh + de），保留旧 initializeDefaultLexicons
 * 的旧行为以**避免破坏现有消费者**。
 *
 * @deprecated 下个 major 版本会被删除。建议迁移：
 *   ```ts
 *   import { initializeDefaultLexicons, LexiconRegistry } from '@aster-cloud/aster-lang-ts';
 *   import { ZH_CN } from '@aster-cloud/aster-lang-ts';   // 临时仍能从主包拿
 *   initializeDefaultLexicons();                            // 仅 en-US
 *   LexiconRegistry.register(ZH_CN);                        // 显式加 zh
 *   ```
 */
export function initializeAllBundledLexicons(): void {
  const enWasNew = !Registry.has('en-US');
  if (enWasNew) Registry.register(EnglishLexicon);
  if (!Registry.has('zh-CN')) Registry.register(ChineseLexicon);
  if (!Registry.has('de-DE')) Registry.register(GermanLexicon);
  // 同 initializeDefaultLexicons：仅首次注册时强制回置 default
  if (enWasNew) Registry.setDefault('en-US');
}
