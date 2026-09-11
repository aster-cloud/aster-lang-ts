import type { ParserContext } from './context.js';
import type { Span, Token } from '../types.js';
import { TokenKind } from '../frontend/tokens.js';

type Position = { line: number; col: number };
type SpanSource = Token | { span: Span };

function clonePosition(pos: Position): Position {
  return { line: pos.line, col: pos.col };
}

export function cloneSpan(span: Span): Span {
  return {
    start: clonePosition(span.start),
    end: clonePosition(span.end),
  };
}

export function spanFromTokens(start: Token, end: Token): Span {
  return {
    start: clonePosition(start.start),
    end: clonePosition(end.end),
  };
}

function toSpan(source: SpanSource): Span {
  if ('span' in source) {
    return source.span;
  }
  return {
    start: source.start,
    end: source.end,
  };
}

function isBefore(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.col < b.col);
}

function isAfter(a: Position, b: Position): boolean {
  return a.line > b.line || (a.line === b.line && a.col > b.col);
}

export function spanFromSources(...sources: SpanSource[]): Span {
  if (sources.length === 0) {
    return {
      start: { line: 0, col: 0 },
      end: { line: 0, col: 0 },
    };
  }

  let start: Position | null = null;
  let end: Position | null = null;

  for (const source of sources) {
    const span = toSpan(source);
    if (!start || isBefore(span.start, start)) {
      start = span.start;
    }
    if (!end || isAfter(span.end, end)) {
      end = span.end;
    }
  }

  return {
    start: clonePosition(start!),
    end: clonePosition(end!),
  };
}

export function firstSignificantToken(tokens: readonly Token[]): Token {
  for (const tok of tokens) {
    if (tok.channel !== 'trivia') {
      return tok;
    }
  }
  return tokens[0]!;
}

export function lastSignificantTokenInStream(tokens: readonly Token[]): Token {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (!tok) continue;
    if (tok.channel !== 'trivia') {
      return tok;
    }
  }
  return tokens[tokens.length - 1]!;
}

/**
 * 最后一个**已消费且非布局**的 token。
 *
 * ★与 {@link lastConsumedToken} 的区别：后者只跳过 `channel === 'trivia'`
 *   （注释），**不跳过** NEWLINE / INDENT / DEDENT —— 这些是默认通道上的布局
 *   token，且位于声明**之后**的行上。
 *
 * ★为什么需要：声明的 span 若以 `ctx.tokens[ctx.index - 1]` 收尾，会把尾随的
 *   NEWLINE/DEDENT 一并算进去，于是 span 一路延伸到**下一个声明的起始行**。
 *   实测 `comparison_operators.aster`：`Rule testGreaterThanOrEqual` 真实占
 *   第 3–4 行，却报成 3–5，而 5 正是下一个 Rule 的起始行 —— 相邻声明的 span
 *   互相**重叠**。
 *
 * ★为什么不只是数字难看：ADR 0032 要把执行 trace 锚定到源码位置，ADR 0037 要
 *   在其上建 OriginMap（文本 span ↔ IR 节点双向导航）。span 重叠会让「按位置
 *   反查这是哪个声明」出现歧义 —— 同一行同时属于两个声明，且不报错，只会静默
 *   给出错误答案。
 *
 * ★Java 侧同款缺陷已修（`AstBuilder.lastNonLayoutToken`）。此前两边都长、
 *   错得方向一致而互相抵消，跨引擎门禁因此一直是绿的 —— 修对一边分歧才显形。
 *
 * 全部回溯到头仍是布局 token 时，回退 {@link lastConsumedToken} 的结果，
 * 不做「一定存在」的假设。
 */
export function lastNonLayoutToken(ctx: ParserContext): Token {
  let idx = ctx.index - 1;
  while (idx >= 0) {
    const tok = ctx.tokens[idx];
    if (!tok) break;
    if (tok.channel !== 'trivia' && !isLayoutToken(tok)) {
      return tok;
    }
    idx--;
  }
  return lastConsumedToken(ctx);
}

function isLayoutToken(tok: Token): boolean {
  return tok.kind === TokenKind.NEWLINE
    || tok.kind === TokenKind.INDENT
    || tok.kind === TokenKind.DEDENT;
}

export function lastConsumedToken(ctx: ParserContext): Token {
  let idx = ctx.index - 1;
  while (idx >= 0) {
    const tok = ctx.tokens[idx];
    if (!tok) break;
    if (tok.channel !== 'trivia') {
      return tok;
    }
    idx--;
  }
  return ctx.peek();
}

export function assignSpan<T extends { span: Span }>(node: T, span: Span): T {
  node.span = span;
  return node;
}
