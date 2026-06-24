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
import { compileGuardedRegex } from '../config/lexicons/regex-guard.js';
import { createLogger } from '../utils/logger.js';

const keywordTranslatorLogger = createLogger('keyword-translator');

/**
 * 翻译后根据目标值推断正确的 token kind。
 *
 * 非拉丁文 lexer 无法区分 IDENT 和 TYPE_IDENT（因为无大小写概念），
 * 翻译为英文后需要根据首字母大小写修正 kind。
 */
function inferTokenKind(translatedValue: string, originalKind: TokenKind): TokenKind {
  if (originalKind !== TokenKind.IDENT && originalKind !== TokenKind.TYPE_IDENT) {
    return originalKind;
  }
  const firstChar = translatedValue.charAt(0);
  if (firstChar >= 'A' && firstChar <= 'Z') {
    return TokenKind.TYPE_IDENT;
  }
  return TokenKind.IDENT;
}

/**
 * OF 家族关键词种类（`X of expr` 构造器：result/option/ok/err/some of）——其英文首词是
 * 普通 IDENT，与用户标识符真撞名。仅对这些关键词在标识符位置还原 originalValue，
 * 与 aster-lang-core 引擎口径一致（结构短语如"as one of"/"the result is"不在此列，
 * 当字段名两引擎都不还原，保持 parity）。
 */
const OF_FAMILY_KINDS: ReadonlySet<SemanticTokenKind> = new Set([
  SemanticTokenKind.RESULT_OF,
  SemanticTokenKind.OPTION_OF,
  SemanticTokenKind.OK_OF,
  SemanticTokenKind.ERR_OF,
  SemanticTokenKind.SOME_OF,
]);

const OF_FAMILY_SOURCE_CACHE = new WeakMap<Lexicon, ReadonlySet<string>>();

/** 从词法表取 OF 家族关键词的源词集合（小写），用于把 originalValue 还原限定在 OF 家族。 */
function getOfFamilySourceWords(lexicon: Lexicon): ReadonlySet<string> {
  const cached = OF_FAMILY_SOURCE_CACHE.get(lexicon);
  if (cached) return cached;
  const set = new Set<string>();
  for (const kind of OF_FAMILY_KINDS) {
    const v = lexicon.keywords[kind];
    if (typeof v === 'string' && v) set.add(v.toLowerCase());
  }
  OF_FAMILY_SOURCE_CACHE.set(lexicon, set);
  return set;
}

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
  // 记录已添加映射的优先级
  const indexPriority = new Map<string, boolean>();

  // 获取源词法表的标记符号
  const markers = sourceLexicon.punctuation.markers;
  const markerOpen = markers?.open || '【';
  const markerClose = markers?.close || '】';

  // 构建规范化规则（从词法表的 customRules 中提取简单替换规则）
  const canonRules: { pattern: RegExp; replacement: string }[] = [];
  if (sourceLexicon.canonicalization?.customRules) {
    for (const rule of sourceLexicon.canonicalization.customRules) {
      if (rule.pattern && rule.replacement) {
        // Patterns come from (potentially external) lexicon overlays and run
        // per keyword. Validate against ReDoS shapes / length and surface
        // failures via the logger instead of silently swallowing them.
        const result = compileGuardedRegex(rule.pattern, 'g', `customRule(${sourceLexicon.id})`);
        if (!result.ok) {
          keywordTranslatorLogger.warn(`Skipping canonicalization rule: ${result.error}`);
          continue;
        }
        canonRules.push({ pattern: result.regex, replacement: rule.replacement });
      }
    }
  }

  /**
   * 应用词法表的规范化规则（如 ue→ü, oe→ö, ae→ä）到关键词，
   * 使翻译索引同时包含 ASCII 形式和规范化形式。
   */
  function applyCanonRules(text: string): string {
    let result = text;
    for (const rule of canonRules) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, rule.replacement);
    }
    return result;
  }

  /**
   * 向索引中添加映射，遵循优先级规则。
   * 同时添加规范化变体（如 "zurueck" 和 "zurück"）。
   */
  function addToIndex(srcLower: string, target: string, isHighPriority: boolean): void {
    const existingPriority = indexPriority.get(srcLower);
    if (!index.has(srcLower) || (isHighPriority && !existingPriority)) {
      index.set(srcLower, target);
      indexPriority.set(srcLower, isHighPriority);
    }
    // 同时添加规范化变体
    if (canonRules.length > 0) {
      const canonicalized = applyCanonRules(srcLower);
      if (canonicalized !== srcLower) {
        const canonExistingPriority = indexPriority.get(canonicalized);
        if (!index.has(canonicalized) || (isHighPriority && !canonExistingPriority)) {
          index.set(canonicalized, target);
          indexPriority.set(canonicalized, isHighPriority);
        }
      }
    }
  }

  // 两阶段构建：先添加多词分解（低优先级），再添加直接映射（覆盖）。
  // 这确保单词 "als" 的直接映射 (IMPORT_ALIAS → "as") 不会被
  // 多词短语 "groesser als" → "greater than" 的逐词分解覆盖。

  // 收集待处理的映射
  const directMappings: { src: string; tgt: string }[] = [];
  const wordPartMappings: { src: string; tgt: string }[] = [];

  for (const kind of Object.values(SemanticTokenKind)) {
    const sourceKeyword = sourceLexicon.keywords[kind];
    const targetKeyword = targetLexicon.keywords[kind];

    if (sourceKeyword && targetKeyword && sourceKeyword !== targetKeyword) {
      // 检查是否是标记关键词（被【】包裹）
      if (sourceKeyword.startsWith(markerOpen) && sourceKeyword.endsWith(markerClose)) {
        const innerValue = sourceKeyword.slice(markerOpen.length, -markerClose.length);
        markerIndex.set(innerValue.toLowerCase(), targetKeyword);
      } else {
        directMappings.push({ src: sourceKeyword.toLowerCase(), tgt: targetKeyword });

        // 多词短语逐词分解
        const sourceParts = sourceKeyword.toLowerCase().split(/\s+/);
        const targetParts = targetKeyword.toLowerCase().split(/\s+/);
        if (sourceParts.length > 1 && sourceParts.length === targetParts.length) {
          for (let i = 0; i < sourceParts.length; i++) {
            const srcWord = sourceParts[i]!;
            const tgtWord = targetParts[i]!;
            if (srcWord !== tgtWord) {
              wordPartMappings.push({ src: srcWord, tgt: tgtWord });
            }
          }
        }
      }
    }
  }

  // 阶段 1：添加逐词分解（低优先级，可被覆盖）
  for (const { src, tgt } of wordPartMappings) {
    addToIndex(src, tgt, false);
  }

  // 阶段 2：添加直接映射（覆盖逐词分解）
  for (const { src, tgt } of directMappings) {
    // 直接映射始终为高优先级，覆盖逐词分解
    addToIndex(src, tgt, true);
  }

  // 阶段 3：别名 → 目标规范关键词（ADR 0022）。别名只在识别侧，归一成规范拼写后
  // 再进下游 → IR 零损。对英文源（aliases 在 en-US 自身），target=本语言规范拼写；
  // 对非英文源，target=英文规范关键词（与 keywords 同走 targetLexicon）。直接映射，
  // 高优先级，但不覆盖已存在的规范映射（校验已保证别名不遮蔽规范拼写）。
  if (sourceLexicon.aliases) {
    for (const kind of Object.values(SemanticTokenKind)) {
      const aliasList = sourceLexicon.aliases[kind];
      if (!aliasList || aliasList.length === 0) {
        continue;
      }
      const targetKeyword = targetLexicon.keywords[kind];
      if (!targetKeyword) {
        continue;
      }
      for (const alias of aliasList) {
        const srcLower = alias.toLowerCase();
        if (srcLower === targetKeyword.toLowerCase()) {
          continue; // 别名恰等于目标规范，无需映射
        }
        if (!index.has(srcLower)) {
          addToIndex(srcLower, targetKeyword, true);
        }
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

  // 返回新 token，修正 kind：翻译后首字母大写的应为 TYPE_IDENT。
  // 注意：OF 家族"关键词当标识符"的 originalValue 还原由 translateTokensWithMarkers
  // 显式处理（按 OF 家族源词集合限定），此单 token 路径不设 originalValue，避免结构短语
  // 被误还原（破坏与 aster-lang-core 的 parity）。
  return {
    ...token,
    kind: inferTokenKind(translated, token.kind),
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
 * 检查 token 是否是可翻译的标识符类型
 */
function isTranslatableToken(token: Token): boolean {
  return (
    token.kind === TokenKind.IDENT ||
    token.kind === TokenKind.TYPE_IDENT ||
    token.kind === TokenKind.KEYWORD
  );
}

/**
 * 翻译 token 流中的所有关键词（包括标记关键词序列和多词短语）。
 *
 * 此函数处理三种情况：
 * 1. LBRACKET + IDENT + RBRACKET 序列（标记关键词）
 * 2. 多个连续 IDENT token 组成的短语翻译：
 *    - 源和目标词数相同时，逐词翻译（保持 token 数量）
 *    - 源词数多于目标词数时，合并为较少的 token（如 "gib zurück" -> "return"）
 * 3. 单个 token 的翻译
 *
 * @param tokens - 原始 token 数组
 * @param index - 普通关键词翻译索引
 * @param markerIndex - 标记关键词翻译索引
 * @returns 翻译后的 token 数组（新数组，不修改原数组）
 */
export function translateTokensWithMarkers(
  tokens: readonly Token[],
  index: KeywordTranslationIndex,
  markerIndex: MarkerKeywordIndex,
  ofFamilySources: ReadonlySet<string> = new Set()
): Token[] {
  const result: Token[] = [];
  let i = 0;

  // 预先计算多词短语的最大长度（用于优化查找）
  let maxPhraseLength = 1;
  for (const key of index.keys()) {
    const wordCount = key.split(/\s+/).length;
    if (wordCount > maxPhraseLength) {
      maxPhraseLength = wordCount;
    }
  }

  while (i < tokens.length) {
    const token = tokens[i]!;

    // 检查是否是 LBRACKET + IDENT + RBRACKET 序列（标记关键词）
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
        // 找到标记关键词
        // 如果翻译结果是多词（如 "this module is"），需要拆分为多个 token
        const targetWords = translated.split(/\s+/);
        if (targetWords.length === 1) {
          // 单词翻译：合并为单个 TYPE_IDENT token
          result.push({
            kind: TokenKind.TYPE_IDENT,
            value: translated,
            start: token.start,
            end: tokens[i + 2]!.end,
          });
        } else {
          // 多词翻译：拆分为多个 IDENT token（第一个保持 TYPE_IDENT）
          const startPos = token.start;
          const endPos = tokens[i + 2]!.end;
          for (let j = 0; j < targetWords.length; j++) {
            result.push({
              kind: j === 0 ? TokenKind.TYPE_IDENT : TokenKind.IDENT,
              value: targetWords[j]!,
              start: startPos,
              end: endPos,
            });
          }
        }
        i += 3; // 跳过三个 token
        continue;
      }
    }

    // 尝试多词短语翻译（从最长匹配开始，贪婪匹配）
    if (isTranslatableToken(token)) {
      let matched = false;

      // 从最长可能的短语开始尝试匹配
      for (let phraseLen = Math.min(maxPhraseLength, tokens.length - i); phraseLen > 1; phraseLen--) {
        // 检查接下来的 token 是否都是可翻译类型
        let allTranslatable = true;
        const phraseTokens: Token[] = [];

        for (let j = 0; j < phraseLen; j++) {
          const t = tokens[i + j]!;
          if (!isTranslatableToken(t)) {
            allTranslatable = false;
            break;
          }
          phraseTokens.push(t);
        }

        if (!allTranslatable) continue;

        // 构建短语并查找翻译
        const phrase = phraseTokens.map(t => (t.value as string).toLowerCase()).join(' ');
        const translated = index.get(phrase);

        if (translated) {
          // 计算翻译目标的词数
          const targetWords = translated.split(/\s+/);
          const targetWordCount = targetWords.length;

          if (targetWordCount === phraseLen) {
            // 源和目标词数相同：逐词翻译，保持 token 数量
            // 例如 "dieses modul ist" -> "this module is" 保持 3 个 token
            for (let j = 0; j < phraseLen; j++) {
              const srcToken = phraseTokens[j]!;
              result.push({
                kind: srcToken.kind,
                value: targetWords[j]!,
                start: srcToken.start,
                end: srcToken.end,
              });
            }
          } else if (targetWordCount < phraseLen) {
            // 目标词数少于源词数：合并为较少的 token
            // 例如 "gib zurück" (2) -> "return" (1)
            // 为每个目标词创建一个 token，位置信息从源 token 分配
            for (let j = 0; j < targetWordCount; j++) {
              // 计算每个目标词对应的源 token 范围
              const srcStartIdx = Math.floor(j * phraseLen / targetWordCount);
              const srcEndIdx = Math.floor((j + 1) * phraseLen / targetWordCount) - 1;
              const srcStartToken = phraseTokens[srcStartIdx]!;
              const srcEndToken = phraseTokens[srcEndIdx]!;
              result.push({
                kind: srcStartToken.kind,
                value: targetWords[j]!,
                start: srcStartToken.start,
                end: srcEndToken.end,
              });
            }
          } else {
            // 目标词数多于源词数（如中文 "至少" -> 英文 "at least"）
            // 需要拆分为多个 token
            const firstToken = phraseTokens[0]!;
            const lastToken = phraseTokens[phraseLen - 1]!;
            for (let j = 0; j < targetWordCount; j++) {
              result.push({
                kind: firstToken.kind,
                value: targetWords[j]!,
                start: firstToken.start,
                end: lastToken.end,
              });
            }
          }

          i += phraseLen; // 跳过所有匹配的 token
          matched = true;
          break;
        }
      }

      if (matched) continue;
    }

    // 普通单 token 翻译（需要处理单词→多词的情况，如 "至少" → "at least"）
    if (isTranslatableToken(token)) {
      const value = token.value as string;
      const valueLower = value.toLowerCase();

      // 上下文敏感翻译：处理 allowedDuplicates 冲突
      // 例如：中文 "为" 同时用于 WHEN 和 BE，需要根据前一个 token 判断
      // - 在 "let x 为 ..." 结构中，"为" → "be"
      // - 否则，"为" → "when"（默认，用于 match 块）
      let translated = index.get(valueLower);
      if (translated?.toLowerCase() === 'when' && result.length >= 2) {
        // 在 "令 x 为 ..." 结构中：
        // - result[-1] 是变量名 "x"（IDENT）
        // - result[-2] 是关键字 "let"
        // 检查前面第二个 token 是否是 "let"
        const prevPrevToken = result[result.length - 2];
        if (prevPrevToken &&
            (prevPrevToken.kind === TokenKind.IDENT ||
             prevPrevToken.kind === TokenKind.TYPE_IDENT ||
             prevPrevToken.kind === TokenKind.KEYWORD)) {
          const prevPrevValue = (prevPrevToken.value as string).toLowerCase();
          if (prevPrevValue === 'let') {
            // 在 let 上下文中，"为" 翻译为 "be"
            translated = 'be';
          }
        }
      }

      if (translated) {
        // 仅 OF 家族关键词（result/option/ok/err/some of）在标识符位置还原 originalValue，
        // 与 aster-lang-core 口径一致；结构短语不还原，保持双引擎 parity。
        const keepOriginal = ofFamilySources.has(value.toLowerCase());
        const srcOriginal = value;
        const targetWords = translated.split(/\s+/);
        if (targetWords.length > 1) {
          // 单源词→多目标词：拆分为多个 token。OF 家族在首个 token 记 originalValue +
          // transUnitLen，供 parser 在标识符位置还原成单个标识符并跳过整组。
          for (let k = 0; k < targetWords.length; k++) {
            result.push({
              kind: inferTokenKind(targetWords[k]!, token.kind),
              value: targetWords[k]!,
              start: token.start,
              end: token.end,
              ...(k === 0 && keepOriginal
                ? { originalValue: srcOriginal, transUnitLen: targetWords.length }
                : {}),
            });
          }
          i++;
          continue;
        }
        // 单词翻译：OF 家族保留 originalValue 供标识符位置还原（单词关键词其实不会落这里，
        // 但保持逻辑一致）。
        result.push({
          kind: inferTokenKind(translated, token.kind),
          value: translated,
          start: token.start,
          end: token.end,
          ...(keepOriginal ? { originalValue: srcOriginal } : {}),
        });
        i++;
        continue;
      }
    }
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
): {
  index: Map<string, string>;
  markerIndex: Map<string, string>;
  translateToken: (token: Token) => Token;
  translateTokens: (tokens: readonly Token[]) => Token[];
  hasTranslation: (value: string) => boolean;
  getTranslation: (value: string) => string | undefined;
  hasMarkerTranslation: (value: string) => boolean;
  getMarkerTranslation: (value: string) => string | undefined;
} {
  const { index, markerIndex } = buildFullTranslationIndex(sourceLexicon, targetLexicon);
  const ofFamilySources = getOfFamilySourceWords(sourceLexicon);

  return {
    /** 普通关键词翻译索引 */
    index,

    /** 标记关键词翻译索引（【】包裹的关键词） */
    markerIndex,

    /** 翻译单个 token */
    translateToken: (token: Token): Token => translateToken(token, index),

    /** 翻译 token 数组（包括标记关键词序列处理） */
    translateTokens: (tokens: readonly Token[]): Token[] =>
      translateTokensWithMarkers(tokens, index, markerIndex, ofFamilySources),

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
  // 非英文必翻；英文若带别名也要走翻译，把别名归一成规范拼写（ADR 0022）。
  if (sourceLexicon.id !== targetLexicon.id) {
    return true;
  }
  return sourceLexicon.aliases != null
    && Object.values(sourceLexicon.aliases).some(list => (list?.length ?? 0) > 0);
}
