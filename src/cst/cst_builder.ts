import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import type { Token } from '../types.js';
import type { CstModule, CstToken, InlineComment } from './cst.js';

function buildLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function toOffset(starts: readonly number[], line: number, col: number): number {
  const li = Math.max(1, line) - 1;
  const base = starts[li] ?? 0;
  return base + Math.max(1, col) - 1;
}

function tokensToCstTokens(text: string, tokens: readonly Token[]): CstToken[] {
  const starts = buildLineStarts(text);
  const res: CstToken[] = [];
  for (const t of tokens) {
    // 跳过 trivia Token（如注释），它们不进入 CST tokens
    if (t.channel === 'trivia') continue;
    const startOffset = toOffset(starts, t.start.line, t.start.col);
    const endOffset = toOffset(starts, t.end.line, t.end.col);
    const lexeme = text.slice(startOffset, endOffset);
    res.push({ kind: t.kind, lexeme, start: t.start, end: t.end, startOffset, endOffset });
  }
  return res;
}

/**
 * 从 Token 流提取注释 Token 并转换为 InlineComment 格式
 *
 * 替代原有的 collectInlineComments 文本重扫逻辑，直接消费词法阶段产出的注释 Token。
 */
function extractInlineComments(tokens: readonly Token[]): InlineComment[] {
  const out: InlineComment[] = [];
  for (const t of tokens) {
    if (t.channel === 'trivia' && t.kind === 'COMMENT') {
      const commentValue = t.value as { raw: string; text: string; trivia: 'inline' | 'standalone' };
      out.push({
        line: t.start.line,
        text: commentValue.raw, // 保留原始文本（含前缀）
        standalone: commentValue.trivia === 'standalone',
      });
    }
  }
  return out;
}

export function buildCst(text: string, prelexed?: readonly Token[]): CstModule {
  const can = canonicalize(text);
  const toks = (prelexed as Token[] | undefined) ?? lex(can);
  const cstTokens = tokensToCstTokens(text, toks);
  const inlineComments = extractInlineComments(toks);
  const span = cstTokens.length
    ? { start: cstTokens[0]!.start, end: cstTokens[cstTokens.length - 1]!.end }
    : { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } };
  const leading = cstTokens.length > 0 ? { text: text.slice(0, cstTokens[0]!.startOffset) } : { text: text };
  const trailing = cstTokens.length > 0
    ? { text: text.slice(cstTokens[cstTokens.length - 1]!.endOffset) }
    : { text: '' };
  return { kind: 'Module', tokens: cstTokens, children: [], span, leading, trailing, inlineComments } as CstModule;
}

// Lossless CST builder: lex the original text (no canonicalization) so token
// offsets/positions align with the source. Preserve the full text on the CST
// for printers to reconstruct inter-token trivia exactly.
export function buildCstLossless(text: string): CstModule {
  const toks = lex(text);
  const cstTokens = tokensToCstTokens(text, toks);
  const inlineComments = extractInlineComments(toks);
  const span = cstTokens.length
    ? { start: cstTokens[0]!.start, end: cstTokens[cstTokens.length - 1]!.end }
    : { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } };
  const leading = cstTokens.length > 0 ? { text: text.slice(0, cstTokens[0]!.startOffset) } : { text: text };
  const trailing = cstTokens.length > 0
    ? { text: text.slice(cstTokens[cstTokens.length - 1]!.endOffset) }
    : { text: '' };
  return {
    kind: 'Module',
    tokens: cstTokens,
    children: [],
    span,
    leading,
    trailing,
    fullText: text,
    inlineComments,
  } as CstModule;
}

// function collectInlineComments(text: string): InlineComment[] {
//   const out: InlineComment[] = [];
//   const lines = text.split(/\r?\n/);
//   for (let i = 0; i < lines.length; i++) {
//     const line = lines[i]!;
//     const m = line.match(/^(.*?)(\s*(\/\/|#).*)$/);
//     if (m && m[2]) {
//       const code = (m[1] || '').trim();
//       const comment = m[2].trim();
//       out.push({ line: i + 1, text: comment, standalone: code.length === 0 });
//     }
//   }
//   return out;
// }
