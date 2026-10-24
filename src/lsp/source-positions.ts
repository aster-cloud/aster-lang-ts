/**
 * 把规范化文本上的 token 位置映射回**原文**坐标（LSP 专用）。
 *
 * ★为什么需要：canonicalize 会改变行内长度——删除冠词（en: the/a，de: eine/die/der）、
 *   折叠多余空格、tab → 两个空格、仅对关键字生效的转写（de: zurueck → zurück）等。
 *   lexer 在规范化文本上给出的列号直接用于原文，会让重命名改错位置
 *   （`Let the total be helper(x).` 里改 helper 实际改掉了 ` be he`）、高亮偏移、
 *   跳转定义命中不到。zh 的规范化多数等长，括号函数头重排（规则 名（参数）：）例外。
 *
 * 做法：规范化保持行数不变（注释行留空行占位）。逐行把 token 按顺序在原文该行里找对应
 * 文本（标识符按 Unicode 词边界），找到即精确映射；找不到（被转写的关键字、全角标点等）
 * 就按与上一个已对齐 token 的相对偏移推算。被删除的冠词不是 token，顺序查找自然跳过。
 *
 * 只用于 LSP：编译路径（Core IR、跨引擎 parity）的 span 语义不受影响。
 */

interface Pos { line: number; col: number }
interface TokenLike { start?: Pos; end?: Pos; value?: unknown; kind?: unknown }

/**
 * 对齐结果：
 *   exact      —— 原文里找到了同样的文本，位置确定
 *   translated —— 规范化文本里是领域词汇的规范名（如 Applicant），原文里找到的是其本地化写法
 *                 （申请人）；位置确定，但这不是用户自己的标识符
 *   guessed    —— 原文里找不到（被转写的关键字、全角标点等），位置按相对偏移推算，不可靠
 * ★编辑类操作（重命名）只能基于 exact，绝不能基于推算的位置产生编辑。
 */
export type SourceAlignment = 'exact' | 'translated' | 'guessed';
export type AlignedToken<T> = T & { srcAlign?: SourceAlignment };

export interface AlignOptions {
  /** 规范名 → 原文中的本地化写法（领域词汇；canonicalize 会把本地化词替换成规范名） */
  readonly localizedOf?: ((canonical: string) => string | undefined) | undefined;
}

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
export function alignTokensToSource<T extends TokenLike>(
  original: string,
  canonical: string,
  tokens: readonly T[],
  options: AlignOptions = {},
): AlignedToken<T>[] {
  const origLines = original.replace(/\r\n?/g, '\n').split('\n');
  const canLines = canonical.split('\n');
  // 每行的对齐状态：原文查找游标，以及上一个已对齐 token 的（规范化末尾列, 原文末尾列）
  const state = new Map<number, { cursor: number; canEnd: number; origEnd: number }>();

  const mapCol = (line: number, canCol: number, st: { canEnd: number; origEnd: number }): number => {
    const len = origLines[line - 1]?.length ?? 0;
    return Math.max(1, Math.min(len + 1, st.origEnd + (canCol - st.canEnd)));
  };

  const aligned = tokens.map((t): AlignedToken<T> => {
    if (!t.start || !t.end) return t;
    const line = t.start.line;
    const st = state.get(line) ?? { cursor: 0, canEnd: 1, origEnd: 1 };
    state.set(line, st);
    const canLine = canLines[line - 1] ?? '';
    const origLine = origLines[line - 1] ?? '';
    const sameLine = t.end.line === line;
    const raw = sameLine ? canLine.slice(t.start.col - 1, t.end.col - 1) : '';
    let at = sameLine ? findInLine(origLine, raw, st.cursor) : -1;
    let srcText = raw;
    let srcAlign: SourceAlignment = 'exact';
    if (at === -1 && sameLine) {
      // 领域词汇：规范名在原文里是本地化写法
      const localized = options.localizedOf?.(raw);
      if (localized) {
        at = findInLine(origLine, localized, st.cursor);
        if (at !== -1) { srcText = localized; srcAlign = 'translated'; }
      }
    }
    let start: Pos;
    let end: Pos;
    if (at !== -1) {
      start = { line, col: at + 1 };
      end = { line, col: at + 1 + srcText.length };
      st.cursor = at + srcText.length;
    } else {
      srcAlign = 'guessed';
      start = { line, col: mapCol(line, t.start.col, st) };
      end = sameLine ? { line, col: mapCol(line, t.end.col, st) } : { ...t.end };
      // 游标只推进到推算的起点：规范化插入的关键字（zh 括号函数头重排出的 Rule/given）比原文对应
      // 片段长，若推进到推算终点会越过紧随其后的真实标识符，使其无法精确对齐（重命名会漏掉它）。
      if (sameLine) st.cursor = Math.max(st.cursor, start.col - 1);
    }
    if (sameLine) {
      st.canEnd = t.end.col;
      st.origEnd = end.col;
    }
    return { ...t, start, end, srcAlign };
  });
  return clampGuessedSpans(aligned);
}

/**
 * 推算的区间不得盖住同一行下一个 token：规范化插入的关键字（如 zh 括号函数头重排出的 given）
 * 在原文里没有对应文本，按长度推算会覆盖紧随其后的标识符，造成高亮重叠。截到下一个 token 起点，
 * 截完为空时退化为起点处的零宽区间。
 */
function clampGuessedSpans<T extends TokenLike>(tokens: AlignedToken<T>[]): AlignedToken<T>[] {
  return tokens.map((t, i) => {
    const next = tokens[i + 1];
    if (t.srcAlign !== 'guessed' || !t.start || !t.end || !next?.start) return t;
    if (t.end.line !== t.start.line || next.start.line !== t.start.line || next.start.col >= t.end.col) return t;
    return { ...t, end: { line: t.start.line, col: Math.max(t.start.col, next.start.col) } };
  });
}
