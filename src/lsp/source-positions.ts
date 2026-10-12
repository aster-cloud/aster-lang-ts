/**
 * 把规范化文本上的 token 位置映射回**原文**坐标（LSP 专用）。
 *
 * ★为什么需要：canonicalize 会改变行内长度——删除冠词（en: the/a，de: eine/die/der）、
 *   折叠多余空格、tab → 两个空格、仅对关键字生效的转写（de: zurueck → zurück）等。
 *   lexer 在规范化文本上给出的列号直接用于原文，会让重命名改错位置
 *   （`Let the total be helper(x).` 里改 helper 实际改掉了 ` be he`）、高亮偏移、
 *   跳转定义命中不到。zh 的规范化恰好等长，所以只在 en/de 暴露。
 *
 * 做法：规范化保持行数不变（注释行留空行占位）。逐行把 token 按顺序在原文该行里找对应
 * 文本（标识符按 Unicode 词边界），找到即精确映射；找不到（被转写的关键字、全角标点等）
 * 就按与上一个已对齐 token 的相对偏移推算。被删除的冠词不是 token，顺序查找自然跳过。
 *
 * 只用于 LSP：编译路径（Core IR、跨引擎 parity）的 span 语义不受影响。
 */

interface Pos { line: number; col: number }
interface TokenLike { start?: Pos; end?: Pos; value?: unknown; kind?: unknown }

const WORDISH = /^[\p{L}\p{N}_]+$/u;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** 在原文一行里从 from 起查找 raw 的下一处出现；词状 token 要求两侧不是字母/数字 */
function findInLine(line: string, raw: string, from: number): number {
  if (!raw) return -1;
  const wordish = WORDISH.test(raw);
  let i = line.indexOf(raw, from);
  while (i !== -1) {
    if (!wordish) return i;
    const before = i > 0 ? line[i - 1]! : '';
    const after = line[i + raw.length] ?? '';
    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) return i;
    i = line.indexOf(raw, i + 1);
  }
  return -1;
}

/**
 * 返回位置已改为原文坐标的新 token 数组（不修改入参）。行号均为 1-based、列号 1-based。
 */
export function alignTokensToSource<T extends TokenLike>(original: string, canonical: string, tokens: readonly T[]): T[] {
  const origLines = original.replace(/\r\n?/g, '\n').split('\n');
  const canLines = canonical.split('\n');
  // 每行的对齐状态：原文查找游标，以及上一个已对齐 token 的（规范化末尾列, 原文末尾列）
  const state = new Map<number, { cursor: number; canEnd: number; origEnd: number }>();

  const mapCol = (line: number, canCol: number, st: { canEnd: number; origEnd: number }): number => {
    const len = origLines[line - 1]?.length ?? 0;
    return Math.max(1, Math.min(len + 1, st.origEnd + (canCol - st.canEnd)));
  };

  return tokens.map((t) => {
    if (!t.start || !t.end) return t;
    const line = t.start.line;
    const st = state.get(line) ?? { cursor: 0, canEnd: 1, origEnd: 1 };
    state.set(line, st);
    const canLine = canLines[line - 1] ?? '';
    const origLine = origLines[line - 1] ?? '';
    const sameLine = t.end.line === line;
    const raw = sameLine ? canLine.slice(t.start.col - 1, t.end.col - 1) : '';
    const at = sameLine ? findInLine(origLine, raw, st.cursor) : -1;
    let start: Pos;
    let end: Pos;
    if (at !== -1) {
      start = { line, col: at + 1 };
      end = { line, col: at + 1 + raw.length };
      st.cursor = at + raw.length;
    } else {
      start = { line, col: mapCol(line, t.start.col, st) };
      end = sameLine ? { line, col: mapCol(line, t.end.col, st) } : { ...t.end };
      if (sameLine) st.cursor = Math.max(st.cursor, end.col - 1);
    }
    if (sameLine) {
      st.canEnd = t.end.col;
      st.origEnd = end.col;
    }
    return { ...t, start, end };
  });
}
