#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function main(): void {
  const cachePath = path.resolve('build/.asteri/method-cache.json');
  if (!fs.existsSync(cachePath)) {
    console.log('No method cache found at', cachePath);
    process.exit(0);
  }
  const raw = fs.readFileSync(cachePath, 'utf8');
  const json = JSON.parse(raw) as Record<string, string[]>;
  const owners = Object.keys(json).sort();
  console.log('Method cache:', cachePath);
  console.log('Owners:', owners.length);
  for (const owner of owners) {
    const entries = (json[owner] || []).slice().sort();
    console.log(`- ${owner} (${entries.length})`);
    for (const e of entries) {
      console.log(`   • ${e}`);
    }
  }
}

main();

