/**
 * @module config/lexicons/registry
 *
 * Lexicon 注册表 - 管理所有已注册的词法表。
 *
 * **使用方式**：
 * ```typescript
 * import { LexiconRegistry } from './registry.js';
 *
 * // 获取词法表
 * const lexicon = LexiconRegistry.get('zh-CN');
 *
 * // 设置默认词法表
 * LexiconRegistry.setDefault('zh-CN');
 * ```
 */

import type { Lexicon, LexiconValidationResult } from './types.js';
import { getAllSemanticTokenKinds } from '../token-kind.js';

/**
 * Lexicon 注册表接口。
 */
export interface ILexiconRegistry {
  /** 注册新词法表 */
  register(lexicon: Lexicon): void;

  /** 获取词法表 */
  get(id: string): Lexicon | undefined;

  /** 获取所有已注册的词法表 ID */
  list(): string[];

  /** 检查词法表是否已注册 */
  has(id: string): boolean;

  /** 获取默认词法表 */
  getDefault(): Lexicon;

  /** 设置默认词法表 */
  setDefault(id: string): void;

  /** 验证词法表 */
  validate(lexicon: Lexicon): LexiconValidationResult;
}

/**
 * Lexicon 注册表实现。
 */
class LexiconRegistryImpl implements ILexiconRegistry {
  private lexicons = new Map<string, Lexicon>();
  private defaultId: string = 'en-US';

  /**
   * 注册新词法表。
   *
   * @param lexicon - 要注册的词法表
   * @throws 如果词法表验证失败
   */
  register(lexicon: Lexicon): void {
    const validation = this.validate(lexicon);
    if (!validation.valid) {
      throw new Error(`Invalid lexicon '${lexicon.id}': ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
      console.warn(`Lexicon '${lexicon.id}' warnings: ${validation.warnings.join(', ')}`);
    }

    this.lexicons.set(lexicon.id, lexicon);
  }

  /**
   * 获取词法表。
   *
   * @param id - 词法表 ID
   * @returns 词法表，如果不存在则返回 undefined
   */
  get(id: string): Lexicon | undefined {
    return this.lexicons.get(id);
  }

  /**
   * 获取所有已注册的词法表 ID。
   *
   * @returns 词法表 ID 数组
   */
  list(): string[] {
    return Array.from(this.lexicons.keys());
  }

  /**
   * 检查词法表是否已注册。
   *
   * @param id - 词法表 ID
   * @returns 如果已注册返回 true
   */
  has(id: string): boolean {
    return this.lexicons.has(id);
  }

  /**
   * 获取默认词法表。
   *
   * @returns 默认词法表
   * @throws 如果默认词法表未注册
   */
  getDefault(): Lexicon {
    const lexicon = this.lexicons.get(this.defaultId);
    if (!lexicon) {
      throw new Error(`Default lexicon '${this.defaultId}' not registered`);
    }
    return lexicon;
  }

  /**
   * 设置默认词法表。
   *
   * @param id - 词法表 ID
   * @throws 如果词法表未注册
   */
  setDefault(id: string): void {
    if (!this.lexicons.has(id)) {
      throw new Error(`Cannot set default: lexicon '${id}' not registered`);
    }
    this.defaultId = id;
  }

  /**
   * 验证词法表完整性。
   *
   * @param lexicon - 要验证的词法表
   * @returns 验证结果
   */
  validate(lexicon: Lexicon): LexiconValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查 ID 格式
    if (!lexicon.id || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lexicon.id)) {
      warnings.push(`ID '${lexicon.id}' does not follow BCP 47 format (e.g., 'en-US', 'zh-CN')`);
    }

    // 检查名称
    if (!lexicon.name || lexicon.name.trim() === '') {
      errors.push('Name is required');
    }

    // 检查方向
    if (lexicon.direction !== 'ltr' && lexicon.direction !== 'rtl') {
      errors.push(`Invalid direction '${lexicon.direction}', must be 'ltr' or 'rtl'`);
    }

    // 检查关键词完整性
    const allKinds = getAllSemanticTokenKinds();
    const missingKeywords: string[] = [];
    const emptyKeywords: string[] = [];

    for (const kind of allKinds) {
      const keyword = lexicon.keywords[kind];
      if (keyword === undefined) {
        missingKeywords.push(kind);
      } else if (keyword.trim() === '') {
        emptyKeywords.push(kind);
      }
    }

    if (missingKeywords.length > 0) {
      errors.push(`Missing keywords for: ${missingKeywords.join(', ')}`);
    }

    if (emptyKeywords.length > 0) {
      errors.push(`Empty keywords for: ${emptyKeywords.join(', ')}`);
    }

    // 检查关键词唯一性
    const keywordCounts = new Map<string, string[]>();
    for (const [kind, keyword] of Object.entries(lexicon.keywords)) {
      const lower = keyword.toLowerCase();
      const existing = keywordCounts.get(lower) || [];
      existing.push(kind);
      keywordCounts.set(lower, existing);
    }

    // 构建允许的重复关键字集合（用于快速查找）
    const allowedDuplicateSets = new Set<string>();
    if (lexicon.canonicalization.allowedDuplicates) {
      for (const group of lexicon.canonicalization.allowedDuplicates) {
        // 将组内所有成员排序后连接，作为集合标识
        const sortedGroup = [...group].sort().join('|');
        allowedDuplicateSets.add(sortedGroup);
      }
    }

    for (const [keyword, kinds] of keywordCounts) {
      if (kinds.length > 1) {
        // 检查这组重复是否在允许列表中
        const sortedKinds = [...kinds].sort().join('|');
        if (!allowedDuplicateSets.has(sortedKinds)) {
          warnings.push(`Duplicate keyword '${keyword}' used by: ${kinds.join(', ')}`);
        }
      }
    }

    // 检查标点符号配置
    if (!lexicon.punctuation.statementEnd) {
      errors.push('punctuation.statementEnd is required');
    }
    if (!lexicon.punctuation.listSeparator) {
      errors.push('punctuation.listSeparator is required');
    }
    if (!lexicon.punctuation.enumSeparator) {
      errors.push('punctuation.enumSeparator is required');
    }
    if (!lexicon.punctuation.blockStart) {
      errors.push('punctuation.blockStart is required');
    }
    if (!lexicon.punctuation.stringQuotes?.open || !lexicon.punctuation.stringQuotes?.close) {
      errors.push('punctuation.stringQuotes.open and close are required');
    }

    // 检查 canonicalization 配置一致性
    if (lexicon.canonicalization.removeArticles && !lexicon.canonicalization.articles) {
      warnings.push('removeArticles is true but articles array is not defined');
    }
    if (lexicon.canonicalization.articles && lexicon.canonicalization.articles.length === 0) {
      warnings.push('articles array is empty');
    }

    // 检查错误消息
    const requiredMessages = [
      'unexpectedToken',
      'expectedKeyword',
      'undefinedVariable',
      'typeMismatch',
      'unterminatedString',
      'invalidIndentation',
    ];
    for (const msg of requiredMessages) {
      if (!lexicon.messages[msg as keyof typeof lexicon.messages]) {
        warnings.push(`Missing error message: ${msg}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

/**
 * 全局 Lexicon 注册表单例。
 */
export const LexiconRegistry: ILexiconRegistry = new LexiconRegistryImpl();
