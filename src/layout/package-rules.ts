/**
 * 策略包（包格式 1.1）的显示排版规则 L1–L9 的字符串部分（ADR 0059 修订 4 §4）。
 *
 * 与 aster-lang-test 参照实现 `scripts/lib/package-v1/display.mjs`、aster-lang-core `aster.core.layout` 同一定义，
 * 三处跑同一组共享向量（`shared/layout-vectors/`）。只用字符串运算、`foldKey` 与标识符字符类 `[\p{L}\p{M}\p{Nd}_]`，
 * 不依赖词法器：值是否被切进结构 span 由 L9 的补空格不变性交给编译器判定（编译在调用方，见 `policy-package/display.ts`）。
 * 平台保存仍用 `validatePolicyLayout`，本文件不改它。纯函数、无 Node 依赖，Workers 可用。
 */
import { foldKey } from '../config/lexicons/identifiers/casefold.js';
import { parseStrictJson } from '../policy-package/strict-json.js';
import { canonicalOf, readLayout, serializeLayout, toCanonical, toDisplay, utf8Length } from './format.js';
import { LAYOUT_LIMITS, LayoutError } from './types.js';
import type { LayoutErrorCode, LayoutLimitName, LayoutRule, LayoutSpan, PolicyLayout } from './types.js';

/** 规则号 → 稳定错误码。 */
const CODE_OF_RULE: Readonly<Record<LayoutRule, LayoutErrorCode>> = {
  L1: 'layout_invalid_format',
  L2: 'layout_too_large',
  L3: 'layout_roundtrip_mismatch',
  L4: 'layout_display_mismatch',
  L5: 'layout_content_parity',
  L6: 'layout_structural_hides_value',
  L7: 'layout_structural_hides_operator',
  L8: 'layout_structural_hides_value',
  L9: 'layout_structural_hides_value',
};

function ruleError(rule: LayoutRule, message: string, limit?: LayoutLimitName): LayoutError {
  return new LayoutError(CODE_OF_RULE[rule], `${rule}: ${message}`, limit === undefined ? { rule } : { rule, limit });
}

/** L7 的 ASCII 运算符字符。 */
export const ASCII_OPERATORS: readonly string[] = ['+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '^', '~'];

/** 结构 canonical 不得含的字符串字面量引号（L5）。 */
const QUOTES = /["“”「」『』]/u;
const IDENT = /[\p{L}\p{M}\p{Nd}_]/u;
const DIGIT = /\p{Nd}/u;

const isContent = (s: LayoutSpan): s is { text: string } => 'text' in s;

/** checkPackageLayout / checkDerivedLayout 用到的词汇与拼写。 */
export interface LayoutRuleContext {
  /** 词汇全部条目（全部 kind，含字面量触发词）的 `localized` */
  readonly vocabularyLocalized: readonly string[];
  /** 包 locale 与 en-US 词法表的 TRUE / FALSE / NULL / NONE 拼写 */
  readonly literalKeywords: readonly string[];
  /** 包 locale 与 en-US 词法表 11 个运算符 kind 的拼写并入 aliasSet 中这些 kind 的别名（ASCII 运算符由本模块并入） */
  readonly operatorSpellings: readonly string[];
}

// ---------------------------------------------------------------------------
// L1：严格 JSON + 结构 + 规范序列化字节
// ---------------------------------------------------------------------------

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const encodeUtf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * L1（与 L2 的序列化字节上限）：先按 serializedBytes 判大小再解析（超出为 L2）；严格 JSON → 结构（readLayout）→
 * 文件字节必须等于 serializeLayout 的 UTF-8。
 */
export function parseLayoutStrict(bytes: Uint8Array): PolicyLayout {
  if (bytes.length > LAYOUT_LIMITS.serializedBytes) {
    throw ruleError('L2', `layout.json exceeds ${LAYOUT_LIMITS.serializedBytes} bytes`, 'serializedBytes');
  }
  let value: unknown;
  try {
    value = parseStrictJson(bytes, { maxDepth: 64 });
  } catch (e) {
    throw ruleError('L1', `layout.json is not strict JSON (${(e as Error).message})`);
  }
  let layout: PolicyLayout;
  try {
    layout = readLayout(value);
  } catch (e) {
    if (e instanceof LayoutError) throw ruleError('L1', e.message);
    throw e;
  }
  if (!bytesEqual(encodeUtf8(serializeLayout(layout)), bytes)) throw ruleError('L1', 'layout.json is not in canonical serialized form');
  return layout;
}

// ---------------------------------------------------------------------------
// L2–L7
// ---------------------------------------------------------------------------

function lineCount(source: string): number {
  if (source === '') return 0;
  const breaks = source.match(/\r\n|\r|\n/g)?.length ?? 0;
  return /[\r\n]$/.test(source) ? breaks : breaks + 1;
}

function storedSpanCount(spans: readonly LayoutSpan[]): number {
  let n = 0;
  let prevText = false;
  for (const s of spans) {
    if (!(isContent(s) && prevText)) n++;
    prevText = isContent(s);
  }
  return n;
}

function maxStructuralDisplayChars(spans: readonly LayoutSpan[]): number {
  let max = 0;
  for (const s of spans) if (!isContent(s)) max = Math.max(max, [...s.display].length);
  return max;
}

/**
 * 源码的字节数与行数。给字节时直接在 policy/policy.aster 的字节上数（0x0A、0x0D 各算一个换行，CRLF 合计一个，
 * 末尾换行不另计一行），非法 UTF-8 的源码同样先过 L2；给文本时按 UTF-8 长度与 \r\n|\r|\n 断行（两者对合法 UTF-8 一致）。
 */
export function sourceMeasures(source: Uint8Array | string): { bytes: number; lines: number } {
  if (typeof source === 'string') return { bytes: utf8Length(source), lines: lineCount(source) };
  if (source.length === 0) return { bytes: 0, lines: 0 };
  let breaks = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === 0x0a) breaks++;
    else if (source[i] === 0x0d) {
      breaks++;
      if (source[i + 1] === 0x0a) i++;
    }
  }
  const last = source[source.length - 1];
  return { bytes: source.length, lines: last === 0x0a || last === 0x0d ? breaks : breaks + 1 };
}

/** L2：六项上限，按 ts assertWithinLimits 的顺序，首个超出即失败；source 为规范源码的文本或字节。 */
export function checkLayoutLimits(layout: PolicyLayout, source: Uint8Array | string): void {
  const src = sourceMeasures(source);
  const measures: Array<[LayoutLimitName, () => number]> = [
    ['sourceBytes', (): number => src.bytes],
    ['sourceLines', (): number => src.lines],
    ['spans', (): number => storedSpanCount(layout.spans)],
    ['serializedBytes', (): number => utf8Length(serializeLayout(layout))],
    ['displayBytes', (): number => utf8Length(toDisplay(layout))],
    ['structuralDisplayChars', (): number => maxStructuralDisplayChars(layout.spans)],
  ];
  for (const [name, measure] of measures) {
    const actual = measure();
    if (actual > LAYOUT_LIMITS[name]) throw ruleError('L2', `${name} ${actual} exceeds ${LAYOUT_LIMITS[name]}`, name);
  }
}

/** ECMAScript String.prototype.trim 所认的空白（WhiteSpace ∪ LineTerminator）。 */
const ES_WHITESPACE: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);
const isEsBlank = (s: string): boolean => [...s].every((ch) => ES_WHITESPACE.has(ch.codePointAt(0)!));

/** L5：结构 canonical 不含引号；至少一个内容 span 去掉 ECMAScript 空白后非空。 */
function checkContentParity(layout: PolicyLayout): void {
  for (const s of layout.spans) {
    if (!isContent(s) && QUOTES.test(s.canonical)) {
      throw ruleError('L5', `structural span canonical contains a string literal quote: ${JSON.stringify(s.canonical)}`);
    }
  }
  if (!layout.spans.some((s) => isContent(s) && !isEsBlank(s.text))) throw ruleError('L5', 'layout has no non-empty content span');
}

const isIdentChar = (ch: string | undefined): boolean => ch !== undefined && IDENT.test(ch);
const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** at 之前一个码点（不存在为 undefined）。 */
function codePointBefore(s: string, at: number): string | undefined {
  if (at <= 0) return undefined;
  if (isLow(s.charCodeAt(at - 1)) && at >= 2 && isHigh(s.charCodeAt(at - 2))) return s.slice(at - 2, at);
  return s[at - 1];
}

function codePointAt(s: string, at: number): string | undefined {
  if (at >= s.length) return undefined;
  return String.fromCodePoint(s.codePointAt(at)!);
}

/** 「整词出现」：needle 出现且前后码点（若有）都不属标识符字符类；两个参数都应已 foldKey，空 needle 永不出现。 */
export function containsWholeWord(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) {
    if (!isIdentChar(codePointBefore(haystack, i)) && !isIdentChar(codePointAt(haystack, i + needle.length))) return true;
  }
  return false;
}

const foldAll = (list: readonly string[]): string[] => [...new Set(list.map(foldKey))].filter((s) => s !== '');

/** L6：结构 canonical 不含 \p{Nd}，不整词出现词汇 localized 与字面量关键词拼写。 */
function checkStructuralValues(layout: PolicyLayout, vocabularyLocalized: readonly string[], literalKeywords: readonly string[]): void {
  const names = foldAll([...vocabularyLocalized, ...literalKeywords]);
  for (const s of layout.spans) {
    if (isContent(s)) continue;
    if (DIGIT.test(s.canonical)) throw ruleError('L6', `structural span canonical contains a digit: ${JSON.stringify(s.canonical)}`);
    const folded = foldKey(s.canonical);
    const hit = names.find((n) => containsWholeWord(folded, n));
    if (hit !== undefined) throw ruleError('L6', `structural span canonical contains ${JSON.stringify(hit)}: ${JSON.stringify(s.canonical)}`);
  }
}

interface OperatorEntry {
  readonly s: string;
  readonly cps: readonly number[];
  readonly word: boolean;
}

/** L7 的运算符表：ASCII 运算符 ∪ 拼写（foldKey、去重），按码点数降序、同长按码点序。 */
export function operatorTable(operatorSpellings: readonly string[]): readonly OperatorEntry[] {
  return foldAll([...ASCII_OPERATORS, ...operatorSpellings])
    .map((s) => ({ s, cps: [...s].map((c) => c.codePointAt(0)!), word: [...s].some(isIdentChar) }))
    .sort((a, b) => {
      if (a.cps.length !== b.cps.length) return b.cps.length - a.cps.length;
      for (let i = 0; i < a.cps.length; i++) if (a.cps[i] !== b.cps[i]) return a.cps[i]! - b.cps[i]!;
      return 0;
    });
}

/** 一段文本的运算符序列（L7）：foldKey 后从左到右扫描，命中即记下并跳过，否则前进一个码点。 */
export function operatorSequence(text: string, table: readonly OperatorEntry[]): string[] {
  const t = foldKey(text);
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    const hit = table.find(
      (op) =>
        t.startsWith(op.s, i) &&
        (!op.word || (!isIdentChar(codePointBefore(t, i)) && !isIdentChar(codePointAt(t, i + op.s.length)))),
    );
    if (hit) {
      out.push(hit.s);
      i += hit.s.length;
    } else {
      i += t.codePointAt(i)! > 0xffff ? 2 : 1;
    }
  }
  return out;
}

/** L7：每个结构 span 的 canonical 与 display 的运算符序列完全相同。 */
function checkOperators(layout: PolicyLayout, operatorSpellings: readonly string[]): void {
  const table = operatorTable(operatorSpellings);
  for (const s of layout.spans) {
    if (isContent(s)) continue;
    const c = operatorSequence(s.canonical, table);
    const d = operatorSequence(s.display, table);
    if (c.length !== d.length || c.some((op, i) => op !== d[i])) {
      throw ruleError('L7', `structural span hides or rewrites an operator: ${JSON.stringify(s.canonical)} -> ${JSON.stringify(s.display)}`);
    }
  }
}

export interface CheckPackageLayoutOptions extends LayoutRuleContext {
  readonly layoutBytes: Uint8Array;
  readonly displayBytes: Uint8Array;
  /** `policy/policy.aster` 的字节，或已严格 UTF-8 解码（不去 BOM）的文本 */
  readonly source: Uint8Array | string;
  /** manifest 的 `display.layoutVersion` */
  readonly layoutVersion: number;
}

/** 包排版 L1–L7（不编译）。成功返回解析后的排版，失败抛带规则号的 LayoutError。 */
export function checkPackageLayout(opts: CheckPackageLayoutOptions): PolicyLayout {
  const layout = parseLayoutStrict(opts.layoutBytes);
  if (layout.v !== opts.layoutVersion) throw ruleError('L1', `layout v ${layout.v} differs from manifest display.layoutVersion ${opts.layoutVersion}`);
  let text: string | null;
  if (typeof opts.source === 'string') text = opts.source;
  else {
    try {
      // 严格 UTF-8、不去 BOM（L3 逐字符比较，开头的 U+FEFF 也算一个字符）
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(opts.source);
    } catch {
      text = null;
    }
  }
  checkLayoutLimits(layout, opts.source);
  if (text === null || toCanonical(layout) !== text) throw ruleError('L3', 'toCanonical(layout) differs from policy/policy.aster');
  if (!bytesEqual(encodeUtf8(toDisplay(layout)), opts.displayBytes)) throw ruleError('L4', 'display.aster differs from toDisplay(layout)');
  checkContentParity(layout);
  checkStructuralValues(layout, opts.vocabularyLocalized, opts.literalKeywords);
  checkOperators(layout, opts.operatorSpellings);
  return layout;
}

/** 派生排版 L′（run --display / show --from-display）：L2、L5、L6、L7。 */
export function checkDerivedLayout(
  layout: PolicyLayout,
  vocabularyLocalized: readonly string[],
  literalKeywords: readonly string[],
  operatorSpellings: readonly string[],
): void {
  checkLayoutLimits(layout, toCanonical(layout));
  checkContentParity(layout);
  checkStructuralValues(layout, vocabularyLocalized, literalKeywords);
  checkOperators(layout, operatorSpellings);
}

// ---------------------------------------------------------------------------
// L8 / L9 的字符串部分
// ---------------------------------------------------------------------------

/** IR 中键为 name 或 written 的全部字符串值，按 JSON 文本中的出现顺序去重。 */
export function irNameStrings(coreIrJson: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'name' || k === 'written') && typeof x === 'string') {
          if (!seen.has(x)) {
            seen.add(x);
            out.push(x);
          }
        } else walk(x);
      }
    }
  };
  walk(JSON.parse(coreIrJson));
  return out;
}

/** L8：整词出现在任一结构 canonical 中的 IR 名字（按 irNames 顺序）。 */
export function structuralNameHits(layout: PolicyLayout, irNames: Iterable<string>): string[] {
  const structural = layout.spans.filter((s) => !isContent(s)).map((s) => foldKey(canonicalOf(s)));
  const hits: string[] = [];
  for (const name of irNames) {
    const n = foldKey(name);
    if (structural.some((c) => containsWholeWord(c, n))) hits.push(name);
  }
  return hits;
}

const isNewline = (c: string | undefined): boolean => c === '\n' || c === '\r';

/** L9 的 P：在结构 span 起止偏移处插入 U+0020（跳过文首文末、换行之后与行首缩进内），按偏移从大到小插入。 */
export function padStructuralSpans(layout: PolicyLayout): string {
  const c = toCanonical(layout);
  const bounds = new Set<number>();
  let at = 0;
  for (const s of layout.spans) {
    const len = canonicalOf(s).length;
    if (!isContent(s)) {
      bounds.add(at);
      bounds.add(at + len);
    }
    at += len;
  }
  const eligible = (p: number): boolean => {
    if (p <= 0 || p >= c.length || isNewline(c[p - 1])) return false;
    for (let q = p - 1; q >= 0 && !isNewline(c[q]); q--) {
      if (c[q] !== ' ' && c[q] !== '\t') return true;
    }
    return false;
  };
  let out = c;
  for (const p of [...bounds].filter(eligible).sort((a, b) => b - a)) out = `${out.slice(0, p)} ${out.slice(p)}`;
  return out;
}

/** 规则号（测试与 CLI 诊断用）：从 LayoutError 取出，非包规则错误为 undefined。 */
export function layoutRuleOf(e: unknown): LayoutRule | undefined {
  return e instanceof LayoutError ? e.rule : undefined;
}
