#!/usr/bin/env node
import fs from 'node:fs';
import { canonicalize } from '../src/canonicalizer.js';
import { lex } from '../src/lexer.js';
import { parse } from '../src/parser.js';
function runOneAst(inputPath, expectPath) {
  try {
    const src = fs.readFileSync(inputPath, 'utf8');
    const can = canonicalize(src);
    const toks = lex(can);
    const ast = parse(toks);
    const actual = JSON.stringify(ast, null, 2);
    const expected = fs.readFileSync(expectPath, 'utf8').trim();
    if (actual.trim() !== expected) {
      console.error(`FAIL: AST ${inputPath}`);
      console.error('--- Actual ---');
      console.error(actual);
      console.error('--- Expected ---');
      console.error(expected);
      process.exitCode = 1;
    } else {
      console.log(`OK: AST ${inputPath}`);
    }
  } catch (e) {
    console.error(`ERROR: AST ${inputPath}: ${e.message}`);
    process.exitCode = 1;
  }
}
async function runOneCore(inputPath, expectPath) {
  try {
    const src = fs.readFileSync(inputPath, 'utf8');
    const can = canonicalize(src);
    const toks = lex(can);
    const ast = parse(toks);
    const { lowerModule } = await import('../src/lower_to_core.js');
    const core = lowerModule(ast);
    const actual = JSON.stringify(core, null, 2);
    const expected = fs.readFileSync(expectPath, 'utf8').trim();
    if (actual.trim() !== expected) {
      console.error(`FAIL: CORE ${inputPath}`);
      console.error('--- Actual ---');
      console.error(actual);
      console.error('--- Expected ---');
      console.error(expected);
      process.exitCode = 1;
    } else {
      console.log(`OK: CORE ${inputPath}`);
    }
  } catch (e) {
    console.error(`ERROR: CORE ${inputPath}: ${e.message}`);
    process.exitCode = 1;
  }
}
async function main() {
  runOneAst('test/cnl/programs/examples/greet.aster', 'test/cnl/programs/examples/expected_greet.ast.json');
  runOneAst('test/cnl/programs/examples/login.aster', 'test/cnl/programs/examples/expected_login.ast.json');
  await runOneCore('test/cnl/programs/examples/greet.aster', 'test/cnl/programs/examples/expected_greet_core.json');
  await runOneCore('test/cnl/programs/examples/login.aster', 'test/cnl/programs/examples/expected_login_core.json');
}
main().catch(e => {
  console.error('Golden test runner failed:', e.message);
  process.exit(1);
});
//# sourceMappingURL=golden.js.map
