import { TokenKind, KW } from './tokens.mjs';

const KW_VALUES = new Set(Object.values(KW));

function isLetter(ch) {
  return /[A-Za-z]/.test(ch);
}
function isDigit(ch) {
  return /[0-9]/.test(ch);
}

export function lex(input) {
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const push = (kind, value = null, start = { line, col }) => {
    tokens.push({ kind, value, start, end: { line, col } });
  };
  const peek = () => input[i] || '';
  const next = () => {
    const ch = input[i++] || '';
    if (ch === '\n') { line++; col = 1; } else { col++; }
    return ch;
  };

  const INDENT_STACK = [0];

  function emitIndentDedent(spaces) {
    const last = INDENT_STACK[INDENT_STACK.length - 1];
    if (spaces === last) return;
    if (spaces % 2 !== 0) throw error(`Indentation must be multiples of 2 spaces`, { line, col });
    if (spaces > last) {
      INDENT_STACK.push(spaces);
      push(TokenKind.INDENT);
    } else {
      while (INDENT_STACK.length && spaces < INDENT_STACK[INDENT_STACK.length - 1]) {
        INDENT_STACK.pop();
        push(TokenKind.DEDENT);
      }
      if (INDENT_STACK[INDENT_STACK.length - 1] !== spaces) throw error(`Inconsistent dedent`, { line, col });
    }
  }

  function error(msg, pos) {
    const e = new Error(msg);
    e.pos = pos; return e;
  }

  while (i < input.length) {
    const ch = peek();

    // Newline + indentation
    if (ch === '\n') {
      next();
      push(TokenKind.NEWLINE);
      // Measure indentation
      let spaces = 0; let k = i;
      while (input[k] === ' ') { spaces++; k++; }
      if (input[k] === '\n' || k >= input.length) { i = k; continue; }
      // Only treat indentation if next token is not comment; (no comments yet)
      emitIndentDedent(spaces);
      i = k; col += spaces;
      continue;
    }

    // Whitespace
    if (ch === ' ' || ch === '\t') { next(); continue; }

    // Punctuation
    if (ch === '.') { next(); push(TokenKind.DOT, '.'); continue; }
    if (ch === ':') { next(); push(TokenKind.COLON, ':'); continue; }
    if (ch === ',') { next(); push(TokenKind.COMMA, ','); continue; }
    if (ch === '(') { next(); push(TokenKind.LPAREN, '('); continue; }
    if (ch === ')') { next(); push(TokenKind.RPAREN, ')'); continue; }
    if (ch === '=') { next(); push(TokenKind.EQUALS, '='); continue; }

    // String literal
    if (ch === '"') {
      const start = { line, col };
      next();
      let val = '';
      while (i < input.length && peek() !== '"') {
        if (peek() === '\\') { next(); val += next(); }
        else { val += next(); }
      }
      if (peek() !== '"') throw error('Unterminated string', start);
      next(); // closing quote
      push(TokenKind.STRING, val, start);
      continue;
    }

    // Identifiers / numbers / keywords
    if (isLetter(ch)) {
      const start = { line, col };
      let word = '';
      while (isLetter(peek()) || isDigit(peek()) || peek() === '_') {
        word += next();
      }
      const lower = word.toLowerCase();
      // Handle booleans/null specially
      if (lower === KW.TRUE) { push(TokenKind.BOOL, true, start); continue; }
      if (lower === KW.FALSE) { push(TokenKind.BOOL, false, start); continue; }
      if (lower === KW.NULL) { push(TokenKind.NULL, null, start); continue; }
      // Keywords (case-insensitive) are emitted as IDENT with their source casing preserved
      if (KW_VALUES.has(lower)) { push(TokenKind.IDENT, word, start); continue; }
      // Types by capitalized first letter considered TYPE_IDENT
      if (/^[A-Z]/.test(word)) { push(TokenKind.TYPE_IDENT, word, start); }
      else { push(TokenKind.IDENT, word, start); }
      continue;
    }

    if (isDigit(ch)) {
      const start = { line, col };
      let num = '';
      while (isDigit(peek())) num += next();
      push(TokenKind.INT, parseInt(num, 10), start);
      continue;
    }

    throw error(`Unexpected character '${ch}'`, { line, col });
  }

  // Close indentation stack
  while (INDENT_STACK.length > 1) { INDENT_STACK.pop(); push(TokenKind.DEDENT); }
  push(TokenKind.EOF);
  return tokens;
}

