#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { formatCNL } from '../src/formatter.js';

function main(): void {
  const dir = path.join(process.cwd(), 'test', 'lossless', 'golden');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.in.aster'));
  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const inPath = path.join(dir, f);
    const outPath = path.join(dir, f.replace(/\.in\.aster$/, '.out.aster'));
    const src = fs.readFileSync(inPath, 'utf8');
    const haveOut = fs.existsSync(outPath);
    const lossless = formatCNL(src, { mode: 'lossless' });
    if (lossless !== src) {
      console.error(`[lossless] identity failed: ${path.relative(process.cwd(), inPath)}`);
      fail++;
      continue;
    }
    if (haveOut) {
      const expected = fs.readFileSync(outPath, 'utf8');
      const reflowed = formatCNL(src, { mode: 'lossless', reflow: true });
      const norm = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
      if (norm(reflowed) !== norm(expected)) {
        console.error(`[reflow] mismatch for ${f}`);
        console.error('--- Got ---');
        process.stdout.write(reflowed);
        console.error('--- Expected ---');
        process.stdout.write(expected);
        fail++;
        continue;
      }
    }
    ok++;
  }
  console.log(`Lossless golden: ${ok} OK, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main();
