#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

function cleanup(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line0 of lines) {
    const line = line0 ?? '';
    if (/^\s*\/\//.test(line)) continue; // drop comment lines
    out.push(line);
  }
  let s = out.join('\n');
  // Fix header two-arg comma to 'and'
  s = s.replace(/(To\s+[^\n]*with\s+[^:,]+:[^,\n]+),\s*([^:,\n]+:[^,\n]+)(,\s*produce\s+)/g, '$1 and $2, produce ');
  // Also fix map headers where 'Map' should be 'map' (keyword)
  s = s.replace(/Map\s+Text\s+to\s+Text/g, 'map Text to Text');
  // Replace placeholder return
  s = s.replace(/Return\s+<expr>\./g, 'Return none.');
  // Fix common operator-calls to CNL word operators
  s = s.replace(/Return\s+<\(([^,]+),\s*([^)]+)\)\./g, 'Return $1 less than $2.');
  s = s.replace(/Return\s+\+\(([^,]+),\s*([^)]+)\)\./g, 'Return $1 plus $2.');
  return s;
}

function main(): void {
  const dir = path.join(process.cwd(), 'cnl', 'examples');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.aster')).map(f => path.join(dir, f));
  let updated = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const out = cleanup(src);
    if (out !== src) {
      fs.writeFileSync(f, out, 'utf8');
      updated++;
    }
  }
  console.log(`Cleaned ${updated}/${files.length} example files.`);
}

main();
