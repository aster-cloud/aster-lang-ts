/**
 * @module frontend/resolution-context
 *
 * 名称解析（ADR 0051 R1/R2）的输入上下文：词汇作用域与导入模块的已解析声明。
 */
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';

export type { ResolvedRole } from '../types.js';

/**
 * 导入模块中已解析的声明，全部为规范名。按 §6.2 第 2 步与本模块声明同层参与匹配，
 * 因此优先于词汇。
 */
export interface ImportedDeclarations {
  /** Data / Enum 规范名 */
  readonly types: readonly string[];
  /** 函数规范名 */
  readonly functions: readonly string[];
  /** 枚举规范名 → 成员规范名 */
  readonly enumMembers: ReadonlyMap<string, readonly string[]>;
  /** Data 规范名 → 字段规范名 */
  readonly fields: ReadonlyMap<string, readonly string[]>;
}

export const NO_IMPORTS: ImportedDeclarations = {
  types: [],
  functions: [],
  enumMembers: new Map(),
  fields: new Map(),
};

export interface ResolutionContext {
  /** 词汇作用域；缺省表示无词汇，只按源码声明与原写法解析 */
  readonly scopes?: VocabularyScopes;
  readonly imports: ImportedDeclarations;
}
