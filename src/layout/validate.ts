/**
 * 保存校验 validatePolicyLayout（ADR 0058 §7.5）：cloud 保存与编辑器共用同一实现。
 * 按表中顺序逐条校验，返回第一处失败的稳定码。
 */
import type { Lexicon } from '../config/lexicons/types.js';
import { canonicalOf, mergeContentSpans, readLayout, serializeLayout, toCanonical, toDisplay, utf8Length } from './format.js';
import { LAYOUT_LIMITS, LayoutError } from './types.js';
import type { LayoutLimitName, LayoutValidation, PolicyLayout } from './types.js';
import { valueTokenRanges, withAliasSet } from './value-tokens.js';

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

/** §7.6：上限按存储形态（相邻内容 span 合并后）计 */
function assertWithinLimits(layout: PolicyLayout, source: string): void {
  const spans = mergeContentSpans(layout.spans);
  const measured: Array<[LayoutLimitName, number]> = [
    ['sourceBytes', utf8Length(source)],
    ['sourceLines', lineCount(source)],
    ['spans', spans.length],
    ['serializedBytes', utf8Length(serializeLayout(layout))],
    ['displayBytes', utf8Length(toDisplay(layout))],
    ['structuralDisplayChars', Math.max(0, ...spans.map((s) => ('text' in s ? 0 : [...s.display].length)))],
  ];
  for (const [limit, actual] of measured) {
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
  const values = valueTokenRanges(source, lexicon);
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
 */
export function validatePolicyLayout(
  layout: PolicyLayout,
  source: string,
  lexicon: Lexicon,
  aliasSet?: Record<string, string[]>,
): LayoutValidation {
  try {
    const checked = readLayout(layout);
    assertWithinLimits(checked, source);
    assertRoundtrip(checked, source);
    assertStructuralHidesNoValue(checked, source, withAliasSet(lexicon, aliasSet));
    const parity = verifyContentParity(checked);
    if (!parity.ok) throw new LayoutError('layout_content_parity', parity.reason);
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
