#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const map = [['scripts/emit-classfiles.ts', 'dist/scripts/emit-classfiles.js']];
for (const [src, dst] of map) {
  if (fs.existsSync(src)) copy(src, dst);
}
