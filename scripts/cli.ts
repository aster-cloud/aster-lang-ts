#!/usr/bin/env node
import fs from 'node:fs';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import { DiagnosticError, formatDiagnostic } from '../src/diagnostics/diagnostics.js';

function main(): void {
  const file = process.argv[2];
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  try {
    const can = canonicalize(input);
    const toks = lex(can);
    const ast = parse(toks);
    console.log(JSON.stringify(prune(ast), null, 2));
  } catch (e: unknown) {
    if (e instanceof DiagnosticError) {
      console.error(formatDiagnostic(e.diagnostic, input));
    } else {
      // Fallback for non-diagnostic errors
      const err = e as { message?: string; pos?: { line: number; col: number } };
      const pos = err.pos ? `:${err.pos.line}:${err.pos.col}` : '';
      console.error(`Error${pos}: ${err.message ?? String(e)}`);
      if (err.pos) {
        const lines = input.split(/\r?\n/);
        const ln = err.pos.line - 1;
        const context = lines[ln] || '';
        console.error(`> ${err.pos.line}| ${context}`);
        console.error(
          `> ${' '.repeat(String(err.pos.line).length)}  ${' '.repeat(err.pos.col - 1)}^`
        );
      }
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
      out[k] = prune(v as unknown);
    }
    return out;
  }
  return obj;
}
