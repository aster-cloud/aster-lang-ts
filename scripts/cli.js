#!/usr/bin/env node
import fs from 'node:fs';
import { canonicalize } from '../src/canonicalizer.js';
import { lex } from '../src/lexer.js';
import { parse } from '../src/parser.js';
function main() {
  const file = process.argv[2];
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  try {
    const can = canonicalize(input);
    const toks = lex(can);
    const ast = parse(toks);
    console.log(JSON.stringify(ast, null, 2));
  } catch (e) {
    const pos = e.pos ? `:${e.pos.line}:${e.pos.col}` : '';
    console.error(`ParseError${pos}: ${e.message}`);
    if (e.pos) {
      const lines = input.split(/\r?\n/);
      const ln = e.pos.line - 1;
      const context = lines[ln] || '';
      console.error(`> ${e.pos.line}| ${context}`);
      console.error(`> ${' '.repeat(String(e.pos.line).length)}  ${' '.repeat(e.pos.col - 1)}^`);
    }
    process.exit(1);
  }
}
main();
//# sourceMappingURL=cli.js.map
