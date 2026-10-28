#!/usr/bin/env node
import fs from 'node:fs';
import { parseSource, resolveAndLower } from '../src/index.js';
import { DiagnosticError, formatDiagnostic } from '../src/diagnostics/diagnostics.js';

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: emit-core <file.aster>');
    process.exit(2);
  }
  const input = fs.readFileSync(file, 'utf8');
  try {
    const { ast } = parseSource(input);
    // 名称解析 R1 → lower → R2（ADR 0051）；任一 E8xx 不输出 IR
    const { core, diagnostics } = resolveAndLower(ast);
    for (const d of diagnostics) console.error(`${d.severity}: ${d.code} ${d.message}`);
    if (diagnostics.some((d) => d.severity === 'error')) process.exit(1);
    console.log(JSON.stringify(prune(core), null, 2));
  } catch (e: unknown) {
    if (e instanceof DiagnosticError) {
      console.error(formatDiagnostic(e.diagnostic, input));
    } else if (typeof e === 'object' && e && 'message' in e) {
      const err = e as { message?: string; pos?: { line: number; col: number } };
      const pos = err.pos ? `:${err.pos.line}:${err.pos.col}` : '';
      console.error(`Error${pos}: ${err.message ?? 'unknown error'}`);
    } else {
      console.error('Unknown error');
    }
    process.exit(1);
  }
}

main();

function prune(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(prune);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'typeParams' && Array.isArray(v) && v.length === 0) continue;
      // Drop provenance/ancillary fields from comparisons
      if (k === 'span' || k === 'file' || k === 'origin' || k === 'nameSpan' || k === 'variantSpans') continue;
      out[k] = prune(v as unknown);
    }
    return out;
  }
  return obj;
}
