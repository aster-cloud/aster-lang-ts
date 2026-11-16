/**
 * canonical ↔ display 的偏移映射（ADR 0058 §7.8）。偏移单位一律是 UTF-16 code unit，换行不归一化。
 *
 * - 落在内容 span 内：按 span 内相对位置一一对应，结果是一个点（start === end）。
 * - 落在结构 span 内：映射到该 span 在另一侧的整段区间；另一侧为空串时即插入点。
 * - 恰在两个 span 的交界：归后一个 span；结果的 start 总是交界在另一侧的位置，
 *   因此调用方把区间端点各自映射后取 start 即可。
 * - 文末偏移（= 文本长度）映射到另一侧的文末。
 */
import { canonicalOf, displayOf } from './format.js';
import type { LayoutRange, LayoutSpan, PolicyLayout } from './types.js';

type Side = (span: LayoutSpan) => string;

function mapOffset(layout: PolicyLayout, offset: number, from: Side, to: Side, fromName: string): LayoutRange {
  let fromAt = 0;
  let toAt = 0;
  for (const span of layout.spans) {
    const fromLen = from(span).length;
    const toLen = to(span).length;
    if (offset >= fromAt && offset < fromAt + fromLen) {
      if ('text' in span) {
        const p = toAt + (offset - fromAt);
        return { start: p, end: p };
      }
      return { start: toAt, end: toAt + toLen };
    }
    fromAt += fromLen;
    toAt += toLen;
  }
  if (offset === fromAt) return { start: toAt, end: toAt };
  throw new RangeError(`offset ${offset} is outside the ${fromName} text [0, ${fromAt}]`);
}

function assertOffset(offset: number): void {
  if (!Number.isInteger(offset)) throw new RangeError(`offset must be an integer, got ${offset}`);
}

/** canonical 偏移 → display 区间 */
export function canonicalToDisplay(layout: PolicyLayout, offset: number): LayoutRange {
  assertOffset(offset);
  return mapOffset(layout, offset, canonicalOf, displayOf, 'canonical');
}

/** display 偏移 → canonical 区间 */
export function displayToCanonical(layout: PolicyLayout, offset: number): LayoutRange {
  assertOffset(offset);
  return mapOffset(layout, offset, displayOf, canonicalOf, 'display');
}
