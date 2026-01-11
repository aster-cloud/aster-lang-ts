#!/usr/bin/env node
import fs from 'node:fs';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { findAmbiguousInteropCalls, computeDisambiguationEdits, findDottedCallRangeAt } from '../src/lsp/analysis.js';

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: lsp-harness <file.aster>');
    process.exit(2);
  }
  const src = fs.readFileSync(file, 'utf8');
  const can = canonicalize(src);
  const toks = lex(can);
  const diags = findAmbiguousInteropCalls(toks);
  console.log('Ambiguous interop diagnostics:', diags.length);
  for (const d of diags) {
    console.log('-', d.message, '@', d.range.start, '->', d.range.end);
    const edits = computeDisambiguationEdits(toks, d.range as any);
    if (edits.length) {
      console.log('  Suggested edits:');
      for (const e of edits) console.log('   *', e.range, '=>', e.newText);
    }
  }
  // Hover simulation at first call site
  const pos = { line: 0, character: 0 };
  const r = findDottedCallRangeAt(toks, pos);
  if (r) console.log('Found interop call at', r);
}

main();

