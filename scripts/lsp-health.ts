#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function main(): void {
  const root = process.cwd();
  const p = path.join(root, '.asteri', 'lsp-index.json');
  if (!fs.existsSync(p)) {
    console.error('No index found at', path.relative(root, p));
    process.exit(2);
  }
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf8')) as { files?: any[] };
    const files = Array.isArray(json.files) ? json.files.length : 0;
    console.log(JSON.stringify({ indexPath: path.relative(root, p), files }, null, 2));
  } catch (e: any) {
    console.error('Failed to read index:', e?.message ?? String(e));
    process.exit(1);
  }
}

main();

