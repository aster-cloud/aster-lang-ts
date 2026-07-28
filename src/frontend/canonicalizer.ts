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
import { applyTransformers } from './transformers.js';
import { compileGuardedRegex } from '../config/lexicons/regex-guard.js';
import { createLogger } from '../utils/logger.js';

const canonicalizerLogger = createLogger('canonicalizer');

/**
 * R30+ audit P1：customRules 的 RegExp 原本每次 canonicalize 调用都重新
 * 编译一次。把它按 lexicon-identity 缓存：同一 lexicon 引用复用同一份
 * 编译后的 RegExp 数组。lexicon 在测试或热重载场景下会换引用，WeakMap
 * 让旧 lexicon GC 时缓存条目自动释放，不会泄漏。
 */
const CUSTOM_RULE_REGEX_CACHE = new WeakMap<Lexicon, ReadonlyArray<{ re: RegExp; replacement: string }>>();

/**
 * 关键词「词」集合缓存（应用过 customRules 之后的形态）。
 *
 * customRules（如德文 `oe→ö`/`ue→ü`/`ae→ä`）原本对整段源码做全局替换，会误伤
 * 任何含这些二合字母的【用户标识符】（`fruehereSchaeden`→`frühereSchäden`），
 * 导致标识符与调用方传入的 context 键不匹配。这些转写的本意只是让用户能用 ASCII
 * 输入德文关键词（`hoechstens`→`höchstens`），不该波及标识符。
 *
 * 修复：把 customRules 改为【按词】应用，且仅当某个词转写后的整词是一个【关键词词】
 * 时才保留转写。本集合即所有关键词（含多词关键词拆分出的单词）经 customRules 转写后
 * 的形态，用于判定「转写后是否落在关键词上」。
 */
const KEYWORD_WORD_SET_CACHE = new WeakMap<Lexicon, ReadonlySet<string>>();

/** 把一段文本应用全部（已编译的）customRules，返回转写后的文本。 */
function applyCompiledRules(
  text: string,
  rules: ReadonlyArray<{ re: RegExp; replacement: string }>,
): string {
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.re, rule.replacement);
  }
  return out;
}

/**
 * 构建关键词「词」集合：枚举 lexicon 全部关键词值，按空白拆成单词，对每个单词
 * 应用 customRules 得到转写后形态，全部转小写收集。判定「某词转写后是否是关键词」
 * 时按小写比对。
 */
function getKeywordWordSet(lexicon: Lexicon): ReadonlySet<string> {
  const cached = KEYWORD_WORD_SET_CACHE.get(lexicon);
  if (cached) return cached;
  const rules = compiledCustomRules(lexicon);
  const set = new Set<string>();
  const keywords = lexicon.keywords ?? {};
  for (const value of Object.values(keywords)) {
    if (typeof value !== 'string') continue;
    for (const word of value.split(/\s+/)) {
      if (!word) continue;
      // 同时收集原形与转写后形态，确保 ASCII 关键词输入（hoechstens）和已是
      // 正字形态的关键词（少数 lexicon 直接写 ü）都能命中。
      set.add(word.toLowerCase());
      set.add(applyCompiledRules(word, rules).toLowerCase());
    }
  }
  KEYWORD_WORD_SET_CACHE.set(lexicon, set);
  return set;
}

/**
 * 完整标识符 token 的匹配模式：起头为字母(\p{L})或下划线，后接字母/**组合记号**(\p{M})/
 * **十进制数字**(\p{Nd})/下划线。
 *
 * - 含 `\p{M}`（组合记号）：天城文(Hindi)等印度系文字的元音符号(matra，如 जागे 里的 ◌ा/◌े)
 *   属 Unicode Mark 而非 Letter，不纳入会把 जागे 切成 ज+ग 丢元音 → 标识符/字面量宏永不匹配。
 * - 数字用 `\p{Nd}`（十进制）而非 `\p{N}`：Java 引擎的 Character.isDigit 只认 Nd，用 `\p{N}`
 *   会含 Nl（罗马数字Ⅻ）/No（上标²）→ 与 Java 切分不一致 → parity 漂移（Codex 审查抓出）。
 *   与 Java Canonicalizer.isIdentifierPart（isLetterOrDigit || Mn/Mc/Me）对齐。
 *
 * 注：正则带 `/g` 有 lastIndex 状态，故用工厂每次返回全新实例，避免跨调用串扰。
 */
function identifierTokenRegex(): RegExp {
  return /[\p{L}_][\p{L}\p{M}\p{Nd}_]*/gu;
}

/**
 * 按词应用 customRules：仅当某词转写后的整词是关键词词时才保留转写，否则原样
 * 保留该词。这样关键词（hoechstens→höchstens）照常转写，用户标识符
 * （fruehereSchaeden）不被波及。按完整 identifier token 切分，标点/空白/字符串原样透传。
 *
 * 注意：本函数只在【字符串字面量之外】的文本上调用（调用点已隔离字符串）。
 */
function applyCustomRulesKeywordGated(text: string, lexicon: Lexicon): string {
  const rules = compiledCustomRules(lexicon);
  if (rules.length === 0) return text;
  const keywordWords = getKeywordWordSet(lexicon);
  // 按【完整标识符 token】切分（见 identifierTokenRegex）。否则 `fuer_foo`/`fuer2` 会被拆出
  // 字母段 `fuer` 误转成 `für_foo`/`für2`——整 token 才是判定单位。
  return text.replace(identifierTokenRegex(), (token) => {
    const transliterated = applyCompiledRules(token, rules);
    if (transliterated === token) return token; // 无变化
    // 仅当整 token 转写后是关键词词才采纳，否则保留原标识符（防止误伤）。
    return keywordWords.has(transliterated.toLowerCase()) ? transliterated : token;
  });
}

function compiledCustomRules(lexicon: Lexicon): ReadonlyArray<{ re: RegExp; replacement: string }> {
  const cached = CUSTOM_RULE_REGEX_CACHE.get(lexicon);
  if (cached) return cached;
  const rules = lexicon.canonicalization.customRules ?? [];
  // customRules patterns come from (potentially external) lexicon overlays and
  // run via .replace() against every source line. Validate each against ReDoS
  // shapes / length limits before compiling; skip dangerous or invalid ones.
  const compiled: Array<{ re: RegExp; replacement: string }> = [];
  for (const r of rules) {
    const result = compileGuardedRegex(r.pattern, 'g', `customRule(${lexicon.id})`);
    if (!result.ok) {
      canonicalizerLogger.warn(`Skipping canonicalization custom rule: ${result.error}`);
      continue;
    }
    compiled.push({ re: result.regex, replacement: r.replacement });
  }
  CUSTOM_RULE_REGEX_CACHE.set(lexicon, compiled);
  return compiled;
}

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
  /**
   * 租户标识符。提供时，领域词汇查找优先命中该租户通过
   * `registerCustom` 注册的自定义词汇，未命中再回退到内置词汇。
   * 缺省时仅查内置词汇（保持原有行为）。
   */
  tenantId?: string | undefined;
}

// 默认正则表达式（英语）
const LINE_COMMENT_RE = /^\s*(?:\/\/|#)/;
const SPACE_RUN_RE = /[ \t]+/g;

// 标点字符集合（按语言/是否句末区分）。
// 这些集合用于「删除紧邻标点之前的空白」的线性扫描，取代原先
// `/\s+([标点])/g` 形式的正则——后者存在多项式回溯（polynomial ReDoS）风险：
// 对长空白串（其后并非标点）会在每个起点重复贪婪匹配再回退，退化为 O(n²)。
// 线性扫描逐字符处理，语义完全一致（删除标点前的整段空白），且无回溯。
const PUNCT_NORMAL_CHARS = '.,:';
const PUNCT_FINAL_CHARS = '.,:!;?';

// 中文标点集合
const ZH_PUNCT_NORMAL_CHARS = '。，：、';
const ZH_PUNCT_FINAL_CHARS = '。，：、！；？';

// 单字符空白判定（在单个字符上求值，无回溯）。语义与正则 `\s` 等价。
const WHITESPACE_CHAR_RE = /\s/;

// 行分隔符：正则元字符 `.`（无 s 标志）无法匹配的字符。换行 \n/\r 在
// canonicalize 阶段已被归一并按 \n 切分，此处只可能残留 U+2028/U+2029。
// 用于在 normalizeLine 中复刻原 `/^(\s*)(.*)$/` 遇此类字符整体失配的边界语义。
const LINE_SEPARATOR_RE = /[\n\r\u2028\u2029]/;

/**
 * 获取标点字符集合。
 *
 * @param lexicon - 可选的词法表
 * @param isFinal - 是否为最终标点（包含更多标点符号）
 * @returns 标点字符集合字符串，用于线性扫描判定
 */
function getPunctuationChars(lexicon?: Lexicon, isFinal?: boolean): string {
  const effectiveLexicon = getEffectiveLexicon(lexicon);

  // 根据 whitespaceMode 选择标点集合
  if (effectiveLexicon.canonicalization.whitespaceMode === 'chinese') {
    return isFinal ? ZH_PUNCT_FINAL_CHARS : ZH_PUNCT_NORMAL_CHARS;
  }

  return isFinal ? PUNCT_FINAL_CHARS : PUNCT_NORMAL_CHARS;
}

/**
 * 删除每个标点字符之前紧邻的整段空白（线性扫描，无正则回溯）。
 *
 * 语义等价于 `text.replace(/\s+([标点])/g, '$1')`：对每个属于 `punctChars`
 * 的字符，移除其前面直接相连的、已输出的空白字符序列（贪婪，对应正则 `\s+`）。
 * 无前导空白时不改变（对应正则不匹配）。逐字符一趟扫描，复杂度 O(n)。
 *
 * @param text - 待处理文本（调用方保证不含换行，按行处理）
 * @param punctChars - 标点字符集合
 * @returns 处理后的文本
 */
function stripSpaceBeforePunct(text: string, punctChars: string): string {
  // 用数组累加器（push/pop），末尾拼接一次——真 O(n)。
  // 早期实现用 `out = out.slice(0, end) + ch` 在标点处重建扁平字符串，对标点密集输入退化为
  // O(n²)（消除了正则回溯 ReDoS，却换来 string-op 二次方，CodeQL 不会重新标记 = 假信心）。
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    // 命中标点：弹出已输出的尾部空白（对应正则 `\s+` 的贪婪吞噬），O(1) 摊还。
    if (punctChars.includes(ch)) {
      while (out.length > 0 && WHITESPACE_CHAR_RE.test(out[out.length - 1]!)) {
        out.pop();
      }
    }
    out.push(ch);
  }
  return out.join('');
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

  // 标识符保护——冠词修饰名词才是冠词，否则它是参数名/变量名（标识符），必须保留。
  // 冠词移除发生在多词关键字被 marker (\x00KW…\x00) 占位、运算符仍是词形之后，
  // 故 follow-set = 声明/连接关键字 + 单词运算符/连接词 + marker 占位符。
  //   (?=\s)                  仅在冠词后有空格时考虑移除（逗号/句末/紧贴标点、EOF 天然豁免）
  //   (?!\s+(as|be|plus|…)\b) 后跟声明/连接关键字或单词运算符 → 标识符（如 `a as Int`、`Let a be 1`、`a plus b`）
  //   (?!\s+\x00)             后跟多词关键字 marker（如 `equals to`、`divided by`）→ 标识符
  //   (?![ \t]*\n)            行内空白后即换行 → 行末标识符（如 `Return a\n`）；只认 [ \t] 不认 \s
  const followWords = 'as|be|in|of|and|or|plus|minus|times|multiplied|divided|modulo|equals|is|at|greater|less|more|than|to';
  const pattern = `\\b(${articles.join('|')})\\b(?=\\s)(?!\\s+(?:${followWords})\\b)(?!\\s+\\x00)(?![ \\t]*\\n)`;
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
      // 通过 getWithCustom 先查租户自定义词汇、再回退内置；tenantId
      // 缺省时该方法等价于仅查内置（getIndex 老行为）。
      identifierIndex = vocabularyRegistry.getWithCustom(
        opts.tenantId,
        opts.domain,
        opts.locale,
      )?.index;
    }
  }

  // 缓存有效的词法表，确保所有配置访问都使用同一来源
  const effectiveLexicon = getEffectiveLexicon(lexicon);
  const quotes = effectiveLexicon.punctuation.stringQuotes;
  const articleRe = getArticleRegex(lexicon);
  const multiWordKeywords = getMultiWordKeywordList(lexicon);
  const punctNormalChars = getPunctuationChars(lexicon, false);
  const punctFinalChars = getPunctuationChars(lexicon, true);

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

  // customRules（如德文二合字母 oe→ö/ue→ü/ae→ä）按【词】应用并仅在转写后
  // 落在关键词上时才采纳，避免误伤含这些二合字母的用户标识符
  // （fruehereSchaeden 不再被错写成 frühereSchäden）。预编译 RegExp 仍走缓存。
  if (effectiveLexicon.canonicalization.customRules) {
    s = applyCustomRulesKeywordGated(s, effectiveLexicon);
  }

  // 翻译前变换器（如英语所有格 driver's age → driver.age）
  if (effectiveLexicon.canonicalization.preTranslationTransformers?.length) {
    s = applyTransformers(s, effectiveLexicon.canonicalization.preTranslationTransformers);
  }

  // 全角转半角（如果配置启用）。传入引号对以保护字符串字面量——
  // 与 Java 侧 fullWidthToHalfWidth 走 segmentString 的行为一致。
  if (effectiveLexicon.canonicalization.fullWidthToHalf) {
    s = fullWidthToHalfWidth(s, effectiveLexicon.punctuation.stringQuotes);
  }

  // CJK 标点软边界归一化：将中文标点替换为英文等价，使后续 token 边界
  // 规则与英文路径完全一致。仅对字符串字面量之外生效。
  //   。→ .   ，→ 空格   ；→ 空格   ：→ :   、→ 空格
  // 设计理由见 ADR-0008。
  if (effectiveLexicon.canonicalization.whitespaceMode === 'chinese') {
    s = normalizeCJKPunctuation(s, quotes);
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
    .map(line => normalizeLine(line, punctNormalChars, false, quotes))
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

  // Step 1: Replace multi-word keywords with markers (sorted by length, longest first).
  // 必须只在字符串字面量**之外**替换：否则含 "greater than" / "at least" / "for each"
  // 等多词关键字的字符串字面量会被大小写改写（如 "Salary Greater Than target" →
  // "...greater than..."）。走 segmentString、跳过 inString 段（与冠词移除 pass 一致）。
  const sortedKeywords = [...multiWordKeywords].sort((a, b) => b.length - a.length);
  if (sortedKeywords.length > 0) {
    const keywordRes = sortedKeywords.map(
      phrase => new RegExp(phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'ig'),
    );
    marked = segmentString(marked, quotes)
      .map(segment => {
        if (segment.inString) return segment.text;
        let text = segment.text;
        for (const re of keywordRes) {
          text = text.replace(re, m => {
            const marker = `\x00KW${markerIndex++}\x00`;
            keywordMarkers.set(marker, m.toLowerCase());
            return marker;
          });
        }
        return text;
      })
      .join('');
  }

  // Step 1.5: 翻译后变换器（如 "The result is X" → "Return X", "Set X to Y" → "Let X be Y"）
  // 必须在冠词移除之前执行，否则 "The" 会被先移除导致 result-is 无法匹配
  if (effectiveLexicon.canonicalization.postTranslationTransformers?.length) {
    marked = applyTransformers(marked, effectiveLexicon.canonicalization.postTranslationTransformers);
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
    .map(line => normalizeLine(line, punctFinalChars, true, quotes))
    .join('\n');

  return marked;
}

/**
 * CJK 标点归一化（v2 软边界）。
 *
 * 把中文标点替换为英文等价物，让后续解析路径完全走英文规则。**仅**对
 * 字符串字面量之外的位置生效；字符串内的中文标点 100% 保留原样。
 *
 * 映射：
 *   。→ .（语句终止符）
 *   ：→ :（块起始符）
 *   ，→ ,（列表/字段分隔符）
 *   ；→ ;（块内分隔；保留以备 future use）
 *   、→ ,（枚举分隔，与列表分隔语义等价）
 *
 * 设计选择：
 * - 中文标点与英文标点**逐一对应**，保持 token 流跨语言等价：
 *   en 程序的 `Define X has a, b.` 和 zh 程序的 `定义 X 包含 a，b。`
 *   归一化后产生**相同 token 序列**（除关键字字面量外）。
 * - 这与 fullWidthToHalfWidth 的设计一致（全角→半角是逐字符等价映射）。
 * - 此函数不修改字符串字面量；调用 segmentString 区分内外。
 *
 * 导出此函数是为了支持跨实现 conformance 测试（与 Java
 * Canonicalizer.normalizeCJKPunctuationOnly 字节等价）。
 */
export function normalizeCJKPunctuationOnly(
  text: string,
  quotes: { open: string; close: string } = { open: '「', close: '」' },
): string {
  return normalizeCJKPunctuation(text, quotes);
}

function normalizeCJKPunctuation(
  text: string,
  quotes: { open: string; close: string },
): string {
  const segments = segmentString(text, quotes);
  return segments
    .map(segment => {
      if (segment.inString) {
        // 字符串内的中文标点保留原样
        return segment.text;
      }
      return segment.text
        .replace(/。/g, '.')
        .replace(/：/g, ':')
        .replace(/[，、]/g, ',')
        .replace(/；/g, ';');
    })
    .join('');
}

/**
 * 全角字符转半角：**整个** FF01–FF5E 区间统一减 0xFEE0，外加全角空格 U+3000 → ' '。
 *
 * 与 Java `Canonicalizer.fullWidthToHalfWidthImpl` 逐字符等价。此前 TS 只覆盖
 * 「字母数字 + 11 个硬编码符号」，于是 `．`(FF0E) / `＿`(FF3F) / `％`(FF05) /
 * `　`(U+3000) 等在 Java 侧被归一、TS 侧原样保留——同一份中文源码在两引擎产生
 * 不同 token 序列（issue #85）。
 *
 * ★同时必须走 segmentString 保护字符串字面量。Java 侧 `fullWidthToHalfWidth` 本就
 * 只对 `inString=false` 的段生效，而 TS 此前是**裸调用**：区间一旦扩大，字符串里的
 * 全角文本就会被一并改写（`「全角：％＋１」` → `「全角：％+1」`），那是比原 bug
 * 更糟的数据损坏。故「扩区间」与「加保护」必须在同一次改动里落地，不能拆开。
 *
 * @param str - 输入字符串
 * @param quotes - 字符串字面量引号对，用于区分字面量内外
 * @returns 转换后的字符串
 */
function fullWidthToHalfWidth(
  str: string,
  quotes: { open: string; close: string },
): string {
  return segmentString(str, quotes)
    .map(segment =>
      segment.inString
        // 字符串字面量是用户数据而非语法，保持原样
        ? segment.text
        : segment.text.replace(/[\u3000\uFF01-\uFF5E]/g, ch =>
            ch === '\u3000' ? ' ' : String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)),
    )
    .join('');
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
  punctChars: string,
  trimTrailing: boolean,
  quotes: { open: string; close: string },
): string {
  if (line === '') {
    return line;
  }

  // 拆出前导空白（缩进）与其余内容。原实现 `/^(\s*)(.*)$/` 存在多项式回溯风险
  // （`\s*` 与 `.*` 在空白上重叠，遇行分隔符时 `$` 失败会触发回退）。
  // 调用方保证 line 不含 \n/\r（canonicalize 已归一并按 \n 切分），故：
  //   1) 用锚定的 `/^\s*/`（仅一段贪婪、无后继拒绝元素，线性无回溯）取最长前导空白；
  //   2) 若剩余部分含 `.` 无法匹配的行分隔符（U+2028/U+2029，`\s` 能匹配但 `.` 不能），
  //      原正则会整体失配并返回原行——此处显式保留该边界语义。
  const indentMatch = /^\s*/.exec(line);
  const indent = indentMatch ? indentMatch[0] : '';
  const rest = line.slice(indent.length);
  if (LINE_SEPARATOR_RE.test(rest)) {
    // 对应原 `/^(\s*)(.*)$/` 失配（match 为 null）→ 返回原行不变。
    return line;
  }
  if (rest === '') {
    return indent;
  }

  const normalizedRest = normalizeRest(rest, punctChars, trimTrailing, quotes);
  return indent + normalizedRest;
}

function normalizeRest(
  rest: string,
  punctChars: string,
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
      // 删除标点前空白（线性扫描替代 `/\s+([标点])/g`，消除多项式回溯）
      normalized = stripSpaceBeforePunct(normalized, punctChars);

      if (trimTrailing && index === segments.length - 1) {
        // 去除末尾空白：trimEnd() 的空白集合与正则 `\s`（WhiteSpace ∪ LineTerminator）
        // 按 ECMAScript 规范完全一致，等价于原 `/\s+$/g` 且线性无回溯。
        normalized = normalized.trimEnd();
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
      return translateIdentifiersInSegment(segment.text, index, quotes);
    })
    .join('');
}

/**
 * 翻译单个代码片段中的标识符。
 *
 * 识别标识符边界（字母/下划线/中文字符序列），
 * 用词汇表索引将本地化名称替换为规范化名称。
 */
function translateIdentifiersInSegment(
  text: string,
  index: IdentifierIndex,
  quotes: { open: string; close: string },
): string {
  // 标识符匹配模式：与 applyCustomRulesKeywordGated 共用同一 token 切分口径（见
  // identifierTokenRegex 的详细说明——含 \p{M} 支持天城文 matra、用 \p{Nd} 对齐 Java isDigit）。
  // 原先硬编码 [a-zA-Z_\u4e00-\u9fa5] 只认 ASCII+CJK，导致 Hindi 等脚本的标识符/字面量宏永不匹配。
  const IDENT_RE = identifierTokenRegex();

  return text.replace(IDENT_RE, match => {
    const key = match.toLowerCase();
    const canonical = index.toCanonical.get(key);
    if (canonical === undefined) return match;
    // 字面量宏（IdentifierKind.LITERAL）：把 toCanonical 里的内容用当前 lexicon 的
    // stringQuotes 包裹展开成字符串字面量（<open>content<close>），使其被后续
    // segmentString 正确保护——而非当作普通标识符原样插入。
    if (index.literals.has(key)) {
      return `${quotes.open}${canonical}${quotes.close}`;
    }
    return canonical;
  });
}
