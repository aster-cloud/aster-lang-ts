#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { p50 } from './perf-utils.js';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';

const text = [
  'This module is demo.perfassert.',
  'To join with left: Text and right: Text, produce Text:',
  '  Return Text.concat(left, right).',
  ''
].join('\n');

const N = 100;
const can = canonicalize(text);
const tParse: number[] = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const toks = lex(can);
  parse(toks);
  const t1 = performance.now();
  tParse.push(t1 - t0);
}
const p = p50(tParse);
console.log(JSON.stringify({ files: N, parse: { p50: p.toFixed(2) } }, null, 2));
if (p > 30) {
  console.error(`Parse p50 ${p.toFixed(2)} exceeds 30ms`);
  process.exit(2);
}
