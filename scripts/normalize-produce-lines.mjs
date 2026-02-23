#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

function normalizeLine(line) {
  const trimmed = line.trimStart();
  if (!(trimmed.startsWith('Rule ') || trimmed.startsWith('To ') || line.includes('function'))) return line;
  const idx = line.indexOf('produce');
  if (idx === -1) return line;
  const after = line.slice(idx + 'produce'.length);
  const afterTrim = after.trimStart();
  if (afterTrim.length === 0) return line;
  if (afterTrim.toLowerCase().startsWith('with ')) return line;
  if (afterTrim.startsWith(':')) return line;
  if (afterTrim.startsWith('.')) {
    if (afterTrim.length === 1 || !/\s/.test(afterTrim[1] || '')) {
      // fall through: corrupted inline content
    } else {
      return line;
    }
  }
  const commentIdx = line.indexOf('//');
  const base = line.slice(0, idx + 'produce'.length) + ':';
  if (commentIdx !== -1 && commentIdx > idx) {
    return base + ' ' + line.slice(commentIdx);
  }
  return base;
}

function normalizeFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split(/\r?\n/);
  let changed = false;
  const out = lines.map(line => {
    const next = normalizeLine(line);
    if (next !== line) changed = true;
    return next;
  });
  if (changed) fs.writeFileSync(filePath, out.join('\n'), 'utf8');
  return changed;
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.aster')) out.push(full);
  }
}

function main() {
  const roots = ['examples', 'test'];
  const files = [];
  for (const r of roots) {
    const dir = path.join(process.cwd(), r);
    if (fs.existsSync(dir)) walk(dir, files);
  }
  let updated = 0;
  for (const f of files) {
    if (normalizeFile(f)) updated++;
  }
  console.log(`Normalized ${updated}/${files.length} .aster files.`);
}

main();
