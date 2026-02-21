/**
 * @module canonicalizer
 *
 * Canonicalizer（规范化器）：将 CNL 源代码规范化为标准格式。
 *
 * **功能**：
 * - 规范化关键字（根据 Lexicon 配置）
 * - 强制语句以句号或冒号结尾
 * - 规范化空白符和缩进（2 空格为标准）
 * - 保留标识符的大小写
 * - 移除注释（`//` 和 `#`）
 * - 去除冠词（根据 Lexicon 配置）
 *
 * **多语言支持**：
 * - 通过 Lexicon 参数支持不同自然语言
 * - 默认使用英语（en-US）词法表
 *
 * **注意**：
 * - Aster 使用 2 空格缩进，缩进具有语法意义
 * - 制表符会被自动转换为 2 个空格
 */

import type { Lexicon } from '../config/lexicons/types.js';
import { getMultiWordKeywords } from '../config/lexicons/types.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../config/lexicons/index.js';
import type { IdentifierIndex } from '../config/lexicons/identifiers/types.js';
import { vocabularyRegistry, initBuiltinVocabularies } from '../config/lexicons/identifiers/registry.js';

/**
 * 规范化器选项。
 */
export interface CanonicalizerOptions {
  /** 词法表，默认使用 en-US */
  lexicon?: Lexicon;
  /** 领域标识符（如 'insurance.auto'），启用标识符翻译 */
  domain?: string;
  /** 语言代码（如 'zh-CN'），与 domain 配合使用 */
  locale?: string;
}

// 默认正则表达式（英语）
const LINE_COMMENT_RE = /^\s*(?:\/\/|#)/;
const SPACE_RUN_RE = /[ \t]+/g;
const PUNCT_NORMAL_RE = /\s+([.,:])/g;
const PUNCT_FINAL_RE = /\s+([.,:!;?])/g;
const TRAILING_SPACE_RE = /\s+$/g;

// 中文标点模式
const ZH_PUNCT_NORMAL_RE = /\s+([。，：、])/g;
const ZH_PUNCT_FINAL_RE = /\s+([。，：、！；？])/g;

/**
 * 获取标点符号正则表达式。
 *
 * @param lexicon - 可选的词法表
 * @param isFinal - 是否为最终标点（包含更多标点符号）
 * @returns 标点符号正则表达式
 */
function getPunctuationRegex(lexicon?: Lexicon, isFinal?: boolean): RegExp {
  const effectiveLexicon = getEffectiveLexicon(lexicon);

  // 根据 whitespaceMode 选择标点模式
  if (effectiveLexicon.canonicalization.whitespaceMode === 'chinese') {
    return isFinal ? ZH_PUNCT_FINAL_RE : ZH_PUNCT_NORMAL_RE;
  }

  return isFinal ? PUNCT_FINAL_RE : PUNCT_NORMAL_RE;
}

/**
 * 获取冠词移除正则表达式。
 *
 * @param lexicon - 可选的词法表
 * @returns 冠词正则表达式，如果语言不支持冠词则返回 null
 */
function getArticleRegex(lexicon?: Lexicon): RegExp | null {
  const effectiveLexicon = getEffectiveLexicon(lexicon);

  if (!effectiveLexicon.canonicalization.removeArticles) {
    return null;
  }

  const articles = effectiveLexicon.canonicalization.articles;
  if (!articles || articles.length === 0) {
    return null;
  }

  const pattern = `\\b(${articles.join('|')})\\b(?=\\s)`;
  return new RegExp(pattern, 'gi');
}

/**
 * 获取有效的词法表（提供的或注册表默认）。
 *
 * @param lexicon - 可选的词法表
 * @returns 有效的词法表
 */
function getEffectiveLexicon(lexicon?: Lexicon): Lexicon {
  if (lexicon) {
    return lexicon;
  }
  // 确保注册表已初始化
  initializeDefaultLexicons();
  return LexiconRegistry.getDefault();
}

/**
 * 获取多词关键字列表（按长度降序排列，用于贪婪匹配）。
 *
 * @param lexicon - 可选的词法表
 * @returns 多词关键字数组
 */
function getMultiWordKeywordList(lexicon?: Lexicon): string[] {
  const effectiveLexicon = getEffectiveLexicon(lexicon);
  return getMultiWordKeywords(effectiveLexicon);
}

// 判断指定位置的引号是否被转义
function isEscaped(str: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && str[i] === '\\'; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

/**
 * 规范化 CNL 源代码为标准格式。
 *
 * 这是 Aster 编译管道的第一步，将原始 CNL 文本转换为规范化的格式，
 * 以便后续的词法分析和语法分析阶段处理。
 *
 * **转换步骤**：
 * 1. 规范化换行符为 `\n`
 * 2. 将制表符转换为 2 个空格
 * 3. 移除行注释（`//` 和 `#`）
 * 4. 规范化引号（智能引号 → 标准引号）
 * 5. 强制语句以句号或冒号结尾
 * 6. 去除冠词（根据语言配置）
 * 7. 规范化多词关键字大小写
 *
 * @param input - 原始 CNL 源代码字符串
 * @param lexiconOrOptions - 可选的词法表或选项对象
 * @returns 规范化后的 CNL 源代码
 *
 * @example
 * ```typescript
 * import { canonicalize } from '@wontlost-ltd/aster-lang';
 *
 * // 英语（默认）
 * const canonical = canonicalize(raw);
 *
 * // 中文
 * import { ZH_CN } from './config/lexicons/zh-CN.js';
 * const zhCanonical = canonicalize(raw, ZH_CN);
 *
 * // 带领域词汇表翻译
 * const withDomain = canonicalize(raw, {
 *   lexicon: ZH_CN,
 *   domain: 'insurance.auto',
 *   locale: 'zh-CN',
 * });
 * ```
 */
export function canonicalize(input: string, lexiconOrOptions?: Lexicon | CanonicalizerOptions): string {
  // 解析参数
  let lexicon: Lexicon | undefined;
  let identifierIndex: IdentifierIndex | undefined;

  if (lexiconOrOptions && 'keywords' in lexiconOrOptions) {
    lexicon = lexiconOrOptions as Lexicon;
  } else if (lexiconOrOptions && typeof lexiconOrOptions === 'object') {
    const opts = lexiconOrOptions as CanonicalizerOptions;
    lexicon = opts.lexicon;
    if (opts.domain && opts.locale) {
      initBuiltinVocabularies();
      identifierIndex = vocabularyRegistry.getIndex(opts.domain, opts.locale);
    }
  }

  // 缓存有效的词法表，确保所有配置访问都使用同一来源
  const effectiveLexicon = getEffectiveLexicon(lexicon);
  const quotes = effectiveLexicon.punctuation.stringQuotes;
  const articleRe = getArticleRegex(lexicon);
  const multiWordKeywords = getMultiWordKeywordList(lexicon);
  const punctNormalRe = getPunctuationRegex(lexicon, false);
  const punctFinalRe = getPunctuationRegex(lexicon, true);

  // Normalize newlines to \n
  let s = input.replace(/\r\n?/g, '\n');

  // Normalize tabs to two spaces (indentation is 2-space significant)
  // Convert all tabs, including leading indentation, to ensure the lexer
  // measures indentation consistently.
  s = s.replace(/\t/g, '  ');

  // Drop line comments (// and #) while 保留换行占位，formatter/LSP 另行处理注释内容
  s = s
    .split('\n')
    .map(line => (LINE_COMMENT_RE.test(line) ? '' : line))
    .join('\n');

  // Normalize smart quotes to target quotes
  // 英语：智能引号 → 直引号
  // 中文：各种引号 → 直角引号（根据 lexicon 配置）
  if (quotes.open === '"' && quotes.close === '"') {
    // 英语：标准化为直引号
    s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  } else {
    // 中文或其他语言：标准化为配置的引号
    // 智能引号明确映射
    s = s.replace(/\u201C/g, quotes.open);   // 左双引号 " → 开引号
    s = s.replace(/\u201D/g, quotes.close);  // 右双引号 " → 闭引号
    // 直引号需要成对处理：奇数位置为开，偶数位置为闭
    s = normalizeAlternatingQuotes(s, '"', quotes.open, quotes.close);
  }

  // 应用 lexicon 的自定义规范化规则
  if (effectiveLexicon.canonicalization.customRules) {
    for (const rule of effectiveLexicon.canonicalization.customRules) {
      const re = new RegExp(rule.pattern, 'g');
      s = s.replace(re, rule.replacement);
    }
  }

  // 全角转半角（如果配置启用）
  if (effectiveLexicon.canonicalization.fullWidthToHalf) {
    s = fullWidthToHalfWidth(s);
  }

  // Ensure lines end with either period or colon before newline if they look like statements
  s = s
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed === '') return line; // keep empty
      // If ends with ':' or '.' already, keep
      if (/[:.]$/.test(trimmed)) return line;
      // 中文标点检查
      if (effectiveLexicon.canonicalization.whitespaceMode === 'chinese') {
        if (/[。：]$/.test(trimmed)) return line;
      }
      // Heuristic: if line appears to open a block (keywords like match/within/to ... produce ...:)
      // We won't add punctuation here; parser will require proper punctuation and offer fix-it.
      return line; // do nothing; errors will prompt fixes
    })
    .join('\n');

  // Fold multiple spaces (but not newlines); keep indentation (2-space rule) for leading spaces only
  s = s
    .split('\n')
    .map(line => normalizeLine(line, punctNormalRe, false, quotes))
    .join('\n');

  // Keep original casing to preserve TypeIdents. We only normalize multi-word keywords by hinting
  // but we leave actual case handling to the parser (case-insensitive compare).
  //
  // To protect multi-word keywords from article removal, we use a marker-based approach:
  // 1. Replace multi-word keywords with unique markers
  // 2. Remove articles
  // 3. Restore multi-word keywords from markers
  let marked = s;
  const keywordMarkers = new Map<string, string>();
  let markerIndex = 0;

  // Step 1: Replace multi-word keywords with markers (sorted by length, longest first)
  const sortedKeywords = [...multiWordKeywords].sort((a, b) => b.length - a.length);
  for (const phrase of sortedKeywords) {
    const re = new RegExp(phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'ig');
    marked = marked.replace(re, m => {
      const marker = `\x00KW${markerIndex++}\x00`;
      keywordMarkers.set(marker, m.toLowerCase());
      return marker;
    });
  }

  // Step 2: Remove articles in allowed contexts (lightweight; parser will enforce correctness)
  if (articleRe) {
    marked = segmentString(marked, quotes)
      .map(segment => (segment.inString ? segment.text : segment.text.replace(articleRe, '')))
      .join('');
  }

  // Step 3: Restore multi-word keywords from markers
  for (const [marker, keyword] of keywordMarkers) {
    marked = marked.replace(marker, keyword);
  }
  // Do not collapse newlines globally.
  marked = marked.replace(/^\s+$/gm, '');

  // 标识符翻译（如果提供了领域词汇表）
  if (identifierIndex) {
    marked = translateIdentifiers(marked, identifierIndex, quotes);
  }

  // Final whitespace normalization to ensure idempotency after article/macro passes
  marked = marked
    .split('\n')
    .map(line => normalizeLine(line, punctFinalRe, true, quotes))
    .join('\n');

  return marked;
}

/**
 * 全角字符转半角（数字和运算符）。
 *
 * @param str - 输入字符串
 * @returns 转换后的字符串
 */
function fullWidthToHalfWidth(str: string): string {
  return str.replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, ch => {
    // 全角数字 0-9：0xFF10-0xFF19 → 0x30-0x39
    // 全角大写字母 A-Z：0xFF21-0xFF3A → 0x41-0x5A
    // 全角小写字母 a-z：0xFF41-0xFF5A → 0x61-0x7A
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }).replace(/[\uFF0B\uFF0D\uFF0A\uFF0F\uFF1D\uFF1C\uFF1E\uFF08\uFF09\uFF3B\uFF3D]/g, ch => {
    // 全角运算符和括号
    const map: Record<string, string> = {
      '\uFF0B': '+', // ＋
      '\uFF0D': '-', // －
      '\uFF0A': '*', // ＊
      '\uFF0F': '/', // ／
      '\uFF1D': '=', // ＝
      '\uFF1C': '<', // ＜
      '\uFF1E': '>', // ＞
      '\uFF08': '(', // （全角左圆括号
      '\uFF09': ')', // ）全角右圆括号
      '\uFF3B': '[', // ［全角左方括号
      '\uFF3D': ']', // ］全角右方括号
    };
    return map[ch] ?? ch;
  });
}

/**
 * 交替规范化直引号。
 *
 * 对于无法区分开闭的直引号，按出现顺序交替替换：
 * 奇数位置（1st, 3rd, ...）→ 开引号
 * 偶数位置（2nd, 4th, ...）→ 闭引号
 *
 * @param str - 输入字符串
 * @param sourceQuote - 要替换的源引号字符
 * @param openQuote - 目标开引号
 * @param closeQuote - 目标闭引号
 * @returns 替换后的字符串
 */
function normalizeAlternatingQuotes(
  str: string,
  sourceQuote: string,
  openQuote: string,
  closeQuote: string,
): string {
  let isOpen = true; // 下一个应该是开引号
  let result = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === sourceQuote && !isEscaped(str, i)) {
      result += isOpen ? openQuote : closeQuote;
      isOpen = !isOpen;
    } else {
      result += ch;
    }
  }

  return result;
}

type Segment = { text: string; inString: boolean };

function segmentString(text: string, quotes: { open: string; close: string }): Segment[] {
  const segments: Segment[] = [];
  let inString = false;
  let current = '';

  const openQuote = quotes.open;
  const closeQuote = quotes.close;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    current += ch;

    if (inString) {
      // 在字符串内，检查结束引号
      if (ch === closeQuote && !isEscaped(text, i)) {
        segments.push({ text: current, inString: true });
        current = '';
        inString = false;
      }
    } else {
      // 在字符串外，检查开始引号
      if (ch === openQuote && !isEscaped(text, i)) {
        const before = current.slice(0, -1);
        if (before) {
          segments.push({ text: before, inString: false });
        }
        current = openQuote;
        inString = true;
      }
    }
  }

  if (current) {
    segments.push({ text: current, inString });
  }

  return segments;
}

function normalizeLine(
  line: string,
  punctuationPattern: RegExp,
  trimTrailing: boolean,
  quotes: { open: string; close: string },
): string {
  if (line === '') {
    return line;
  }

  const match = line.match(/^(\s*)(.*)$/);
  if (!match) {
    return line;
  }

  const indent = match[1] ?? '';
  const rest = match[2] ?? '';
  if (rest === '') {
    return indent;
  }

  const normalizedRest = normalizeRest(rest, punctuationPattern, trimTrailing, quotes);
  return indent + normalizedRest;
}

function normalizeRest(
  rest: string,
  punctuationPattern: RegExp,
  trimTrailing: boolean,
  quotes: { open: string; close: string },
): string {
  const segments = segmentString(rest, quotes);
  if (segments.length === 0) {
    return rest;
  }

  return segments
    .map((segment, index) => {
      if (segment.inString) {
        return segment.text;
      }

      let normalized = segment.text.replace(SPACE_RUN_RE, ' ');
      normalized = normalized.replace(punctuationPattern, '$1');

      if (trimTrailing && index === segments.length - 1) {
        normalized = normalized.replace(TRAILING_SPACE_RE, '');
      }

      return normalized;
    })
    .join('');
}

/**
 * 使用词汇表索引翻译代码中的标识符。
 *
 * 将本地化标识符（如中文）转换为规范化名称（英文）。
 * 字符串字面量内的内容不做翻译。
 */
function translateIdentifiers(
  source: string,
  index: IdentifierIndex,
  quotes: { open: string; close: string },
): string {
  const segments = segmentString(source, quotes);

  return segments
    .map(segment => {
      if (segment.inString) return segment.text;
      return translateIdentifiersInSegment(segment.text, index);
    })
    .join('');
}

/**
 * 翻译单个代码片段中的标识符。
 *
 * 识别标识符边界（字母/下划线/中文字符序列），
 * 用词汇表索引将本地化名称替换为规范化名称。
 */
function translateIdentifiersInSegment(text: string, index: IdentifierIndex): string {
  // 标识符匹配模式：ASCII 标识符 + 中文字符序列
  const IDENT_RE = /[a-zA-Z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*/g;

  return text.replace(IDENT_RE, match => {
    const canonical = index.toCanonical.get(match.toLowerCase());
    return canonical ?? match;
  });
}
