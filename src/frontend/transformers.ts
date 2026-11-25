/**
 * 语法变换器（Syntax Transformers）
 *
 * 将自然语言风格的表达式转换为规范化的 CNL 语法。
 * 对应 Java 端 aster-lang-core 的 SyntaxTransformer 体系。
 *
 * 变换器分两个阶段执行：
 * - preTranslationTransformers: 关键字翻译前（处理源语言特有的语法糖）
 * - postTranslationTransformers: 关键字翻译后（处理规范化形式的语法糖）
 */

import { escapeClose } from './name-escape.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { SemanticTokenKind } from '../config/token-kind.js';

/** 变换器接口：接收源代码行，返回变换后的行 */
export interface SyntaxTransformer {
  readonly name: string;
  /** 内置变换器自行按完整源码上下文保护字符串，避免切片改变正则锚点语义。 */
  readonly stringSafe?: boolean;
  /** lexicon 为当前词法表；需要按词法表拼写匹配的变换器（如 result-is）据此取关键词，缺省按英文。 */
  transform(source: string, quotes?: { open: string; close: string }, lexicon?: Lexicon): string;
}

// ============================================================
// 内置变换器实现
// ============================================================

/**
 * 英语所有格变换器：`driver's age` → `driver.age`
 *
 * 将英语所有格语法转换为成员访问语法，
 * 使 "The driver's name" 等自然语言表达可被解析为字段访问。
 */
/**
 * ★左锚 `(?<![\p{L}0-9_])` 是 **ReDoS 修复**，不是可选优化。
 *
 * <p>没有它时，`[\p{L}][\p{L}0-9_]*` 可以从标识符**中间**任意位置起跑：引擎在
 * 每个字符位置都重新贪婪吃完整个标识符，再因为后面不是 `'s` 而全部回退，
 * 呈二次增长。实测（未加锚）：10000→160ms、20000→639ms、40000→2552ms，
 * 每翻倍恰好 ×4。
 *
 * <p>攻击载荷就是**一行看起来很普通的源码**：一长串字母后跟一个不闭合的
 * `'s`。本变换器跑在**用户提交的源文本**上，属攻击者可控输入。
 *
 * <h2>★左锚里**只能**排除 `\p{L}`，不能连 `0-9_` 一起排</h2>
 *
 * 我第一版写的是 `(?<![\p{L}0-9_])`，看着更"严密"，实际是**错的**：
 * 模式首字符是 `[\p{L}]`——**不含**数字与下划线。所以 `_x's y` 在旧模式下
 * 是从 `x` 起跑的合法匹配（得 `_x.y`），而多排了 `_` 的左锚会把它整个挡掉。
 *
 * <p>左锚的正确宽度 = 「该模式**首字符**能取的字符集」，多一个字符都是误伤。
 *
 * <p>实证：用偏向 `'s ` 的片段生成器随机 300000 组（其中 16715 组确有替换）：
 * ```
 *   (?<!\p{L})        分歧 0      ✓ 保语义
 *   (?<![\p{L}0-9_])  分歧 1895   ✖ 误伤
 * ```
 * ★这个错误是**等价性检查抓出来的**，人工样本（前 10 组）全绿。
 */
/**
 * 后续标识符只**前瞻**不消费：链式所有格 `driver's car's color` 在同一次
 * replace 里就得到 `driver.car.color`——若把 `$2` 吃掉，`car's` 的 `car` 已被
 * 上一次匹配占用，残留的 `'s` 撞上无撇号词法规则直接 lexer error。
 * 空白限定为 `[ \t]`：行尾所有格不得跨行吞掉下一行行首标识符（与 set-to /
 * result-is 同一取舍）；行尾残留的 `'s` 由此从静默拼接变为显式词法错误。
 * 与 aster-lang-core EnglishPossessiveTransformer 逐字一致（tier1-parity）。
 */
const POSSESSIVE_RE = /(?<!\p{L})([\p{L}][\p{L}0-9_]*)'s[ \t]+(?=[\p{L}])/gu;

const englishPossessive: SyntaxTransformer = {
  name: 'english-possessive',
  stringSafe: true,
  transform(source: string, quotes = { open: '"', close: '"' }): string {
    return replaceOutsideStrings(source, POSSESSIVE_RE, match => `${match[1]}.`, quotes);
  },
};

/**
 * Set-To 变换器：`Set x to expr` → `Let x be expr`
 *
 * 将命令式赋值语法转换为声明式绑定语法。
 */
/**
 * ★缩进捕获组用 `[ \t]*` 而非 `\s*`，这是 **ReDoS 修复**。
 *
 * `\s` 包含 `\n`，在 `m`（multiline）标志下 `^` 会在**每一个**行首匹配，
 * 而 `(\s*)` 又能一路吃穿后续所有空行——于是每个行首都要向后扫描整份剩余
 * 文本，呈二次增长。实测（n 个空行）：10000→165ms、20000→657ms、
 * 40000→2594ms，每翻倍 ×4。攻击载荷是一份**全是空行**的源文件。
 *
 * ★改用「水平空白」不改变语义，反而更准确：这个捕获组的用途是**保留该行的
 * 缩进**（替换串里的 `$1`），缩进按定义只由空格与制表符构成，跨行吃掉换行
 * 本来就是错的。实证：随机 200000 组（95956 组确有替换）逐字节零分歧。
 *
 * ★必须与 Java 侧 `SetToTransformer.SET_TO` 逐字一致——两引擎 canonicalize
 * 输出要字节相同（tier1-parity 门禁）。
 */
const SET_TO_RE = /^([ \t]*)Set\s+([\p{L}][\p{L}0-9_]*)\s+to\s+/gmu;

const setTo: SyntaxTransformer = {
  name: 'set-to',
  stringSafe: true,
  transform(source: string, quotes = { open: '"', close: '"' }): string {
    return replaceOutsideStrings(source, SET_TO_RE, match => `${match[1]}Let ${match[2]} be `, quotes);
  },
};

/**
 * Result-Is 变换器：`The result is expr` → `Return expr`（en-US `the result is`、de-DE `Ergebnis ist`、zh-CN `结果为`）。
 *
 * Java 侧先把本地化的 RESULT_IS 译成 `the result is`，再由 core `ResultIsTransformer` 在两处改写成 `Return`：
 * 行首（`^([ \t]*)The result is[ \t]+`）与逗号之后（Match 分支 `When X, the result is Y`，`(,[ \t]*)the result is[ \t]+`），
 * 大小写不敏感。本引擎按 token 翻译关键词，变换器运行时源码里仍是本地化拼写，所以按词法表的 RESULT_IS 拼写与英文规范拼写
 * 两种写法在同样两处改写，产出与 Java 相同的 token（Java 在任何词法表下也认英文规范拼写）。
 *
 * 分隔空白只认 ASCII 空格与 tab（zh-CN 另认 U+3000），不跨行（aster-lang-ts#348 规则、aster-lang-core#298）：
 * 后跟 VT、FF、换行或其他 Unicode 空白时不改写，由词法 / 语法报错。缩进捕获组同样只认水平空白——`^(\s*)` 在
 * multiline 下会在每个行首起跑并吃穿所有后续空行，呈二次增长（ReDoS）。
 *
 * 大小写不敏感不带 `u` 标志：与 Java `CASE_INSENSITIVE`（无 UNICODE_CASE）一样只做 ASCII 大小写折叠，
 * `ſ`（U+017F）、`K`（U+212A）之类不会被当成 `s` / `k`。
 */
const RESULT_IS_CANONICAL = 'the result is';
const resultIsPatternCache = new Map<string, { lineStart: RegExp; inline: RegExp }>();

function escapeRegex(text: string): string {
  return text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function resultIsPatterns(lexicon: Lexicon | undefined): { lineStart: RegExp; inline: RegExp } {
  const localized = lexicon?.keywords[SemanticTokenKind.RESULT_IS] ?? '';
  const ws = lexicon?.canonicalization.whitespaceMode === 'chinese' ? '[ \\t\\u3000]' : '[ \\t]';
  const key = `${localized}\u0000${ws}`;
  const cached = resultIsPatternCache.get(key);
  if (cached) return cached;
  const spellings = [...new Set([localized, RESULT_IS_CANONICAL].filter(w => w.trim() !== ''))]
    .sort((a, b) => b.length - a.length)
    .map(w => w.trim().split(/\s+/).map(escapeRegex).join(`${ws}+`));
  const phrase = `(?:${spellings.join('|')})${ws}+`;
  const patterns = {
    lineStart: new RegExp(`^(${ws}*)${phrase}`, 'gim'),
    inline: new RegExp(`(,${ws}*)${phrase}`, 'gi'),
  };
  resultIsPatternCache.set(key, patterns);
  return patterns;
}

const resultIs: SyntaxTransformer = {
  name: 'result-is',
  stringSafe: true,
  transform(source: string, quotes = { open: '"', close: '"' }, lexicon?: Lexicon): string {
    const { lineStart, inline } = resultIsPatterns(lexicon);
    const s = replaceOutsideStrings(source, lineStart, match => `${match[1]}Return `, quotes);
    return replaceOutsideStrings(s, inline, match => `${match[1]}Return `, quotes);
  },
};

/**
 * 中文函数头变换器：`规则 名（参数）：` → `Rule 名 given 参数 ：`。
 *
 * 逐字移植 aster-lang-locales `ChineseFunctionSyntaxTransformer`：字符集与 Java 逐项相同（SP 为函数头的空白，
 * LT 为 Java 行终止符），参数 trim 同 Java `String.trim()`，截断规则相同，因此任意输入的输出与 Java 字节相同
 * （见 chinese-function-syntax-parity 夹具）。输出英文 `Rule`/`given` 与 Java 同形；本引擎 zh-CN 词法同样识别这两个英文关键字。
 * 参数须写成 `名 作为 类型`，`名: 类型` 会被重排但语法不接受。
 *
 * 函数头各处的空白（缩进、关键词与名字之间、名字与括号之间、右括号之后）只认 ASCII 空格、tab 与 U+3000，不跨行
 * （aster-lang-ts#348 规则，aster-lang-locales#147）：其他 Unicode 空白原样留下由词法报 E050，换行留给语法报错。
 * 参数组 `[^)）]*?` 可含换行与任意字符。
 *
 * 运行于全角转半角之前，故括号两种宽度都要认；行尾 `：` 与参数间的 `，` 原样留给后续步骤。
 * 不设 stringSafe：与 Java 侧一样经 segmenter 只改写字符串之外的片段。
 */
const SP = ' \\t\\u3000';
const LT = '\\n\\r\\u0085\\u2028\\u2029';
const RULE_FUNC_RE = new RegExp(
  `(?<![^${LT}])([${SP}]*)(?:规则|Rule)[${SP}]+([\\p{L}][\\p{L}0-9_]*)[${SP}]*` +
    `[(（]([^)）]*?)[)）][${SP}]*([^${LT}]*)`,
  'gu',
);
const LT_CHAR = new RegExp(`[${LT}]`, 'u');

/**
 * 截断点：最后一个右括号之后到下一个行终止符（或片段末尾）；无右括号时为 0。
 *
 * 每个匹配都必须含右括号，且以右括号后同一行的剩余部分收尾，所以截断点之后不可能有匹配，
 * 之前的匹配也不会越过截断点。不截断时，最后一个右括号之后每个 `规则 名(` 行首都会让惰性
 * 参数组扫到片段末尾再失败，耗时随源码长度平方增长。
 */
function matchableEnd(s: string): number {
  let i = Math.max(s.lastIndexOf(')'), s.lastIndexOf('）'));
  if (i < 0) return 0;
  i++;
  while (i < s.length && !LT_CHAR.test(s[i]!)) i++;
  return i;
}

/** 同 Java String.trim()：只去掉 U+0000–U+0020，全角空格保留（JS trim 会多去一类）。 */
function javaTrim(s: string): string {
  return s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

export function rewriteRuleFunc(s: string): string {
  const cut = matchableEnd(s);
  if (cut === 0) return s;
  const head = s.slice(0, cut).replace(RULE_FUNC_RE, (_m, indent: string, name: string, rawParams: string, rest: string) => {
    const params = javaTrim(rawParams);
    return params === '' ? `${indent}Rule ${name} ${rest}` : `${indent}Rule ${name} given ${params} ${rest}`;
  });
  return head + s.slice(cut);
}

const chineseFunctionSyntax: SyntaxTransformer = {
  name: 'chinese-function-syntax',
  transform: rewriteRuleFunc,
};

/**
 * zh-CN `结果为 X` → `Return X`（翻译后变换器，aster-lang-ts#357 第 4 行、#362 第 4 项）。
 *
 * Java 侧的效果来自两步：关键词翻译把独立的 `结果为`（RESULT_IS）译成 `the result is`，再由 core `result-is`
 * 改写成 `Return`——行首（`^([ \t]*)The result is\s+`）与逗号之后（Match 分支 `当 X，结果为 Y`，`(,\s*)the result is\s+`）
 * 两处；locales 的 `chinese-result-is` 只是行首兜底。本引擎按 token 翻译关键词，翻译后变换器运行时源码里仍是 `结果为`
 * （全角空格与 `，` 已换成半角），所以这里直接按同样两处改写，产出与 Java 相同的 token。
 *
 * 空白只认 ASCII 空格、tab 与 U+3000（aster-lang-ts#348 规则），不跨行：`结果为` 后跟其他 Unicode 空白、VT、FF 或换行
 * 时不改写，由词法 / 语法报错（core `result-is` 同一规则，aster-lang-core#298）。
 */
const CHINESE_RESULT_IS_LINE_START_RE = /^([ \t\u3000]*)结果为[ \t\u3000]+/gmu;
const CHINESE_RESULT_IS_INLINE_RE = /(,[ \t\u3000]*)结果为[ \t\u3000]+/gu;

const chineseResultIs: SyntaxTransformer = {
  name: 'chinese-result-is',
  stringSafe: true,
  transform(source: string, quotes = { open: '"', close: '"' }): string {
    const s = replaceOutsideStrings(source, CHINESE_RESULT_IS_LINE_START_RE, match => `${match[1]}Return `, quotes);
    return replaceOutsideStrings(s, CHINESE_RESULT_IS_INLINE_RE, match => `${match[1]}Return `, quotes);
  },
};

// ============================================================
// 变换器注册表
// ============================================================

const registry = new Map<string, SyntaxTransformer>();
registry.set('english-possessive', englishPossessive);
registry.set('set-to', setTo);
registry.set('result-is', resultIs);
registry.set('chinese-function-syntax', chineseFunctionSyntax);
registry.set('chinese-result-is', chineseResultIs);

/**
 * 根据名称获取变换器。
 */
export function getTransformer(name: string): SyntaxTransformer | undefined {
  return registry.get(name);
}

/**
 * 注册自定义变换器（供语言包扩展使用）。
 */
export function registerTransformer(transformer: SyntaxTransformer): void {
  registry.set(transformer.name, transformer);
}

/**
 * 按名称列表依次应用变换器到源代码。
 */
export function applyTransformers(
  source: string,
  names: readonly string[],
  quotes: { open: string; close: string } = { open: '"', close: '"' },
  lexicon?: Lexicon,
): string {
  let result = source;
  for (const name of names) {
    const t = registry.get(name);
    if (t) {
      result = t.stringSafe
        ? t.transform(result, quotes, lexicon)
        : transformOutsideStrings(result, quotes, text => t.transform(text, quotes, lexicon));
    }
  }
  return result;
}

/** 按 Java StringSegmenter.segment 的引号与转义规则变换字符串外片段。 */
function transformOutsideStrings(
  source: string,
  quotes: { open: string; close: string },
  transform: (text: string) => string,
): string {
  const quotePairs = new Map<string, string>([[quotes.open, quotes.close]]);
  if (quotes.open !== '"') quotePairs.set('"', '"');
  quotePairs.set('“', '”');

  let output = '';
  let current = '';
  let inString = false;
  let expectedClose = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    // 名字转义是不透明片段（ADR 0064 N2）：与字符串一样原样保留
    const escape = inString ? -1 : escapeClose(source, i);
    if (escape > 0) {
      output += transform(current) + source.slice(i, escape + 1);
      current = '';
      i = escape;
      continue;
    }
    current += ch;

    if (inString) {
      if (ch === expectedClose && !isEscaped(source, i)) {
        output += current;
        current = '';
        inString = false;
        expectedClose = '';
      }
      continue;
    }

    const close = quotePairs.get(ch);
    if (close !== undefined && !isEscaped(source, i)) {
      output += transform(current.slice(0, -1));
      current = ch;
      inString = true;
      expectedClose = close;
    }
  }

  output += inString ? current : transform(current);
  return output;
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

/** 在完整源码上匹配正则，只忽略与字符串区间相交的匹配。 */
function replaceOutsideStrings(
  source: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string,
  quotes: { open: string; close: string },
): string {
  const stringRanges: Array<[number, number]> = [];
  let inString = false;
  let start = -1;
  let expectedClose = '';
  const quotePairs = new Map<string, string>([[quotes.open, quotes.close]]);
  if (quotes.open !== '"') quotePairs.set('"', '"');
  quotePairs.set('“', '”');

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    // 名字转义与字符串一样是不透明区间（ADR 0064 N2）：与之相交的匹配不改写
    const escape = inString ? -1 : escapeClose(source, i);
    if (escape > 0) {
      stringRanges.push([i, escape + 1]);
      i = escape;
      continue;
    }
    if (inString) {
      if (ch === expectedClose && !isEscaped(source, i)) {
        stringRanges.push([start, i + 1]);
        inString = false;
      }
    } else {
      const close = quotePairs.get(ch);
      if (close !== undefined && !isEscaped(source, i)) {
        start = i;
        expectedClose = close;
        inString = true;
      }
    }
  }
  if (inString) stringRanges.push([start, source.length]);

  pattern.lastIndex = 0;
  let rangeIndex = 0;
  return source.replace(pattern, (matched, ...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    const end = offset + matched.length;
    while (rangeIndex < stringRanges.length && stringRanges[rangeIndex]![1] <= offset) rangeIndex++;
    const range = stringRanges[rangeIndex];
    const overlapsString = range !== undefined && offset < range[1] && end > range[0];
    if (overlapsString) return matched;

    const captures = args.slice(0, -2) as string[];
    const groups = [matched, ...captures];
    return replace(groups as unknown as RegExpExecArray);
  });
}
