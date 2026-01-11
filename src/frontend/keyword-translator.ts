/**
 * @module keyword-translator
 *
 * 关键词翻译器：将本地化关键词转换为规范化（英文）关键词。
 *
 * **设计原则**：
 * - 透明层：在 lexer 和 parser 之间插入，保持两者接口不变
 * - 双向映射：支持本地化→规范化（编译）和规范化→本地化（显示）
 * - 幂等性：对英文关键词调用不改变任何内容
 *
 * **工作流程**：
 * 1. Lexer 产生本地化 token（如 `{ kind: IDENT, value: '若' }`）
 * 2. KeywordTranslator 将其转换为规范化 token（如 `{ kind: IDENT, value: 'if' }`）
 * 3. Parser 使用规范化的 token 进行解析
 */

import type { Token } from '../types.js';
import { TokenKind } from './tokens.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { SemanticTokenKind } from '../config/token-kind.js';
import { EN_US } from '../config/lexicons/en-US.js';

/**
 * 关键词映射索引类型。
 *
 * 从本地化关键词（小写）映射到规范化关键词。
 */
export type KeywordTranslationIndex = Map<string, string>;

/**
 * 标记关键词索引类型。
 *
 * 存储被方括号包裹的关键词（如【定义】）的内部值到翻译结果的映射。
 * 例如：'定义' -> 'Define'
 */
export type MarkerKeywordIndex = Map<string, string>;

/**
 * 构建关键词翻译索引。
 *
 * 将源词法表的关键词映射到目标词法表（默认英文）的关键词。
 *
 * @param sourceLexicon - 源词法表（如 zh-CN）
 * @param targetLexicon - 目标词法表（默认 en-US）
 * @returns 翻译索引：源关键词 -> 目标关键词
 */
/**
 * 翻译索引结果。
 */
export interface TranslationIndexResult {
  /** 普通关键词索引：源关键词 -> 目标关键词 */
  index: KeywordTranslationIndex;
  /** 标记关键词索引：方括号内部值 -> 目标关键词 */
  markerIndex: MarkerKeywordIndex;
}

/**
 * 构建关键词翻译索引。
 *
 * 将源词法表的关键词映射到目标词法表（默认英文）的关键词。
 * 同时识别被标记符号包裹的关键词（如【定义】）并建立单独索引。
 *
 * @param sourceLexicon - 源词法表（如 zh-CN）
 * @param targetLexicon - 目标词法表（默认 en-US）
 * @returns 翻译索引：源关键词 -> 目标关键词
 */
export function buildKeywordTranslationIndex(
  sourceLexicon: Lexicon,
  targetLexicon: Lexicon = EN_US
): KeywordTranslationIndex {
  const { index } = buildFullTranslationIndex(sourceLexicon, targetLexicon);
  return index;
}

/**
 * 构建完整的翻译索引（包括普通关键词和标记关键词）。
 *
 * @param sourceLexicon - 源词法表（如 zh-CN）
 * @param targetLexicon - 目标词法表（默认 en-US）
 * @returns 包含普通索引和标记索引的结果
 */
export function buildFullTranslationIndex(
  sourceLexicon: Lexicon,
  targetLexicon: Lexicon = EN_US
): TranslationIndexResult {
  const index = new Map<string, string>();
  const markerIndex = new Map<string, string>();

  // 获取源词法表的标记符号
  const markers = sourceLexicon.punctuation.markers;
  const markerOpen = markers?.open || '【';
  const markerClose = markers?.close || '】';

  // 遍历所有 SemanticTokenKind
  for (const kind of Object.values(SemanticTokenKind)) {
    const sourceKeyword = sourceLexicon.keywords[kind];
    const targetKeyword = targetLexicon.keywords[kind];

    if (sourceKeyword && targetKeyword && sourceKeyword !== targetKeyword) {
      // 检查是否是标记关键词（被【】包裹）
      if (sourceKeyword.startsWith(markerOpen) && sourceKeyword.endsWith(markerClose)) {
        // 提取内部值并添加到标记索引
        const innerValue = sourceKeyword.slice(markerOpen.length, -markerClose.length);
        markerIndex.set(innerValue.toLowerCase(), targetKeyword);
      } else {
        // 普通关键词添加到普通索引
        index.set(sourceKeyword.toLowerCase(), targetKeyword);
      }
    }
  }

  return { index, markerIndex };
}

/**
 * 翻译单个 token 的值。
 *
 * @param token - 要翻译的 token
 * @param index - 翻译索引
 * @returns 翻译后的 token（新对象，不修改原 token）
 */
export function translateToken(token: Token, index: KeywordTranslationIndex): Token {
  // 只翻译标识符类型的 token（关键词在 lexer 中被识别为 IDENT）
  if (
    token.kind !== TokenKind.IDENT &&
    token.kind !== TokenKind.TYPE_IDENT &&
    token.kind !== TokenKind.KEYWORD
  ) {
    return token;
  }

  const value = token.value as string;
  if (!value) return token;

  // 查找翻译（小写匹配）
  const translated = index.get(value.toLowerCase());
  if (!translated) return token;

  // 返回新 token，保持其他属性不变
  return {
    ...token,
    value: translated,
  };
}

/**
 * 翻译 token 流中的所有关键词。
 *
 * @param tokens - 原始 token 数组
 * @param index - 翻译索引
 * @returns 翻译后的 token 数组（新数组，不修改原数组）
 */
export function translateTokens(
  tokens: readonly Token[],
  index: KeywordTranslationIndex
): Token[] {
  return tokens.map(token => translateToken(token, index));
}

/**
 * 翻译 token 流中的所有关键词（包括标记关键词序列）。
 *
 * 此函数会识别 LBRACKET + IDENT + RBRACKET 序列，
 * 如果内部 IDENT 是标记关键词，则将三个 token 合并为单个翻译后的 token。
 *
 * @param tokens - 原始 token 数组
 * @param index - 普通关键词翻译索引
 * @param markerIndex - 标记关键词翻译索引
 * @returns 翻译后的 token 数组（新数组，不修改原数组）
 */
export function translateTokensWithMarkers(
  tokens: readonly Token[],
  index: KeywordTranslationIndex,
  markerIndex: MarkerKeywordIndex
): Token[] {
  const result: Token[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;

    // 检查是否是 LBRACKET + IDENT + RBRACKET 序列
    if (
      token.kind === TokenKind.LBRACKET &&
      i + 2 < tokens.length &&
      (tokens[i + 1]!.kind === TokenKind.IDENT || tokens[i + 1]!.kind === TokenKind.TYPE_IDENT) &&
      tokens[i + 2]!.kind === TokenKind.RBRACKET
    ) {
      const innerToken = tokens[i + 1]!;
      const innerValue = innerToken.value as string;
      const translated = markerIndex.get(innerValue.toLowerCase());

      if (translated) {
        // 找到标记关键词，合并为单个 TYPE_IDENT token
        result.push({
          kind: TokenKind.TYPE_IDENT,
          value: translated,
          start: token.start,
          end: tokens[i + 2]!.end,
        });
        i += 3; // 跳过三个 token
        continue;
      }
    }

    // 普通 token 翻译
    result.push(translateToken(token, index));
    i++;
  }

  return result;
}

/**
 * 创建完整的关键词翻译器。
 *
 * 这是一个高级 API，封装了索引构建和 token 翻译。
 * 支持普通关键词和标记关键词（如【定义】）的翻译。
 *
 * @param sourceLexicon - 源词法表
 * @param targetLexicon - 目标词法表（默认 en-US）
 * @returns 翻译器对象
 */
export function createKeywordTranslator(
  sourceLexicon: Lexicon,
  targetLexicon: Lexicon = EN_US
) {
  const { index, markerIndex } = buildFullTranslationIndex(sourceLexicon, targetLexicon);

  return {
    /** 普通关键词翻译索引 */
    index,

    /** 标记关键词翻译索引（【】包裹的关键词） */
    markerIndex,

    /** 翻译单个 token */
    translateToken: (token: Token): Token => translateToken(token, index),

    /** 翻译 token 数组（包括标记关键词序列处理） */
    translateTokens: (tokens: readonly Token[]): Token[] =>
      translateTokensWithMarkers(tokens, index, markerIndex),

    /** 检查普通关键词是否有翻译 */
    hasTranslation: (value: string): boolean => index.has(value.toLowerCase()),

    /** 获取普通关键词翻译结果 */
    getTranslation: (value: string): string | undefined => index.get(value.toLowerCase()),

    /** 检查标记关键词是否有翻译 */
    hasMarkerTranslation: (value: string): boolean => markerIndex.has(value.toLowerCase()),

    /** 获取标记关键词翻译结果 */
    getMarkerTranslation: (value: string): string | undefined => markerIndex.get(value.toLowerCase()),
  };
}

/**
 * 判断词法表是否需要关键词翻译。
 *
 * 如果源词法表与目标词法表相同（或都是英文），则不需要翻译。
 *
 * @param sourceLexicon - 源词法表
 * @param targetLexicon - 目标词法表（默认 en-US）
 * @returns 如果需要翻译返回 true
 */
export function needsKeywordTranslation(
  sourceLexicon: Lexicon,
  targetLexicon: Lexicon = EN_US
): boolean {
  return sourceLexicon.id !== targetLexicon.id;
}
