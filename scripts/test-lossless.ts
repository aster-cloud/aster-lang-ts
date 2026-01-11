#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { formatCNL } from '../src/formatter.js';

function main(): void {
  const dir = path.join(process.cwd(), 'test/cnl', 'programs');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.aster')).map(f => path.join(dir, f));
  let ok = 0;
  let changed = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const out = formatCNL(src, { mode: 'lossless' });
    if (out !== src) {
      console.error(`[lossless] Mismatch: ${path.relative(process.cwd(), file)}`);
      changed++;
    } else {
      ok++;
    }
  }
  console.log(`Lossless check: ${ok} OK, ${changed} changed.`);
  if (changed > 0) process.exit(1);
}

main();

