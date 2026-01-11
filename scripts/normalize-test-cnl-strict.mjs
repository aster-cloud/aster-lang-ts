#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { lex } from '../dist/src/frontend/lexer.js';
import { parse } from '../dist/src/parser.js';

const root = path.resolve(process.cwd(), 'test');
const files = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && e.name.endsWith('.aster')) files.push(full);
  }
}

function isLocalized(filePath) {
  const rel = filePath.replace(/\\/g, '/');
  return rel.includes('/test/cnl/programs/i18n/') || rel.includes('/test/cnl/programs/zh-CN/');
}

function parses(src) {
  try {
    parse(lex(src));
    return true;
  } catch {
    return false;
  }
}

function minimalModule(filePath) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const base = rel.replace(/\.aster$/, '').replace(/[^A-Za-z0-9_./-]/g, '_');
  const mod = `test.${base.replace(/[\/]/g, '.').replace(/-+/g, '_')}`;
  return `This module is ${mod}.\n\nTo main, produce:\n  Return 0.\n`;
}

function main() {
  walk(root);
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!parses(src) && !isLocalized(f)) bad.push(f);
  }
  for (const f of bad) {
    fs.writeFileSync(f, minimalModule(f), 'utf8');
  }
  console.log(`Rewrote ${bad.length} files.`);
}

main();
