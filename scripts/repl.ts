#!/usr/bin/env node
import readline from 'node:readline';
// import fs from 'node:fs';
import { parseSource, resolveAndLowerChecked } from '../src/compile-pipeline.js';
import { formatModule } from '../src/core/pretty_core.js';
import { DiagnosticError, formatDiagnostic } from '../src/diagnostics/diagnostics.js';

const BANNER = `Aster REPL (v0)
Type CNL statements or paste a module. End input with an empty line to evaluate.
Commands: :q to quit, :h for help.`;

function help(): void {
  console.log(`Commands:
  :q  quit
  :h  help
  :f  toggle formatter output (Core pseudocode vs JSON)`);
}

async function repl(): Promise<void> {
  console.log(BANNER);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });
  let buffer: string[] = [];
  let pretty = true;

  rl.prompt();

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (trimmed === ':q') {
      rl.close();
      return;
    }
    if (trimmed === ':h') {
      help();
      rl.prompt();
      return;
    }
    if (trimmed === ':f') {
      pretty = !pretty;
      console.log(`Formatter: ${pretty ? 'on' : 'off'}`);
      rl.prompt();
      return;
    }

    if (trimmed === '') {
      // evaluate
      const src = buffer.join('\n');
      buffer = [];
      if (!src.trim()) {
        rl.prompt();
        return;
      }
      try {
        // 名称解析 R1 → lower → R2（ADR 0051）；E8xx 抛 NameResolutionError，不输出 IR
        const core = resolveAndLowerChecked(parseSource(src).ast).core;
        if (pretty) {
          console.log(formatModule(core));
        } else {
          console.log(JSON.stringify(core, null, 2));
        }
      } catch (e: unknown) {
        if (e instanceof DiagnosticError) {
          console.error(formatDiagnostic(e.diagnostic, src));
        } else {
          const err = e as { message?: string; pos?: { line: number; col: number } };
          const pos = err.pos ? `:${err.pos.line}:${err.pos.col}` : '';
          console.error(`Error${pos}: ${err.message ?? String(e)}`);
        }
      }
      rl.prompt();
    } else {
      buffer.push(line);
      rl.setPrompt('… ');
      rl.prompt();
      rl.setPrompt('> ');
    }
  });

  rl.on('close', () => process.exit(0));
}

repl();
