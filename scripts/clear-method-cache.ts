#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function main(): void {
  const cacheDir = path.resolve('build/.asteri');
  const cachePath = path.join(cacheDir, 'method-cache.json');
  if (!fs.existsSync(cacheDir)) {
    console.log('Cache directory not found:', cacheDir);
    process.exit(0);
  }
  if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { force: true });
    console.log('Removed', cachePath);
  } else {
    console.log('No method cache file found at', cachePath);
  }
}

main();

