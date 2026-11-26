/**
 * 保存校验 validatePolicyLayout（ADR 0058 §7.5）：cloud 保存与编辑器共用同一实现。
 * 按表中顺序逐条校验，返回第一处失败的稳定码。
 */
import type { Lexicon } from '../config/lexicons/types.js';
import { canonicalOf, readLayout, serializeLayout, toCanonical, toDisplay, utf8Length } from './format.js';
import { LAYOUT_LIMITS, LayoutError } from './types.js';
import type { LayoutLimitName, LayoutSpan, LayoutValidation, PolicyLayout } from './types.js';
import { valueTokenRanges, withAliasSet } from './value-tokens.js';
import { checkHiddenEscapes, hiddenEscapeTriples } from './package-rules.js';
import type { DomainVocabulary } from '../config/lexicons/identifiers/types.js';
import { CompileFailure, compileSource, positionFreeSha256 } from '../policy-package/compile-source.js';

/**
 * L10b 的编译输入（ADR 0059 修订 5 §4.2）：与版本源码相同的 locale、aliasSet、allowStructural 与词汇。cloud 保存与导出传入版本的
 * 编译上下文；不传时含隐藏转义符的排版一律以 layout_hidden_escape_changes_program 拒绝（失败封闭）。
 */
export interface LayoutCompileContext {
  readonly locale: string;
  readonly aliasSet?: Record<string, string[]> | null;
  readonly allowStructural?: boolean;
  readonly vocabulary?: DomainVocabulary | null;
}

/** 按编译上下文编译一份源码的 positionFreeSha256；编译失败为 undefined。 */
function compilerFor(context: LayoutCompileContext): (source: string) => string | undefined {
  return (source) => {
    try {
      return positionFreeSha256(compileSource(source, {
        locale: context.locale,
        ...(context.aliasSet ? { aliasSet: context.aliasSet } : {}),
        ...(context.allowStructural !== undefined ? { allowStructural: context.allowStructural } : {}),
        ...(context.vocabulary ? { vocabulary: context.vocabulary } : {}),
      }));
    } catch (e) {
      if (e instanceof CompileFailure) return undefined;
      throw e;
    }
  };
}

/**
 * Lint：至少一个非空内容 span；结构 span 的 canonical 不含字符串字面量的引号。
 * 对策略是 `layout_content_parity` 硬规则；单独使用时只是一道轻量闸，不是安全证明。
 */
export function verifyContentParity(layout: PolicyLayout): { ok: true } | { ok: false; reason: string } {
  for (const s of layout.spans) {
    // ASCII 直引号、弯引号与中文「」『』——字面量是内容，须走内容 span
    if ('canonical' in s && /["“”「」『』]/u.test(s.canonical)) {
      return { ok: false, reason: `structural span canonical contains a string literal quote: ${JSON.stringify(s.canonical)}` };
    }
  }
  if (!layout.spans.some((s) => 'text' in s && s.text.trim() !== '')) {
    return { ok: false, reason: 'layout has no non-empty content span' };
  }
  return { ok: true };
}

/** 源码行数：按 \r\n、\r、\n 断行，末尾换行不另计一行；空源码为 0 行 */
function lineCount(source: string): number {
  if (source === '') return 0;
  const breaks = source.match(/\r\n|\r|\n/g)?.length ?? 0;
  return /[\r\n]$/.test(source) ? breaks : breaks + 1;
}

function tooLarge(limit: LayoutLimitName, actual: number): LayoutError {
  return new LayoutError('layout_too_large', `${limit} ${actual} exceeds ${LAYOUT_LIMITS[limit]}`, { limit });
}

/** 存储形态（相邻内容 span 合并后）的 span 数：结构 span 各计一个，连续的内容 span 合计一个 */
function storedSpanCount(spans: readonly LayoutSpan[]): number {
  let n = 0;
  let prevText = false;
  for (const s of spans) {
    const isText = 'text' in s;
    if (!(isText && prevText)) n++;
    prevText = isText;
  }
  return n;
}

/** 单个结构 span 的 display 码点数的最大值（逐个迭代，不把整个数组展开成实参） */
function maxStructuralDisplayChars(spans: readonly LayoutSpan[]): number {
  let max = 0;
  for (const s of spans) {
    if (!('text' in s)) max = Math.max(max, [...s.display].length);
  }
  return max;
}

/**
 * §7.6：上限按存储形态计，按表中顺序逐项检查、首个超出即返回。每项只在前面各项通过后才计算，
 * 于是先查源码与 span 数这类便宜的上限，后面按 span 逐个计算的指标只面对上限内的 span 数。
 */
function assertWithinLimits(layout: PolicyLayout, source: string): void {
  const measures: Array<[LayoutLimitName, () => number]> = [
    ['sourceBytes', (): number => utf8Length(source)],
    ['sourceLines', (): number => lineCount(source)],
    ['spans', (): number => storedSpanCount(layout.spans)],
    ['serializedBytes', (): number => utf8Length(serializeLayout(layout))],
    ['displayBytes', (): number => utf8Length(toDisplay(layout))],
    ['structuralDisplayChars', (): number => maxStructuralDisplayChars(layout.spans)],
  ];
  for (const [limit, measure] of measures) {
    const actual = measure();
    if (actual > LAYOUT_LIMITS[limit]) throw tooLarge(limit, actual);
  }
}

function assertRoundtrip(layout: PolicyLayout, source: string): void {
  const canonical = toCanonical(layout);
  if (canonical === source) return;
  let i = 0;
  while (i < canonical.length && i < source.length && canonical[i] === source[i]) i++;
  throw new LayoutError('layout_roundtrip_mismatch', `layout canonical differs from source at offset ${i}`, { offset: i });
}

/** 值 token 与结构 span 重叠即拒绝；偏移报值 token 的起点 */
function assertStructuralHidesNoValue(layout: PolicyLayout, source: string, lexicon: Lexicon): void {
  const structural: Array<readonly [number, number]> = [];
  let at = 0;
  for (const span of layout.spans) {
    const len = canonicalOf(span).length;
    if (!('text' in span)) structural.push([at, at + len]);
    at += len;
  }
  if (structural.length === 0) return;
  const values = valueTokenRanges(source, lexicon, structural);
  if (values === null) {
    throw new LayoutError('layout_structural_hides_value', 'source cannot be tokenized; structural spans cannot be verified', {
      offset: structural[0]![0],
    });
  }
  for (const [vs, ve] of values) {
    const hit = structural.find(([ss, se]) => Math.max(vs, ss) < Math.min(ve, se));
    if (hit) {
      throw new LayoutError(
        'layout_structural_hides_value',
        `structural span [${hit[0]}, ${hit[1]}) overlaps value ${JSON.stringify(source.slice(vs, ve))}`,
        { offset: vs },
      );
    }
  }
}

/**
 * 校验一个 layout 能否随 `source` 保存。`lexicon` 为版本 locale 的词法表，`aliasSet` 为该版本冻结的
 * 关键词别名（kind → 别名列表），与词法表自带的别名取并集。
 *
 * 隐藏转义符（ADR 0059 修订 5 L10）：L10a 总是检查（`layout_escape_delimiter_invalid`）；`compileContext` 给出时编译去掉反引号的
 * 各个变体检查 L10b（`layout_hidden_escape_changes_program`，至多 16 次编译，只在排版含三元组时发生）；不给时含三元组即以
 * L10b 拒绝。
 */
export function validatePolicyLayout(
  layout: PolicyLayout,
  source: string,
  lexicon: Lexicon,
  aliasSet?: Record<string, string[]>,
  compileContext?: LayoutCompileContext,
): LayoutValidation {
  try {
    const checked = readLayout(layout);
    assertWithinLimits(checked, source);
    assertRoundtrip(checked, source);
    const triples = hiddenEscapeTriples(checked);
    assertStructuralHidesNoValue(checked, source, withAliasSet(lexicon, aliasSet));
    const parity = verifyContentParity(checked);
    if (!parity.ok) throw new LayoutError('layout_content_parity', parity.reason);
    if (triples.length > 0) {
      if (!compileContext) {
        throw new LayoutError('layout_hidden_escape_changes_program', 'hidden escape delimiters need the compile context to be checked', { rule: 'L10b' });
      }
      checkHiddenEscapes(checked, compilerFor(compileContext));
    }
    return { ok: true };
  } catch (e) {
    if (!(e instanceof LayoutError)) throw e;
    return {
      ok: false,
      code: e.code,
      message: e.message,
      ...(e.offset !== undefined ? { offset: e.offset } : {}),
      ...(e.limit !== undefined ? { limit: e.limit } : {}),
    };
  }
}
