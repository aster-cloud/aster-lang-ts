/**
 * @module config/lexicons/identifiers
 *
 * 标识符映射模块 - 支持多语言结构体、字段、函数名称。
 *
 * **使用方式**：
 *
 * ```typescript
 * import {
 *   vocabularyRegistry,
 *   initBuiltinVocabularies,
 *   localizeIdentifier,
 * } from './config/lexicons/identifiers';
 *
 * // 初始化内置词汇表
 * initBuiltinVocabularies();
 *
 * // 源码中的本地化名字按位置解析：编译时传入词汇作用域（ADR 0051）
 * const scopes = vocabularyRegistry.getWithCustom(tenantId, 'insurance.auto', 'zh-CN');
 *
 * // 展示用：将规范化名称转换为中文
 * const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN');
 * localizeIdentifier(index, 'QuoteResult'); // => '报价结果'
 * ```
 */

// 类型导出
export {
  IdentifierKind,
  IdentifierMapping,
  DomainVocabulary,
  IdentifierIndex,
  buildIdentifierIndex,
  localizeIdentifier,
  validateVocabulary,
} from './types.js';

// 按角色与作用域的词汇视图（ADR 0051）
export {
  buildVocabularyScopes,
  canonicalScopesJson,
  lookup,
  VocabularyScopeError,
  type Candidate,
  type VocabularyScopes,
  type VocabularyScopeErrorCode,
} from './scopes.js';
export { foldKey } from './casefold.js';

// 注册中心导出
export {
  vocabularyRegistry,
  initBuiltinVocabularies,
  VocabularyRegistry,
  type VocabularyEntry,
} from './registry.js';

// 领域词汇表导出（@generated 文件，由 Java 真源生成）
export {
  FINANCE_LOAN_DE_DE,
  FINANCE_LOAN_EN_US,
  FINANCE_LOAN_ZH_CN,
  INSURANCE_AUTO_DE_DE,
  INSURANCE_AUTO_EN_US,
  INSURANCE_AUTO_ZH_CN,
} from './domains/index.js';
