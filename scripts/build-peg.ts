#!/usr/bin/env node
import fs from 'node:fs';
import peggy from 'peggy';

const src = fs.readFileSync('src/peg/headers.pegjs', 'utf8');
const parser = peggy.generate(src, {
  output: 'source',
  format: 'es',
  allowedStartRules: ['Start'],
});
fs.mkdirSync('dist/peg', { recursive: true });
fs.writeFileSync('dist/peg/headers-parser.js', parser);
console.log('Built headers PEG parser → dist/peg/headers-parser.js');
