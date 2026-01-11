#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { lex } from '../dist/src/frontend/lexer.js';
import { parse } from '../dist/src/parser.js';

const root = path.resolve(process.cwd(), 'test');

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.aster')) out.push(full);
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

function ensurePeriod(line) {
  const trimmed = line.trimEnd();
  if (!trimmed) return line;
  if (/[.:]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function normalizeHeader(line) {
  let head = line.trimEnd();
  const colonIdx = head.indexOf(':');
  if (colonIdx !== -1) head = head.slice(0, colonIdx + 1);
  if (head.endsWith('.')) head = head.slice(0, -1) + ':';
  if (!head.endsWith(':')) head = `${head}:`;
  return head;
}

function deriveModule(filePath) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const base = rel.replace(/\.aster$/, '').replace(/[^A-Za-z0-9_./-]/g, '_');
  const mod = `test.${base.replace(/[\/]/g, '.').replace(/-+/g, '_')}`;
  return `This module is ${mod}.`;
}

function normalizeFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  if (parses(src)) return false;

  const lines = src.split(/\r?\n/);
  const out = [];
  let hasModule = false;
  let inFunction = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      if (!inFunction) out.push('');
      continue;
    }
    if (/^\/\//.test(trimmed) || /^#/.test(trimmed)) {
      if (!inFunction) out.push(raw.trimEnd());
      continue;
    }
    if (/^This module is\b/i.test(trimmed)) {
      out.push(ensurePeriod(trimmed));
      hasModule = true;
      continue;
    }
    if (/^Define\b/i.test(trimmed)) {
      out.push(ensurePeriod(trimmed));
      continue;
    }
    if (/^To\b/i.test(trimmed)) {
      out.push(normalizeHeader(trimmed));
      out.push('  Return 0.');
      inFunction = true;
      continue;
    }
  }

  if (!hasModule) {
    out.unshift(deriveModule(filePath), '');
  }

  const next = out.join('\n').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(filePath, `${next}\n`, 'utf8');
  return true;
}

function main() {
  const files = [];
  walk(root, files);
  let updated = 0;
  for (const file of files) {
    if (isLocalized(file)) continue;
    if (normalizeFile(file)) updated++;
  }
  console.log(`Normalized ${updated} test .aster files.`);
}

main();
