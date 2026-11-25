/**
 * 名字转义 `` `x` ``（ADR 0064）在规范化阶段的片段识别：规范化器各步与变换器共用，保证每一步看到同一组不透明片段。
 */

/**
 * 名字转义片段的结束位置（ADR 0064 N2a）：text[i] 是反引号且同一行里还有一个反引号时返回后者的下标，否则 -1。
 * 未闭合的反引号不形成片段，留给词法器报 E902。只看字符，不判断内容是否合法。与 aster-lang-core
 * Canonicalizer.escapeClose 相同。
 */
export function escapeClose(text: string, i: number): number {
  if (text[i] !== '`') return -1;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '`') return j;
    if (c === '\n' || c === '\r') return -1;
  }
  return -1;
}

/**
 * 不透明区间：字符串字面量（含两端引号，未闭合时延伸到文本末尾，closed 为 false）或名字转义（含两端反引号）。
 * end 不含。
 */
export interface OpaqueRange {
  readonly start: number;
  readonly end: number;
  readonly escape: boolean;
  readonly closed: boolean;
}

/** 由若干单字符组成的全局字符类正则，按字符集缓存（每个词法表只有寥寥几种组合）。调用方每次 exec 前自设 lastIndex。 */
const CHAR_CLASS_RE_CACHE = new Map<string, RegExp>();

export function charClassRegex(chars: string): RegExp {
  let re = CHAR_CLASS_RE_CACHE.get(chars);
  if (re === undefined) {
    re = new RegExp(`[${chars.replace(/[\\\]^-]/g, '\\$&')}]`, 'g');
    CHAR_CLASS_RE_CACHE.set(chars, re);
  }
  return re;
}

/** 开引号或反引号。只认单个 UTF-16 码元的开引号：调用方原先逐字符比较，多码元的键从来匹配不上。 */
function openerRegex(pairs: ReadonlyMap<string, string>): RegExp {
  return charClassRegex([...pairs.keys()].filter(open => open.length === 1).join('') + '`');
}

/** index 处的字符前面是否有奇数个反斜杠（即被转义）。 */
export function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

/** 从 from 起第一个未转义的 close 的下标；没有则为 -1（未闭合）。 */
function unescapedIndexOf(text: string, from: number, close: string): number {
  for (let k = text.indexOf(close, from); k >= 0; k = text.indexOf(close, k + 1)) {
    if (!isEscapedAt(text, k)) return k;
  }
  return -1;
}

/**
 * 字符串外的名字转义与字符串字面量区间，按出现顺序（ADR 0064 N2）。pairs 是开引号 → 闭引号。
 *
 * 规则与逐字符扫描相同：字符串外遇反引号且同一行有下一个反引号时是名字转义，未闭合的反引号是普通字符；
 * 未被反斜杠转义的开引号开始字符串，到下一个未转义的对应闭引号结束。实现上只用正则跳到下一个开引号或
 * 反引号、用 indexOf 跳到闭引号，不逐字符走普通文本：规范化每趟都要分段，逐字符走在覆盖率插桩下
 * 成倍变慢（aster-lang-ts「关键词密集的源码必须在绝对预算内完成」）。整体单趟线性。
 */
export function opaqueRanges(text: string, pairs: ReadonlyMap<string, string>): OpaqueRange[] {
  const ranges: OpaqueRange[] = [];
  const opener = openerRegex(pairs);
  let pos = 0;
  while (pos < text.length) {
    opener.lastIndex = pos;
    const match = opener.exec(text);
    if (match === null) break;
    const i = match.index;
    const close = text[i] === '`' ? escapeClose(text, i) : -1;
    if (close > 0) {
      ranges.push({ start: i, end: close + 1, escape: true, closed: true });
      pos = close + 1;
    } else if (text[i] === '`' || isEscapedAt(text, i)) {
      pos = i + 1;
    } else {
      const closeQuote = unescapedIndexOf(text, i + 1, pairs.get(text[i]!)!);
      const end = closeQuote < 0 ? text.length : closeQuote + 1;
      ranges.push({ start: i, end, escape: false, closed: closeQuote >= 0 });
      pos = end;
    }
  }
  return ranges;
}
