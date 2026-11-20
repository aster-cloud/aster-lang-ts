/**
 * 从改过的显示文本还原规范源码（ADR 0059 修订 4 D7）。与 aster-lang-test 参照实现 `display.mjs` 的
 * `reconstructFromDisplay`、aster-lang-core `DisplayReconstructor` 同一定义，跑同一组向量。
 *
 * 一个解 = 给每个内容 span 一个非空新文本，使按 span 顺序拼接（结构 span 取原 display）恰为编辑后的文本 E，且每段两侧
 * 都是内容 span 的隐藏串（连续、display 全为空串的结构 span）两侧至少一个内容与原文逐字节相同。解的个数只计到 2：
 * 0 → unmappable，1 → unique，≥ 2 → ambiguous。结构 span 不随编辑移动或增删，有歧义就拒绝，从不替用户猜。
 *
 * 实现按 span 下标 × 文本位置 × 「是否必须原样」计数（截到 2），锚点用 KMP 一次求出，复杂度 O(span 数 × |E|)。
 * 纯函数、无 Node 依赖。
 */
import { toCanonical, toDisplay, utf8Length } from './format.js';
import { LAYOUT_LIMITS } from './types.js';
import type { LayoutSpan, PolicyLayout } from './types.js';

export type Reconstruction =
  /** canonical 为派生排版的规范源码（各 span 的 canonical 侧拼接） */
  | { readonly kind: 'unique'; readonly layout: PolicyLayout; readonly canonical: string }
  | { readonly kind: 'unmappable'; readonly offset: number; readonly crlf: boolean }
  | { readonly kind: 'ambiguous'; readonly offset: number };

const isContent = (s: LayoutSpan): s is { text: string } => 'text' in s;

/** KMP：pattern（非空）在 text 中全部出现的起点标记。 */
function occurrences(text: string, pattern: string): Uint8Array {
  const marks = new Uint8Array(text.length + 1);
  const m = pattern.length;
  if (m === 0) {
    marks.fill(1);
    return marks;
  }
  const back = new Int32Array(m);
  for (let i = 1, k = 0; i < m; i++) {
    while (k > 0 && pattern[i] !== pattern[k]) k = back[k - 1]!;
    if (pattern[i] === pattern[k]) k++;
    back[i] = k;
  }
  for (let i = 0, k = 0; i < text.length; i++) {
    while (k > 0 && text[i] !== pattern[k]) k = back[k - 1]!;
    if (text[i] === pattern[k]) k++;
    if (k === m) {
      marks[i - m + 1] = 1;
      k = back[k - 1]!;
    }
  }
  return marks;
}

const cap = (n: number): number => (n > 2 ? 2 : n);

function firstDivergence(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * 反向映射。edited 已严格 UTF-8 解码、去掉至多一个 BOM；编辑器补的文末换行在这里去掉。
 * offset 只用于诊断（stderr），不跨实现比较。
 */
export function reconstructFromDisplay(layout: PolicyLayout, edited: string): Reconstruction {
  const display = toDisplay(layout);
  const crlf = edited.includes('\r\n') && !display.includes('\r\n');
  if (utf8Length(edited) > LAYOUT_LIMITS.displayBytes) return { kind: 'unmappable', offset: 0, crlf };
  let E = edited;
  if (!display.endsWith('\n') && E.endsWith('\n')) E = E.slice(0, E.endsWith('\r\n') ? -2 : -1);
  const unmappable = (): Reconstruction => ({ kind: 'unmappable', offset: firstDivergence(E, display), crlf });

  // 合并形态 → D_0 c_1 D_1 … c_n D_n
  const contents: string[] = [];
  const D: string[] = [''];
  for (const s of layout.spans) {
    if (isContent(s)) {
      contents.push(s.text);
      D.push('');
    } else D[D.length - 1] += s.display;
  }
  const n = contents.length;
  const L = E.length;
  if (n === 0) return E === display ? { kind: 'unique', layout, canonical: toCanonical(layout) } : unmappable();
  const head = D[0]!;
  const tail = D[n]!;
  if (head.length + tail.length > L || !E.startsWith(head) || !E.endsWith(tail)) return unmappable();
  const lastEnd = L - tail.length;

  // F[k][2p+f]：c_k 从 p 开始、f=1 表示必须原样的部分解个数（截到 2）
  const F = Array.from({ length: n }, () => new Uint8Array(2 * (L + 1)));
  const origAt = contents.map((o) => occurrences(E, o));
  F[0]![2 * head.length] = 1;
  const prefix = new Int32Array(L + 2);
  let total = 0;
  for (let k = 0; k < n; k++) {
    const Fk = F[k]!;
    const o = contents[k]!;
    const om = origAt[k]!;
    // prefix[e] = Σ_{p<e} F[p][自由]：各项已截到 2，和与差都精确
    prefix[0] = 0;
    for (let p = 0; p <= L; p++) prefix[p + 1] = prefix[p]! + Fk[2 * p]!;
    const orig = (e: number): number => {
      const p = e - o.length;
      return p >= 0 && om[p] ? cap(Fk[2 * p]! + Fk[2 * p + 1]!) : 0;
    };
    const modified = (e: number): number => {
      const p = e - o.length;
      const own = p >= 0 && om[p] ? Fk[2 * p]! : 0;
      return cap(prefix[e]! - own);
    };
    if (k === n - 1) {
      total = cap(orig(lastEnd) + modified(lastEnd));
      break;
    }
    const next = F[k + 1]!;
    const Dk = D[k + 1]!;
    if (Dk !== '') {
      const dm = occurrences(E, Dk);
      for (let e = 1; e + Dk.length <= L; e++) {
        if (!dm[e]) continue;
        const w = cap(orig(e) + modified(e));
        const at = 2 * (e + Dk.length);
        if (w) next[at] = cap(next[at]! + w);
      }
    } else {
      for (let e = 1; e < L; e++) {
        const wo = orig(e);
        const wm = modified(e);
        if (wo) next[2 * e] = cap(next[2 * e]! + wo);
        if (wm) next[2 * e + 1] = cap(next[2 * e + 1]! + wm);
      }
    }
  }
  if (total === 0) return unmappable();
  if (total >= 2) return { kind: 'ambiguous', offset: firstDivergence(E, display) };

  // 唯一解：从文末沿前驱回溯各 c_k 的 [start, end)
  const starts = new Array<number>(n);
  const ends = new Array<number>(n);
  let end = lastEnd;
  // null：终点任意；true：c_k 须原样结束；false：c_k 须改过
  let mustBeOriginalEnd: boolean | null = null;
  for (let k = n - 1; k >= 0; k--) {
    const Fk = F[k]!;
    const o = contents[k]!;
    let found: { p: number; f: 0 | 1 } | null = null;
    for (let p = 0; p < end && found === null; p++) {
      const isOrig = end - p === o.length && origAt[k]![p] === 1;
      if (mustBeOriginalEnd === true && !isOrig) continue;
      if (mustBeOriginalEnd === false && isOrig) continue;
      if (Fk[2 * p]) found = { p, f: 0 };
      else if (isOrig && Fk[2 * p + 1]) found = { p, f: 1 };
    }
    starts[k] = found!.p;
    ends[k] = end;
    if (k === 0) break;
    const Dprev = D[k]!;
    if (Dprev !== '') {
      end = found!.p - Dprev.length;
      mustBeOriginalEnd = null;
    } else {
      end = found!.p;
      // c_k 必须原样（f=1）⇔ c_{k-1} 改过；c_k 自由 ⇔ c_{k-1} 原样
      mustBeOriginalEnd = found!.f === 0;
    }
  }
  let ci = 0;
  const spans: LayoutSpan[] = layout.spans.map((s) => {
    if (!isContent(s)) return { canonical: s.canonical, display: s.display };
    const t = E.slice(starts[ci], ends[ci]);
    ci++;
    return { text: t };
  });
  const derived: PolicyLayout = { v: 1, spans };
  return { kind: 'unique', layout: derived, canonical: toCanonical(derived) };
}
