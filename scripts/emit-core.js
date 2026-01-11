#!/usr/bin/env node
import fs from 'node:fs';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/core/parser.js';
import { lowerModule } from '../src/lower_to_core.js';
function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: emit-core <file.aster>');
    process.exit(2);
  }
  const input = fs.readFileSync(file, 'utf8');
  try {
    const can = canonicalize(input);
    const toks = lex(can);
    const ast = parse(toks);
    const core = lowerModule(ast);
    console.log(JSON.stringify(core, null, 2));
  } catch (e) {
    const pos = e.pos ? `:${e.pos.line}:${e.pos.col}` : '';
    console.error(`Error${pos}: ${e.message}`);
    process.exit(1);
  }
}
main();
//# sourceMappingURL=emit-core.js.map
