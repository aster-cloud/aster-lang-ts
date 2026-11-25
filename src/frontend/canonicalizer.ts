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

import { charClassRegex, escapeClose, opaqueRanges } from './name-escape.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { getMultiWordKeywords } from '../config/lexicons/types.js';
import { SemanticTokenKind } from '../config/token-kind.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../config/lexicons/index.js';
import { foldKey } from '../config/lexicons/identifiers/casefold.js';
import { literalsVisibleUnder, type VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
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
export function identifierTokenRegex(): RegExp {
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
  lexicon?: Lexicon | undefined;
  /**
   * 领域词汇作用域。canonicalize 只用其中的字面量宏（触发词展开为字符串字面量）；
   * 标识符不在此替换，由解析后的名称解析按位置处理（ADR 0051）。
   */
  vocabulary?: VocabularyScopes | undefined;
}

// 词法空白只认 ASCII（aster-lang-ts#348，与 aster-lang-core Canonicalizer 对齐）。
//
// ★JS 的 `\s` / trim() 含 Unicode 空白（U+00A0、U+2000–U+200A、U+202F、U+205F、U+1680、
//   U+2028/2029、U+3000、U+FEFF），Java 的 `\s` 只是 ASCII [ \t\n\x0B\f\r]，Java 词法器的空白
//   只有空格与 \t。此前 ts 在「行尾 / 只含空白的行 / 标点前 / 整行注释前」用 JS 口径把这些字符吞掉，
//   同一份源码 ts（编辑器 / LSP）编译通过、Java（生产 aster-api）报 E050。现在这几处一律用 Java 口径，
//   其余 Unicode 空白原样交给词法器报 E050；zh-CN 的 U+3000 由全角转半角先换成空格，不受影响。
//
// 整行注释：行首只允许空格与 \t（Java removeCommentsFromCode 删掉注释后，行首残留的 Unicode 空白照样报 E050）。
const LINE_COMMENT_RE = /^[ \t]*(?:\/\/|#)/;
const SPACE_RUN_RE = /[ \t]+/g;

// 标点字符集合（是否句末两档，与 Java PUNCT_NORMAL_RE / PUNCT_FINAL_RE 同集、不分词法表）。
// 这些集合用于「删除紧邻标点之前的空白」的线性扫描，取代原先
// `/\s+([标点])/g` 形式的正则——后者存在多项式回溯（polynomial ReDoS）风险：
// 对长空白串（其后并非标点）会在每个起点重复贪婪匹配再回退，退化为 O(n²)。
// 线性扫描逐字符处理，语义完全一致（删除标点前的整段空白），且无回溯。
// ★中文标点在本步之前已被 normalizeCJKPunctuation 换成 ASCII，所以 zh-CN 实际命中的是 `.,:`；
//   此前 zh-CN 只认中文标点，ASCII 标点前的空白（含 \x0B \f）一律不删，与 Java 不一致。
const PUNCT_NORMAL_CHARS = '.,:。：，';
const PUNCT_FINAL_CHARS = '.,:!;?。：，！；？';

// 单字符空白判定（在单个字符上求值，无回溯）：Java `\s` 的 ASCII 集合，不含 Unicode 空白。
const WHITESPACE_CHAR_RE = /[ \t\n\v\f\r]/;

/**
 * 「只含空白的行」里的空白：前后都是文本首尾或 Java 行终止符的 [ \t] 串（不用 m 标志：JS 的 m 不认 U+0085）。
 * 后行断言只看一个字符，`[ \t]+` 只在空白串起点展开，线性无回溯。
 */
const BLANK_RUN_RE = /(?<=^|[\n\r\u0085\u2028\u2029])[ \t]+(?=$|[\n\r\u0085\u2028\u2029])/g;

/** 清空字符串外一段代码里只含 [ \t] 的行；atStart / atEnd 表示该段的首 / 尾是否就是全文首 / 尾（否则紧挨着字符串）。 */
function clearBlankRuns(text: string, atStart: boolean, atEnd: boolean): string {
  return text.replace(BLANK_RUN_RE, (run: string, offset: number) => {
    const touchesStart = offset === 0 && !atStart;
    const touchesEnd = offset + run.length === text.length && !atEnd;
    return touchesStart || touchesEnd ? run : '';
  });
}

/** 去掉末尾的 ASCII 空白（Java TRAILING_SPACE_RE 的集合）；从尾部线性回退，无正则回溯。 */
function trimEndAsciiSpace(text: string): string {
  let end = text.length;
  while (end > 0 && WHITESPACE_CHAR_RE.test(text[end - 1]!)) end--;
  return end === text.length ? text : text.slice(0, end);
}

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
  const base = isFinal ? PUNCT_FINAL_CHARS : PUNCT_NORMAL_CHARS;
  // 非 ASCII 句末符（如天城文 danda「।」）：Java 先归一成「.」再去空白，ts 由词法器直接认，故并入集合
  const statementEnd = getEffectiveLexicon(lexicon).punctuation.statementEnd;
  return statementEnd.length === 1 && !base.includes(statementEnd) ? base + statementEnd : base;
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
    // ★`!` 后跟 `=` 时不算标点——那是**不等号运算符** `!=`，不是句末感叹号。
    //   否则 `x != y` 会被改写成 `x!= y`，行缩短一个字符，使其后所有 token 的
    //   origin.col 左移、偏离用户原文（ADR 0032 的 trace 锚点与 ADR 0037 的
    //   OriginMap 都按列定位）。Java 侧同此（Canonicalizer 的 PUNCT_FINAL_RE
    //   用 `!(?!=)` 表达同一规则）。
    //   ★两引擎此前**同时**有这个缺陷、缩短量一致，故跨引擎 parity 一直是绿的
    //     ——一致 ≠ 正确，需与源码文本这一外部基准核对才能发现。
    //   实证：语料中裸 `!`（不在字符串字面量内）只以 `!=` 形态出现。
    const isNotEqualOperator = ch === '!' && text[i + 1] === '=';
    // 命中标点：弹出已输出的尾部空白（对应正则 `\s+` 的贪婪吞噬），O(1) 摊还。
    if (!isNotEqualOperator && punctChars.includes(ch)) {
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
  //
  // ★`not` 必须在列（aster-lang-core#120）：裸 `not equal to`（不带 `is`）是合法比较
  // 运算符，漏掉它会让 `a not equal to b` 的左操作数被当冠词删掉、变成 `not equal to b`。
  // 本引擎表现为编译失败 `Expected '.'`；Java 侧更糟——编译通过且恒返回 true。
  // 注：`a is not equal to b` 本就正常，因为 `is` 已在列。
  const followWords = 'as|be|in|of|and|or|not|plus|minus|times|multiplied|divided|modulo|equals|is|at|greater|less|more|than|to';
  const pattern = `\\b(${articles.join('|')})\\b(?=\\s)(?!\\s+(?:${followWords})\\b)(?!\\s+\\x00)(?![ \\t]*\\n)`;
  return new RegExp(pattern, 'gi');
}

/** 声明关键词：其后紧跟的单词是声明名（类型名 / 函数名）。 */
const DECLARATION_KINDS: readonly SemanticTokenKind[] = [SemanticTokenKind.TYPE_DEF, SemanticTokenKind.FUNC_TO];

/** 某一语义种类的全部单词拼写（主拼写 + 别名，小写）；多词拼写已被 marker 占位，不在此列。 */
function singleWordSpellings(lexicon: Lexicon, kinds: Iterable<SemanticTokenKind>): Set<string> {
  const out = new Set<string>();
  for (const kind of kinds) {
    for (const w of [lexicon.keywords[kind], ...(lexicon.aliases?.[kind] ?? [])]) {
      if (w && !/\s/.test(w)) out.add(w.toLowerCase());
    }
  }
  return out;
}

/**
 * 冠词替换回调：按语法位置保护声明名（`Define A has …`、`Rule a given …`）。
 *
 * 冠词紧跟在声明关键词之后、且其后紧跟一个关键词时，它占的是声明名的位置——
 * 声明名之后只能是关键词或标点，名词短语 `Define a Customer has …` 之后则是名词。
 * 这样不需要为每个可能的后继词扩充 follow 词表；后继词集合直接取自 lexicon 的全部关键词。
 */
function articleReplacer(lexicon: Lexicon): (match: string, ...rest: unknown[]) => string {
  const declKeywords = singleWordSpellings(lexicon, DECLARATION_KINDS);
  const keywords = singleWordSpellings(lexicon, Object.keys(lexicon.keywords) as SemanticTokenKind[]);
  // 前一个词只在冠词前的有限窗口内找（窗口比最长声明关键词多留空白余量），避免每次替换回扫全文
  const prevWordRe = /(?:^|\s)(\S+)[ \t]+$/;
  const nextWordRe = /[ \t]+([^\s.,:;()]+)/y;
  const window = Math.max(0, ...[...declKeywords].map((w) => w.length)) + 16;
  return (match, ...rest) => {
    const text = rest[rest.length - 1] as string;
    const offset = rest[rest.length - 2] as number;
    const start = Math.max(0, offset - window);
    const prev = prevWordRe.exec(text.slice(start, offset));
    // 窗口起点落在词中间时，该「词」只是某个长词的尾部，不算声明关键词
    const cut = prev !== null && prev.index === 0 && start > 0 && !/\s/.test(text[start - 1]!);
    if (!prev || cut || !declKeywords.has(prev[1]!.toLowerCase())) return '';
    nextWordRe.lastIndex = offset + match.length;
    const next = nextWordRe.exec(text);
    return next && keywords.has(next[1]!.toLowerCase()) ? match : '';
  };
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
 * // 带领域词汇（仅展开字面量宏）
 * const withMacros = canonicalize(raw, {
 *   lexicon: ZH_CN,
 *   vocabulary: buildVocabularyScopes(vocab),
 * });
 * ```
 */
export function canonicalize(input: string, lexiconOrOptions?: Lexicon | CanonicalizerOptions): string {
  // 解析参数
  let lexicon: Lexicon | undefined;
  let literals: ReadonlyMap<string, string> | undefined;

  let vocabulary: VocabularyScopes | undefined;
  if (lexiconOrOptions && 'keywords' in lexiconOrOptions) {
    lexicon = lexiconOrOptions as Lexicon;
  } else if (lexiconOrOptions && typeof lexiconOrOptions === 'object') {
    const opts = lexiconOrOptions as CanonicalizerOptions;
    lexicon = opts.lexicon;
    vocabulary = opts.vocabulary;
  }

  // 缓存有效的词法表，确保所有配置访问都使用同一来源
  const effectiveLexicon = getEffectiveLexicon(lexicon);
  // 触发词与关键词同形时关键词优先（ADR 0060 修订 1 R16'）：在本词法表下与关键词同形的触发词不展开
  if (vocabulary) literals = literalsVisibleUnder(vocabulary, effectiveLexicon);
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

  // 引号归一：只改写充当字符串定界符的弯引号，字符串字面量的内容原样保留（见 normalizeQuoteDelimiters）
  s = normalizeQuoteDelimiters(s, quotes);

  // customRules（如德文二合字母 oe→ö/ue→ü/ae→ä）按【词】应用并仅在转写后
  // 落在关键词上时才采纳，避免误伤含这些二合字母的用户标识符
  // （fruehereSchaeden 不再被错写成 frühereSchäden）。预编译 RegExp 仍走缓存。
  if (effectiveLexicon.canonicalization.customRules) {
    // 名字转义不跑 customRules（ADR 0064 N2）：`fuer` 是名字 fuer，不是关键词 für
    s = s.includes('`')
      ? segmentString(s, quotes)
        .map(segment => (segment.escape ? segment.text : applyCustomRulesKeywordGated(segment.text, effectiveLexicon)))
        .join('')
      : applyCustomRulesKeywordGated(s, effectiveLexicon);
  }

  // 翻译前变换器（如英语所有格 driver's age → driver.age）
  if (effectiveLexicon.canonicalization.preTranslationTransformers?.length) {
    s = applyTransformers(s, effectiveLexicon.canonicalization.preTranslationTransformers, quotes, effectiveLexicon);
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
  // 翻译后变换器（如 "The result is X" → "Return X"）。本引擎按 token 翻译关键词，这里源码仍是本地化拼写。
  // ★必须在多词关键词打标记之前执行：RESULT_IS（`the result is` / `Ergebnis ist`）本身是多词关键词，
  //   打上标记后变换器再也匹配不到，启用了也静默无效。也必须在冠词移除之前，否则 "The" 先被删掉。
  if (effectiveLexicon.canonicalization.postTranslationTransformers?.length) {
    s = applyTransformers(s, effectiveLexicon.canonicalization.postTranslationTransformers, quotes, effectiveLexicon);
  }

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

  // Step 2: Remove articles in allowed contexts (lightweight; parser will enforce correctness)
  if (articleRe) {
    const replaceArticle = articleReplacer(effectiveLexicon);
    marked = segmentString(marked, quotes)
      .map(segment => (segment.inString ? segment.text : segment.text.replace(articleRe, replaceArticle)))
      .join('');
  }

  // Step 3: Restore multi-word keywords from markers
  //
  // ★单趟回调替换，**不要**退回「逐个 marker 各扫一遍」的写法：
  //
  //   for (const [marker, keyword] of keywordMarkers) marked = marked.replace(marker, keyword);
  //
  // `.replace(string, string)` 每次都从偏移 0 重扫并**重建整串**。多词关键词
  // （`greater than` / `at least` 等）每出现一次就造一个 marker，故 marker 数 M
  // 随输入长度线性增长 → 总功 **O(M·n)**，实测呈二次。
  //
  // 实测（`If a is greater than b.` 重复，含**对照基线**以证明归因）：
  //   含多词关键词：94KB→31ms、188KB→291ms、375KB→1049ms、750KB→3368ms（每翻倍 ×3.2〜3.6）
  //   等长无关键词：24ms 且 ×1.94（线性）—— 证明慢的是 marker 数而非文件大小
  //
  // ★canonicalize() 是 TS 侧**每一条编译路径**的第一步，输入为用户源码。
  // ★Java 侧同载荷仅 156ms 且线性（未采用 marker 方案）——这是 TS 独有的 21× 分歧。
  //
  // 单趟等价性实证：随机 100000 组（83779 组确有替换，含未登记 marker 原样保留
  // 的用例），与逐个替换逐字节零分歧。
  marked = marked.replace(/\x00KW\d+\x00/g, m => keywordMarkers.get(m) ?? m);
  // 清空「只含空白的行」，但**不得改变行数**。
  //
  // ★原写法 `/^\s+$/gm` 与紧邻的注释「Do not collapse newlines globally」自相矛盾：
  //   `\s` **包含 `\n`**，所以连续空行会被当成**一整块**匹配掉，折叠成一个空串。
  //   实测 'A.\n\n\n\n\nB.\n'（7 行）→ 'A.\n\nB.\n'（4 行）。
  //
  //   而注释先于本步被置空（见上方 LINE_COMMENT_RE 那一步），于是任何 ≥2 行的
  //   注释块/空行块都会让其后**所有**行号整体上移。实测语料 test_claims.aster
  //   经本函数由 115 行降到 91 行，首个 declaration 从第 27 行跑到第 3 行。
  //
  // ★为什么这不只是「排版问题」：Core IR 的 origin.*.line 指的是 canonical 文本
  //   行号，ADR 0032（把执行 trace 锚到源码位置）与 ADR 0037（OriginMap/MappingIR）
  //   都依赖它与用户原文行号一一对应。行号一偏，「点 trace 跳源码」会**静默**
  //   跳到错误的行——不报错、不崩溃，只是指错地方。
  //   Java 侧 canonicalizer 把注释置空但保留行数（115 → 115），故 Java 一直是对的。
  //
  // 与 Java finalWhitespaceNormalization 的 `(?m)^[ \t]+$` 逐段对齐（aster-lang-ts#348）：
  //   - 只认 ASCII 空格与制表符：只含 U+00A0 等 Unicode 空白的行不清空，交给词法器报 E050；
  //   - 只在字符串字面量**之外**清空：此前全局替换会把字符串里两个 U+2028 之间的空格删掉（静默改值）；
  //   - 行界按 Java 的行终止符（\n \r U+0085 U+2028 U+2029）与段首段尾判定，逐行生效、行数不变。
  //   - 段首段尾只在它同时是全文首尾时才算行界：两个字符串之间的空格（`"a" "b"`）不是空行。
  const segments = segmentString(marked, quotes);
  marked = segments
    .map((segment, i) => (segment.inString ? segment.text : clearBlankRuns(segment.text, i === 0, i === segments.length - 1)))
    .join('');

  // 字面量宏展开（词汇中只有它在解析前处理：它决定 token 类别）
  if (literals && literals.size > 0) {
    marked = expandLiteralMacros(marked, literals, quotes);
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
        // 全角反引号 ｀（U+FF40）不折叠：名字转义只认 ASCII 反引号（ADR 0064 Q2），它照旧由词法器报 E050
        : segment.text.replace(/[\u3000\uFF01-\uFF3F\uFF41-\uFF5E]/g, ch =>
            ch === '\u3000' ? ' ' : String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)),
    )
    .join('');
}

/** 一个字符串开引号可被哪些字符闭合（normalizeQuoteDelimiters 的分段规则）。 */
function quoteClosers(opener: string, quotes: { open: string; close: string }): string {
  if (opener === '“') return '”"“';
  return opener === '"' ? '"' : quotes.close;
}

/**
 * 引号归一：弯引号只在充当字符串**定界符**时改写，字符串字面量的**内容**原样保留（aster-lang-ts#347）。
 *
 * 此前整段替换 `“ ” ‘ ’`，字符串里的 `‘x’` 被静默改成 `'x'`，`"说“好”"` 里的弯引号变成 ASCII 引号把字符串截断。
 * 与 Java Canonicalizer.normalizeQuoteDelimiters 采用同一分段规则：
 * - 字符串之外，未转义的词法表开引号、ASCII `"`、左弯引号 `“` 开启字符串；
 * - `"…"` 只由 `"` 闭合，词法表引号对只由其闭引号闭合，内容（含弯引号）不动；
 * - `“…”` 由 `”` `"` `“` 任一闭合：此前三者都被改写成闭引号，凡原先能闭合的写法仍闭合；
 *   定界符换成目标引号，内容不动；
 * - 字符串之外的其余弯引号照旧改写（英语等：`”` → `"`、`‘ ’` → `'`；其他词法表：`”` → 闭引号）。
 *
 * 目标引号：词法表引号为 ASCII `"` 时是 `"`；否则（zh-CN 的 `「」`）`"…"` 与 `“…”` 都换成词法表引号对，
 * 让后续按词法表引号分段的各步把它们当字符串保护。例外：内容里有未转义的词法表闭引号（`"a」b"`、`“a」b”`）时
 * 换成词法表引号会在 `」` 处提前闭合，于是定界符换成 ASCII `"`（与 Java 同样把 `“` `”` 写成 `"`），内容不动；
 * {@link segmentString} 也认 ASCII `"` 字符串，后续各步照样保护它（aster-lang-ts#362 第 3 项）。
 */
function normalizeQuoteDelimiters(text: string, quotes: { open: string; close: string }): string {
  const ascii = quotes.open === '"' && quotes.close === '"';
  const special = charClassRegex(`${quotes.open.length === 1 ? quotes.open : ''}"“”\`${ascii ? '‘’' : ''}`);
  // 只在需要改写的位置切片拼接；其余文本（含名字转义与字符串内容）原样搬运
  const parts: string[] = [];
  let copied = 0;
  let pos = 0;
  while (pos < text.length) {
    special.lastIndex = pos;
    const match = special.exec(text);
    if (match === null) break;
    const i = match.index;
    const ch = text[i]!;
    // 名字转义原样保留（ADR 0064 N2）：里面的弯引号不是定界符，由词法器报 E902
    const escape = ch === '`' ? escapeClose(text, i) : -1;
    pos = escape > 0 ? escape + 1 : i + 1;
    if ((ch === quotes.open || ch === '"' || ch === '“') && !isEscaped(text, i)) {
      pos = normalizeQuotedString(text, i, quotes, parts, copied);
      copied = pos;
      continue;
    }
    const replacement = ch === '”' ? quotes.close : ascii && (ch === '‘' || ch === '’') ? "'" : undefined;
    if (replacement !== undefined) {
      parts.push(text.slice(copied, i), replacement);
      copied = i + 1;
    }
  }
  parts.push(text.slice(copied));
  return parts.join('');
}

/**
 * 改写 openAt 处开始的一个字符串的两端定界符，把 text[copied..闭引号] 写进 parts，返回闭引号之后的位置
 * （未闭合时为文本末尾）。字符串内容原样保留。
 */
function normalizeQuotedString(
  text: string,
  openAt: number,
  quotes: { open: string; close: string },
  parts: string[],
  copied: number,
): number {
  const opener = text[openAt]!;
  // 当前字符串换成的闭引号（词法表闭引号，或内容含词法表闭引号时的 ASCII `"`）
  const close = opener !== quotes.open && containsUnescapedClose(text, openAt, quotes) ? '"' : quotes.close;
  parts.push(text.slice(copied, openAt), opener === quotes.open ? opener : close === '"' ? '"' : quotes.open);
  const closers = charClassRegex(quoteClosers(opener, quotes));
  for (let from = openAt + 1; ; ) {
    closers.lastIndex = from;
    const match = closers.exec(text);
    if (match === null) {
      parts.push(text.slice(openAt + 1));
      return text.length;
    }
    const k = match.index;
    if (!isEscaped(text, k)) {
      parts.push(text.slice(openAt + 1, k), opener === quotes.open ? text[k]! : close);
      return k + 1;
    }
    from = k + 1;
  }
}

/**
 * 从 openAt 处的开引号起，到它的闭引号（或文本末尾）为止，内容里是否有未转义的词法表闭引号。
 * 只对 `"…"` 与 `“…”` 调用；词法表引号为 ASCII 时恒为 false（闭引号就是 `"`，会先闭合）。
 */
function containsUnescapedClose(text: string, openAt: number, quotes: { open: string; close: string }): boolean {
  if (quotes.close === '"') return false;
  const closers = quoteClosers(text[openAt]!, quotes);
  for (let j = openAt + 1; j < text.length; j++) {
    if (isEscaped(text, j)) continue;
    if (closers.includes(text[j]!)) return false;
    if (text[j] === quotes.close) return true;
  }
  return false;
}

/**
 * 源码片段：字符串外的代码，或不透明片段（字符串字面量、名字转义）。名字转义的 inString 也为 true，
 * 所以各步按 inString 跳过字符串的地方同样跳过转义（ADR 0064 N2）；escape 区分两者。
 */
type Segment = { text: string; inString: boolean; escape?: true };


/**
 * 按字符串字面量分段。词法表引号对之外也认 ASCII `"…"`（与 Java Canonicalizer.segmentString 的通用回退一致）：
 * zh-CN 下内容含 `」` 的字符串由 normalizeQuoteDelimiters 保留为 ASCII 定界符，后续各步须同样把它当字符串保护。
 */
function segmentString(text: string, quotes: { open: string; close: string }): Segment[] {
  const pairs = new Map<string, string>([[quotes.open, quotes.close]]);
  if (!pairs.has('"')) pairs.set('"', '"');
  const segments: Segment[] = [];
  let pos = 0;
  for (const range of opaqueRanges(text, pairs)) {
    if (range.start > pos) segments.push({ text: text.slice(pos, range.start), inString: false });
    const opaque = text.slice(range.start, range.end);
    segments.push(range.escape ? { text: opaque, inString: true, escape: true } : { text: opaque, inString: true });
    pos = range.end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), inString: false });
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
        // 去除末尾 ASCII 空白（不用 trimEnd()：它连 Unicode 空白一起去掉，见 WHITESPACE_CHAR_RE）
        normalized = trimEndAsciiSpace(normalized);
      }

      return normalized;
    })
    .join('');
}

/** 一处字面量宏命中：触发词在文本中的 UTF-16 偏移、原样写法与展开值。 */
export interface LiteralMacroRun {
  readonly offset: number;
  readonly text: string;
  readonly value: string;
}

/**
 * 字面量宏在文本中的全部命中（按折叠键匹配完整标识符 token，字符串字面量内部不算），按偏移升序。
 * 是 expandLiteralMacros 的定位步骤本身：展开只是把这些命中换成字符串字面量。
 * LSP 的词汇规范预览（ADR 0058 §8.2）用它对不带词汇的规范化文本取宏位置，与编译器展开的是同一批词。
 */
export function literalMacroRuns(
  source: string,
  literals: ReadonlyMap<string, string>,
  quotes: { open: string; close: string },
): LiteralMacroRun[] {
  // 与 applyCustomRulesKeywordGated 共用同一 token 切分口径（见 identifierTokenRegex）
  const IDENT_RE = identifierTokenRegex();
  const runs: LiteralMacroRun[] = [];
  let base = 0;
  for (const segment of segmentString(source, quotes)) {
    if (!segment.inString) {
      for (const m of segment.text.matchAll(IDENT_RE)) {
        const value = literals.get(foldKey(m[0]));
        if (value !== undefined) runs.push({ offset: base + m.index, text: m[0], value });
      }
    }
    base += segment.text.length;
  }
  return runs;
}

/**
 * 宏值能否写成当前词法表的字符串字面量：非空、无控制字符、不含无从转义的引号字符
 * （「」『』«» 与非 ASCII 的词法表引号；词法器只认 `\"` `\\` 等转义，`\」` 不是合法转义）。
 * 与 Java Canonicalizer.isSafeLiteralContent 同口径。
 */
function isExpandableLiteralContent(value: string, quotes: { open: string; close: string }): boolean {
  if (value.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F「」『』«»]/.test(value)) return false;
  return [quotes.open, quotes.close].every(q => q === '"' || !value.includes(q));
}

/**
 * 字面量宏值写成字符串字面量：词法表引号包裹，`\` 与 `"` 转义（aster-lang-ts#345）。
 *
 * 此前宏值原样拼进引号，词法器再按转义解释：值 `C:\new` 编译成 `C:` + 换行 + `ew`，含 `"` 的值把字符串提前闭合。
 * 转义后词法器读回的正是宏值本身。编译器展开与 LSP 规范预览共用本函数，两者写出的字面量逐字相同。
 * 与 Java Canonicalizer.expandToken 逐字符一致。
 *
 * @throws Error 宏值无法写成字面量（见 isExpandableLiteralContent），与 Java 侧同样失败闭锁
 */
export function literalMacroLiteral(value: string, quotes: { open: string; close: string }): string {
  if (!isExpandableLiteralContent(value, quotes)) {
    throw new Error('Unsafe literal-macro content: empty, or contains control characters or quote characters that cannot be escaped');
  }
  return quotes.open + value.replace(/["\\]/g, '\\$&') + quotes.close;
}

/**
 * 把字面量宏触发词展开为字符串字面量（命中见 literalMacroRuns，写法见 literalMacroLiteral）。
 * 展开结果用当前 lexicon 的引号包裹，后续 segmentString 会把它当作字符串保护。
 */
function expandLiteralMacros(
  source: string,
  literals: ReadonlyMap<string, string>,
  quotes: { open: string; close: string },
): string {
  let out = '';
  let cursor = 0;
  for (const run of literalMacroRuns(source, literals, quotes)) {
    out += source.slice(cursor, run.offset) + literalMacroLiteral(run.value, quotes);
    cursor = run.offset + run.text.length;
  }
  return out + source.slice(cursor);
}
