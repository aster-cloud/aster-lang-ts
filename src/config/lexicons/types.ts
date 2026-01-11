/**
 * @module config/lexicons/types
 *
 * Lexicon 接口定义 - 多语言词法抽象层的核心类型。
 *
 * **核心原则**：
 * - 语言无关：编译器核心不包含任何自然语言关键词
 * - 平等皮肤：英语、中文、日语等所有语言都是平等的"皮肤"
 * - 类型安全：所有映射都通过 SemanticTokenKind 进行类型检查
 */

import { SemanticTokenKind } from '../token-kind.js';

/**
 * 词法表接口 - 定义一种自然语言的 CNL 词法。
 *
 * 每个 Lexicon 实现必须提供完整的关键词映射、标点符号配置和规范化规则。
 */
export interface Lexicon {
  /** 词法表唯一标识符 (e.g., 'en-US', 'zh-CN', 'ja-JP') */
  readonly id: string;

  /** 人类可读的语言名称 */
  readonly name: string;

  /** 文字方向 ('ltr': 左到右, 'rtl': 右到左) */
  readonly direction: 'ltr' | 'rtl';

  /** 关键词映射：SemanticTokenKind -> 该语言的关键词字符串 */
  readonly keywords: Readonly<Record<SemanticTokenKind, string>>;

  /** 标点符号配置 */
  readonly punctuation: PunctuationConfig;

  /** 规范化配置 */
  readonly canonicalization: CanonicalizationConfig;

  /** 错误消息模板 */
  readonly messages: ErrorMessages;
}

/**
 * 标点符号配置。
 *
 * 定义该语言使用的各种标点符号，用于 Canonicalizer 和 Lexer 处理。
 */
export interface PunctuationConfig {
  /** 语句结束符 (英文 ".", 中文 "。") */
  readonly statementEnd: string;

  /** 列表分隔符 (英文 ",", 中文 "，") */
  readonly listSeparator: string;

  /** 枚举分隔符 (英文 ",", 中文 "、") */
  readonly enumSeparator: string;

  /** 块引导符 (英文 ":", 中文 "：") */
  readonly blockStart: string;

  /** 字符串引号 */
  readonly stringQuotes: {
    /** 开始引号 (英文 '"', 中文 '「') */
    readonly open: string;
    /** 结束引号 (英文 '"', 中文 '」') */
    readonly close: string;
  };

  /** 标记符号 (用于 【模块】 【定义】 等，可选) */
  readonly markers?: {
    /** 开始标记 (中文 '【') */
    readonly open: string;
    /** 结束标记 (中文 '】') */
    readonly close: string;
  };
}

/**
 * 规范化配置 - 控制源代码预处理行为。
 */
export interface CanonicalizationConfig {
  /** 是否将全角字符转换为半角（数字、运算符） */
  readonly fullWidthToHalf: boolean;

  /** 空格处理模式 */
  readonly whitespaceMode: 'english' | 'chinese' | 'mixed';

  /** 是否移除冠词 (英文: a, an, the) */
  readonly removeArticles: boolean;

  /** 冠词列表（如果 removeArticles 为 true） */
  readonly articles?: readonly string[];

  /** 自定义规范化规则 */
  readonly customRules?: readonly CanonicalizationRule[];

  /**
   * 允许共享同一关键字的语义令牌组。
   *
   * 某些自然语言中，同一个词可能在不同语法上下文中使用。
   * 例如英语中 "to" 同时用于函数定义（"To calculate..."）和赋值（"Set x to..."）。
   * 解析器通过上下文区分这些用途，因此重复是可接受的。
   *
   * 每个数组元素是一组允许共享关键字的 SemanticTokenKind。
   *
   * @example
   * ```typescript
   * allowedDuplicates: [
   *   [SemanticTokenKind.FUNC_TO, SemanticTokenKind.TO_WORD], // 两者都使用 "to"
   * ]
   * ```
   */
  readonly allowedDuplicates?: readonly (readonly SemanticTokenKind[])[];
}

/**
 * 自定义规范化规则。
 */
export interface CanonicalizationRule {
  /** 规则名称（用于调试和日志） */
  readonly name: string;

  /** 匹配模式（正则表达式字符串） */
  readonly pattern: string;

  /** 替换内容 */
  readonly replacement: string;
}

/**
 * 错误消息模板。
 *
 * 使用 `{placeholder}` 语法定义占位符。
 */
export interface ErrorMessages {
  /** 意外的符号 */
  readonly unexpectedToken: string;

  /** 期望的关键词 */
  readonly expectedKeyword: string;

  /** 未定义的变量 */
  readonly undefinedVariable: string;

  /** 类型不匹配 */
  readonly typeMismatch: string;

  /** 未终止的字符串 */
  readonly unterminatedString: string;

  /** 无效的缩进 */
  readonly invalidIndentation: string;
}

/**
 * Lexicon 验证结果。
 */
export interface LexiconValidationResult {
  /** 是否有效 */
  readonly valid: boolean;

  /** 错误列表 */
  readonly errors: readonly string[];

  /** 警告列表 */
  readonly warnings: readonly string[];
}

/**
 * 关键词索引 - 用于 Lexer 快速查找。
 */
export type KeywordIndex = Map<string, SemanticTokenKind>;

/**
 * 构建关键词索引（关键词字符串 -> SemanticTokenKind）。
 *
 * @param lexicon - 词法表
 * @returns 关键词索引 Map
 */
export function buildKeywordIndex(lexicon: Lexicon): KeywordIndex {
  const index = new Map<string, SemanticTokenKind>();
  for (const [kind, keyword] of Object.entries(lexicon.keywords)) {
    index.set(keyword.toLowerCase(), kind as SemanticTokenKind);
  }
  return index;
}

/**
 * 获取多词关键词列表（按长度降序，用于最长匹配）。
 *
 * @param lexicon - 词法表
 * @returns 多词关键词数组
 */
export function getMultiWordKeywords(lexicon: Lexicon): string[] {
  return Object.values(lexicon.keywords)
    .filter(kw => kw.includes(' ') || (lexicon.punctuation.markers && kw.includes(lexicon.punctuation.markers.open)))
    .sort((a, b) => b.length - a.length);
}

/**
 * 从关键词查找 SemanticTokenKind。
 *
 * @param lexicon - 词法表
 * @param keyword - 关键词字符串
 * @returns 对应的 SemanticTokenKind，如果不是关键词则返回 undefined
 */
export function findSemanticTokenKind(lexicon: Lexicon, keyword: string): SemanticTokenKind | undefined {
  const lower = keyword.toLowerCase();
  for (const [kind, kw] of Object.entries(lexicon.keywords)) {
    if (kw.toLowerCase() === lower) {
      return kind as SemanticTokenKind;
    }
  }
  return undefined;
}

/**
 * 检查字符串是否为该词法表的关键词。
 *
 * @param lexicon - 词法表
 * @param word - 要检查的字符串
 * @returns 如果是关键词返回 true
 */
export function isLexiconKeyword(lexicon: Lexicon, word: string): boolean {
  const lower = word.toLowerCase();
  return Object.values(lexicon.keywords).some(kw => kw.toLowerCase() === lower);
}
