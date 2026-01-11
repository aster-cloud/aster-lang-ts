import type { CstModule } from './cst.js';

function reflowSeams(text: string): string {
  let s = text;
  // Collapse '. :' → ':' (optionally with spaces)
  s = s.replace(/\.\s*:/g, ':');
  // Remove spaces before punctuation ., : ! ? ;
  s = s.replace(/\s+([.,:!?;])/g, '$1');
  // Trim trailing spaces at end of lines
  s = s.replace(/[ \t]+(?=\n)/g, '');
  // Ensure at most one trailing newline
  s = s.replace(/\n+$/g, '\n');
  return s;
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
    return opts?.reflow ? reflowSeams(out) : out;
  }
  // Fallback path (no fullText): stitch together leading + lexemes + trailing
  let out = mod.leading?.text ?? '';
  out += tokens.map(t => t.lexeme).join('');
  out += mod.trailing?.text ?? '';
  return opts?.reflow ? reflowSeams(out) : out;
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
  const slice = src.slice(startOffset, endOffset);
  return opts?.reflow ? reflowSeams(slice) : slice;
}
