#!/usr/bin/env node
/**
 * Dual-engine stdio runner for cross-language semantic equivalence testing.
 *
 * Invoked by Java side (DualEngineGoldenTest) via ProcessBuilder. Reads a JSON
 * request from stdin, evaluates the policy using the TypeScript engine, and
 * writes the result as JSON to stdout. Errors → exit code 1 + stderr.
 *
 * Request shape (one JSON object per stdin):
 *   {
 *     "source": "<Aster CNL source>",
 *     "entry": "<function name to invoke>",
 *     "input": [<positional args>]
 *   }
 *
 * Response shape (stdout):
 *   { "success": true, "value": <result> }
 *   { "success": false, "error": "<message>" }
 *
 * Usage:
 *   cd aster-lang-ts && pnpm install && pnpm build
 *   echo '{"source":"...","entry":"add","input":[1,2]}' | node scripts/dual-engine-runner.mjs
 */
import { compile } from '../dist/src/browser.js';
import { evaluate } from '../dist/src/core/interpreter.js';

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stderr.write('Empty input\n');
    process.exit(1);
  }

  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`Invalid JSON request: ${err.message}\n`);
    process.exit(1);
  }

  const { source, entry, input } = request;
  if (!source || !entry || !Array.isArray(input)) {
    process.stderr.write('Request must have { source, entry, input: [] }\n');
    process.exit(1);
  }

  // Compile CNL source → Core IR
  const compileResult = compile(source);
  if (!compileResult.success || !compileResult.core) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Compile failed: ${(compileResult.errors || []).map(e => e.message).join('; ')}`,
    }) + '\n');
    process.exit(0);
  }

  // Map positional `input` array to named function parameters
  const fn = (compileResult.core.decls || []).find(
    (d) => d.kind === 'Func' && d.name === entry,
  );
  if (!fn) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Function '${entry}' not found in module`,
    }) + '\n');
    process.exit(0);
  }

  const context = {};
  const paramNames = (fn.params || []).map((p) => p.name);
  // Arity mismatch silently dropped/ignored args before, masking test bugs and
  // producing misleading cross-engine results. Fail explicitly instead.
  if (input.length !== paramNames.length) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Arity mismatch for '${entry}': expected ${paramNames.length} argument(s) [${paramNames.join(', ')}], got ${input.length}`,
    }) + '\n');
    process.exit(0);
  }
  for (let i = 0; i < paramNames.length; i++) {
    context[paramNames[i]] = input[i];
  }

  const result = evaluate(compileResult.core, entry, context);
  process.stdout.write(JSON.stringify({
    success: result.success,
    value: result.value,
    error: result.error,
  }) + '\n');
}

main().catch((err) => {
  process.stderr.write(`Runner error: ${err.stack || err.message}\n`);
  process.exit(1);
});
