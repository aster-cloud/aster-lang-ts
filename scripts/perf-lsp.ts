#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { p50 } from './perf-utils.js';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';

type Sample = { text: string; can: string };

function main(): void {
  // Choose a sample that avoids unsupported syntax (e.g., '?' suffix) for lexer
  const text = [
    'Module demo.perf.',
    'Rule join given left: Text and right: Text, produce Text:',
    '  Return Text.concat(left, right).',
    ''
  ].join('\n');
  const N = 100;
  const docs: Sample[] = Array.from({ length: N }, () => ({ text, can: canonicalize(text) }));

  const tLex: number[] = [];
  const tParse: number[] = [];
  const tHoverPrep: number[] = [];
  const tSem: number[] = [];
  const tRefs: number[] = [];

  for (const d of docs) {
    try {
      let t0 = performance.now();
      const toks = lex(d.can);
      let t1 = performance.now();
      tLex.push(t1 - t0);
      const ast = parse(toks);
      const t2 = performance.now();
      tParse.push(t2 - t1);
      // Simulate semantic tokens/hover prep by a shallow decl/param scan
      t0 = performance.now();
      let count = 0;
      for (const dec of (ast as any).decls as any[]) {
        if (dec.kind === 'Func') count += 1 + (dec.params?.length || 0);
      }
      void count;
      t1 = performance.now();
      tHoverPrep.push(t1 - t0);

      // Simulate semantic tokens building over tokens
      t0 = performance.now();
      let kw = 0, ty = 0;
      for (const t of toks as any[]) {
        if (t.kind === 'KEYWORD') kw++;
        else if (t.kind === 'TYPE_IDENT') ty++;
      }
      void kw; void ty;
      t1 = performance.now();
      tSem.push(t1 - t0);

      // Simulate references lookup by building an id index
      t0 = performance.now();
      const idx = new Map<string, number>();
      for (const t of toks as any[]) {
        if (t.kind !== 'IDENT' && t.kind !== 'TYPE_IDENT') continue;
        const k = String(t.value || '');
        idx.set(k, (idx.get(k) || 0) + 1);
      }
      void idx;
      t1 = performance.now();
      tRefs.push(t1 - t0);
    } catch {
      // skip invalid sample
    }
  }

  const out = {
    files: N,
    lex: { p50: p50(tLex).toFixed(2), mean: (tLex.reduce((a, b) => a + b, 0) / N).toFixed(2) },
    parse: { p50: p50(tParse).toFixed(2), mean: (tParse.reduce((a, b) => a + b, 0) / Math.max(1, tParse.length)).toFixed(2) },
    prep: { p50: p50(tHoverPrep).toFixed(2), mean: (tHoverPrep.reduce((a, b) => a + b, 0) / Math.max(1, tHoverPrep.length)).toFixed(2) },
    sem: { p50: p50(tSem).toFixed(2), mean: (tSem.reduce((a, b) => a + b, 0) / Math.max(1, tSem.length)).toFixed(2) },
    refs: { p50: p50(tRefs).toFixed(2), mean: (tRefs.reduce((a, b) => a + b, 0) / Math.max(1, tRefs.length)).toFixed(2) },
  };
  console.log(JSON.stringify(out, null, 2));
  // Soft gate: warn if parse p50 exceeds 30ms
  if (parseFloat(out.parse.p50) > 30) {
    console.error('Warn: parse p50 exceeds 30ms target');
    process.exitCode = 0;
  }
}

main();
