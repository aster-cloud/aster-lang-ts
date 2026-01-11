#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { formatCNL } from '../src/formatter.js';

function norm(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
}

function main(): void {
  const dir = path.join(process.cwd(), 'test', 'comments', 'golden');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.in.aster')) : [];
  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const inPath = path.join(dir, f);
    const outPath = path.join(dir, f.replace(/\.in\.aster$/, '.out.aster'));
    const src = fs.readFileSync(inPath, 'utf8');
    const expected = fs.readFileSync(outPath, 'utf8');
    const includeStandalone = !/should not be preserved/.test(src);
    const formatted = formatCNL(src, { mode: 'normalize', preserveComments: true, preserveStandaloneComments: includeStandalone });
    if (norm(formatted) !== norm(expected)) {
      console.error(`[comments] mismatch for ${f}`);
      console.error('--- Got ---');
      process.stdout.write(formatted);
      console.error('--- Expected ---');
      process.stdout.write(expected);
      fail++;
      continue;
    }
    ok++;
  }
  console.log(`Comments golden: ${ok} OK, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main();
