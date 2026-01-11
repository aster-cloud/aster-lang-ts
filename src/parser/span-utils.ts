import type { ParserContext } from './context.js';
import type { Span, Token } from '../types.js';

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
