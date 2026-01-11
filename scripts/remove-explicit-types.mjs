#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { lex } from '../dist/src/frontend/lexer.js';
import { parse } from '../dist/src/parser.js';

function getLineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function offsetAt(lineOffsets, pos) {
  const lineIdx = Math.max(0, (pos.line || 1) - 1);
  const colIdx = Math.max(0, (pos.col || 1) - 1);
  const base = lineOffsets[lineIdx] ?? 0;
  return base + colIdx;
}

function findColonBefore(text, start) {
  let i = start - 1;
  while (i >= 0 && text[i] !== '\n') {
    if (text[i] === ':') return i;
    i--;
  }
  return -1;
}

function collectLambda(expr, out) {
  if (!expr || typeof expr !== 'object') return;
  switch (expr.kind) {
    case 'Lambda': {
      for (const p of expr.params || []) {
        out.params.push(p);
      }
      out.returnTypes.push(expr.retType);
      if (expr.body && expr.body.statements) {
        for (const s of expr.body.statements) collectStatement(s, out);
      }
      return;
    }
    case 'Call':
      collectLambda(expr.target, out);
      for (const a of expr.args || []) collectLambda(a, out);
      return;
    case 'Construct':
      for (const f of expr.fields || []) collectLambda(f.expr, out);
      return;
    case 'Ok':
    case 'Err':
    case 'Some':
    case 'Await':
      collectLambda(expr.expr, out);
      return;
    case 'Match':
      collectLambda(expr.expr, out);
      for (const c of expr.cases || []) {
        if (c.body && c.body.kind === 'Block') collectBlock(c.body, out);
        else if (c.body) collectStatement(c.body, out);
      }
      return;
    default:
      return;
  }
}

function collectStatement(stmt, out) {
  if (!stmt || typeof stmt !== 'object') return;
  switch (stmt.kind) {
    case 'Let':
    case 'Set':
    case 'Return':
      collectLambda(stmt.expr, out);
      return;
    case 'If':
      collectLambda(stmt.cond, out);
      collectBlock(stmt.thenBlock, out);
      if (stmt.elseBlock) collectBlock(stmt.elseBlock, out);
      return;
    case 'Match':
      collectLambda(stmt.expr, out);
      for (const c of stmt.cases || []) {
        if (c.body && c.body.kind === 'Block') collectBlock(c.body, out);
        else if (c.body) collectStatement(c.body, out);
      }
      return;
    case 'Block':
      collectBlock(stmt, out);
      return;
    case 'Start':
      collectLambda(stmt.expr, out);
      return;
    case 'workflow':
      for (const step of stmt.steps || []) {
        collectBlock(step.body, out);
      }
      return;
    default:
      return;
  }
}

function collectBlock(block, out) {
  if (!block || !block.statements) return;
  for (const s of block.statements) collectStatement(s, out);
}

function collectTargets(ast) {
  const out = { params: [], returnTypes: [], dataFields: [] };
  for (const d of ast.decls || []) {
    if (d.kind === 'Data') {
      for (const f of d.fields || []) out.dataFields.push(f);
    } else if (d.kind === 'Func') {
      for (const p of d.params || []) out.params.push(p);
      out.returnTypes.push(d.retType);
      if (d.body) collectBlock(d.body, out);
    }
  }
  return out;
}

function applyEdits(text, edits) {
  const sorted = edits
    .filter(e => e.start >= 0 && e.end >= e.start)
    .sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.start) + out.slice(e.end);
  }
  return out;
}

function transformOutsideStrings(text, replacer) {
  let out = '';
  let buf = '';
  let inString = false;
  let stringChar = '';
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      buf += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === stringChar) {
        out += buf;
        buf = '';
        inString = false;
        stringChar = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      out += replacer(buf);
      buf = ch;
      inString = true;
      stringChar = ch;
      continue;
    }
    buf += ch;
  }
  out += replacer(buf);
  if (inString) out += buf;
  return out;
}

function fallbackTransform(src) {
  return transformOutsideStrings(src, segment => {
    let s = segment;
    s = s.replace(
      /\bproduce\s+(?:@pii\([^)]*\)\s+)?(?:List|Map|Result|Maybe|Option|Workflow|Text|Int|Float|Bool|Long|Double|Number|DateTime|[A-Z][A-Za-z0-9_]*)(?=\s*[:.\n])/g,
      'produce'
    );
    s = s.replace(
      /([\p{L}\p{N}_@)]+)\s*:\s*(?!If\b|When\b|Return\b|Let\b|Set\b|Match\b|Start\b|Wait\b|Else\b|Then\b)(?:@pii\([^)]*\)\s+)?(?:List|Map|Result|Maybe|Option|Workflow|Text|Int|Float|Bool|Long|Double|Number|DateTime|[A-Z][A-Za-z0-9_]*)(?=\s*(?:,|\.|\n|$))/gu,
      '$1'
    );
    return s;
  });
}

function readGitHead(filePath) {
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  try {
    return execSync(`git show HEAD:${rel}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function processFile(filePath) {
  const src = readGitHead(filePath) ?? fs.readFileSync(filePath, 'utf8');
  let ast;
  try {
    const tokens = lex(src);
    ast = parse(tokens);
  } catch (err) {
    console.error(`Parse failed for ${filePath}: ${err?.message || err}`);
    const fallback = fallbackTransform(src);
    if (fallback !== src) {
      fs.writeFileSync(filePath, fallback, 'utf8');
      return true;
    }
    return false;
  }
  const lineOffsets = getLineOffsets(src);
  const targets = collectTargets(ast);
  const edits = [];

  for (const field of targets.dataFields) {
    if (field.typeInferred) continue;
    const span = field.type?.span;
    if (!span) continue;
    const typeStart = offsetAt(lineOffsets, span.start);
    const typeEnd = offsetAt(lineOffsets, span.end);
    const colonPos = findColonBefore(src, typeStart);
    if (colonPos >= 0) {
      edits.push({ start: colonPos, end: typeEnd });
    }
  }

  for (const param of targets.params) {
    if (param.typeInferred) continue;
    const span = param.type?.span;
    if (!span) continue;
    const typeStart = offsetAt(lineOffsets, span.start);
    const typeEnd = offsetAt(lineOffsets, span.end);
    const colonPos = findColonBefore(src, typeStart);
    if (colonPos >= 0) {
      edits.push({ start: colonPos, end: typeEnd });
    }
  }

  for (const retType of targets.returnTypes) {
    if (!retType || retType.name === 'Unknown') continue;
    const span = retType.span;
    if (!span) continue;
    let start = offsetAt(lineOffsets, span.start);
    const end = offsetAt(lineOffsets, span.end);
    const lineStart = src.lastIndexOf('\n', start - 1) + 1;
    const prefix = src.slice(lineStart, start);
    if (!/\bproduce\b/i.test(prefix)) continue;
    while (start > 0 && (src[start - 1] === ' ' || src[start - 1] === '\t')) {
      start--;
    }
    edits.push({ start, end });
  }

  const out = applyEdits(src, edits);
  if (out !== src) fs.writeFileSync(filePath, out, 'utf8');
  return out !== src;
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
    const changed = processFile(f);
    if (changed) updated++;
  }
  console.log(`Updated ${updated}/${files.length} .aster files.`);
}

main();
