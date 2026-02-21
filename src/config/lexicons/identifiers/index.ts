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
 *   canonicalizeIdentifier,
 *   localizeIdentifier,
 * } from './config/lexicons/identifiers';
 *
 * // 初始化内置词汇表
 * initBuiltinVocabularies();
 *
 * // 获取汽车保险领域的中文词汇表索引
 * const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN');
 *
 * // 将中文标识符转换为规范化名称
 * canonicalizeIdentifier(index, '驾驶员');  // => 'Driver'
 * canonicalizeIdentifier(index, '年龄');    // => 'age'
 *
 * // 将规范化名称转换为中文
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
  canonicalizeIdentifier,
  localizeIdentifier,
  hasIdentifierMapping,
  validateVocabulary,
} from './types.js';

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
