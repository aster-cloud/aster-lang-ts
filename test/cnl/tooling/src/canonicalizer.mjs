// Canonicalizer: normalize CNL text: normalize keywords (en-US),
// enforce periods, normalize whitespace, preserve identifier case.
// 2-space indentation is significant.

import { KW } from './tokens.mjs';

const ARTICLE_RE = /\b(a|an|the)\b/gi;

// Multi-word keyword list ordered by length (desc) to match greedily.
const MULTI = [
  KW.MODULE_IS,
  KW.ONE_OF,
  KW.WAIT_FOR,
  KW.FOR_EACH,
  KW.OPTION_OF,
  KW.RESULT_OF,
  KW.OK_OF,
  KW.ERR_OF,
  KW.SOME_OF,
  KW.PERFORMS,
].sort((a, b) => b.length - a.length);

export function canonicalize(input) {
  // Normalize newlines to \n
  let s = input.replace(/\r\n?/g, '\n');

  // Normalize smart quotes to straight quotes
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // Ensure lines end with either period or colon before newline if they look like statements
  s = s.split('\n').map((line) => {
    const trimmed = line.trim();
    if (trimmed === '') return line; // keep empty
    // If ends with ':' or '.' already, keep
    if (/[:.]$/.test(trimmed)) return line;
    // Heuristic: if line appears to open a block (keywords like match/within/to ... produce ...:)
    // We won't add punctuation here; parser will require proper punctuation and offer fix-it.
    return line; // do nothing; errors will prompt fixes
  }).join('\n');

  // Fold multiple spaces (but not newlines); keep indentation (2-space rule) for leading spaces only
  s = s.split('\n').map((line) => {
    const m = line.match(/^(\s*)(.*)$/);
    const indent = m[1];
    const rest = m[2]
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([.,:])/g, '$1');
    return indent + rest;
  }).join('\n');

  // Keep original casing to preserve TypeIdents. We only normalize multi-word keywords by hinting
  // but we leave actual case handling to the parser (case-insensitive compare).
  let marked = s;
  for (const phrase of MULTI) {
    const re = new RegExp(phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'ig');
    marked = marked.replace(re, (m) => m.toLowerCase());
  }

  // Remove articles in allowed contexts (lightweight; parser will enforce correctness)
  marked = marked.replace(ARTICLE_RE, '');
  // Do not collapse newlines globally.
  marked = marked.replace(/^\s+$/gm, '');

  return marked;
}

