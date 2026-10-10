import type { CstModule, CstToken } from './cst.js';
import { TokenKind } from '../types.js';

// 其前的同行空白在 reflow 时去掉的标点
const SEAM_PUNCT: ReadonlySet<string> = new Set(['.', ',', ':', '!', '?', ';']);
const INLINE_SPACE = /^[ \t]*$/;

/** 记号是否换行（lexer 把空白行的空格并入 NEWLINE，如 `"  \n"`） */
const isNewline = (t: CstToken): boolean => t.kind === TokenKind.NEWLINE;

/**
 * 记号之间的空白（含注释）：行尾空白去掉（`\n` 与 `\r\n` 同等对待）；下一记号是换行时，本段末尾的空白也是行尾空白。
 * 左锚 (?<![ \t]) 防止空白 run 上的二次回溯（用户源码可被攻击者控制）。
 */
function trimGap(gap: string, beforeNewline: boolean): string {
  const trimmed = gap.replace(/(?<![ \t])[ \t]+(?=\r?\n)/g, '');
  return beforeNewline ? trimmed.replace(/(?<![ \t])[ \t]+$/, '') : trimmed;
}

/**
 * 结尾的换行收成至多一个，沿用其原有写法（`\n` 或 `\r\n`）。
 * 到文件末尾时，结尾的空白（含无换行收尾时的同行空白）一并去掉；区间未到文件末尾时其后还有正文，同行空白不动。
 * 逐字符回扫而非正则，避免长换行 run 上的二次回溯。
 */
function trimTail(out: string, atEof: boolean): string {
  const skip = atEof ? ' \t\r\n' : '\r\n';
  let cut = out.length;
  while (cut > 0 && skip.includes(out[cut - 1]!)) cut--;
  const tail = out.slice(cut);
  const nl = tail.indexOf('\n');
  if (nl < 0) return atEof ? out.slice(0, cut) : out;
  return out.slice(0, cut) + (tail[nl - 1] === '\r' ? '\r\n' : '\n');
}

/**
 * 最小接缝整理，只改记号之间的空白，记号本身（字符串字面量等）与注释正文不动：
 * 标点前的同行空白去掉；`.` 与其后同行的 `:` 合并为 `:`；行尾空白（含只有空白的行）去掉；末尾至多一个换行。
 * 标点前若隔着换行（如 workflow 独占一行的结束句点）则保持原样，不改变语句结构。
 */
function reflowRange(src: string, tokens: readonly CstToken[], start: number, end: number): string {
  // 用数组收集片段：在拼接中的字符串上反复取末字符会迫使 V8 展平 rope，退化为二次
  const parts: string[] = [];
  let pos = start;
  let atLineStart = true;
  let lastWasDot = false;
  for (const t of tokens) {
    if (t.startOffset < start || t.endOffset > end || t.endOffset === t.startOffset) continue;
    let gap = trimGap(src.slice(pos, t.startOffset), isNewline(t));
    // 行首的空白是缩进，不属于标点前的接缝
    if (gap.includes('\n')) atLineStart = true;
    if (SEAM_PUNCT.has(t.lexeme) && !atLineStart && INLINE_SPACE.test(gap)) gap = '';
    if (t.lexeme === ':' && gap === '' && lastWasDot) parts[parts.length - 1] = '';
    // 换行记号的前导空白是空白行的行尾空白；其后一行的缩进在下一段空白里，不受影响
    const lexeme = isNewline(t) ? t.lexeme.replace(/^[ \t]+/, '') : t.lexeme;
    parts.push(gap, lexeme);
    atLineStart = isNewline(t);
    lastWasDot = t.lexeme === '.';
    pos = t.endOffset;
  }
  // 结尾的换行既可能是记号也可能是空白，合并后统一收尾
  parts.push(trimGap(src.slice(pos, end), false));
  return trimTail(parts.join(''), end === src.length);
}

// Lossless CST printer: re-emit the original bytes using token offsets and the
// captured fullText. Falls back to concatenating token lexemes with leading /
// trailing trivia if fullText is not present.
export function printCNLFromCst(mod: CstModule, opts?: { reflow?: boolean }): string {
  const tokens = mod.tokens || [];
  const src = mod.fullText;
  if (src && tokens.length > 0) {
    let out = '';
    // Leading trivia
    out += src.slice(0, tokens[0]!.startOffset);
    for (let i = 0; i < tokens.length; i++) {
      const prevEnd = i === 0 ? tokens[0]!.startOffset : tokens[i - 1]!.endOffset;
      const cur = tokens[i]!;
      out += src.slice(prevEnd, cur.startOffset); // inter-token trivia
      out += src.slice(cur.startOffset, cur.endOffset); // token lexeme
    }
    // Trailing trivia
    out += src.slice(tokens[tokens.length - 1]!.endOffset);
    return opts?.reflow ? reflowRange(src, tokens, 0, src.length) : out;
  }
  // Fallback path (no fullText): stitch together leading + lexemes + trailing
  let out = mod.leading?.text ?? '';
  out += tokens.map(t => t.lexeme).join('');
  out += mod.trailing?.text ?? '';
  // 无原文偏移时无法区分记号与空白，不做 reflow，宁可原样输出也不改写字符串
  return out;
}

// Print a range from the original source using offsets from the same text used
// to build the CST. If reflow is requested, apply the minimal seam fixes within
// the slice only (does not adjust surrounding context).
export function printRangeFromCst(
  mod: CstModule,
  startOffset: number,
  endOffset: number,
  opts?: { reflow?: boolean }
): string {
  const src = mod.fullText || '';
  return opts?.reflow ? reflowRange(src, mod.tokens || [], startOffset, endOffset) : src.slice(startOffset, endOffset);
}
