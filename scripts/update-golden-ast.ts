#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { canonicalize, lex, parse } from '../src/index.js';

function prune(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(prune);
  if (typeof obj !== 'object' || obj === null) return obj;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'span' || k === 'nameSpan') continue;
    result[k] = prune(v);
  }
  return result;
}

function updateOneAst(inputPath: string, expectPath: string): void {
  try {
    const src = fs.readFileSync(inputPath, 'utf8');
    const can = canonicalize(src);
    const toks = lex(can);
    const ast = parse(toks);
    const actual = prune(ast);

    // Write the actual output to the expected file
    fs.writeFileSync(expectPath, JSON.stringify(actual, null, 2) + '\n', 'utf8');
    console.log(`UPDATED: ${expectPath}`);
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`ERROR: ${inputPath}: ${err.message ?? String(e)}`);
    process.exitCode = 1;
  }
}

function main(): void {
  const testDir = 'test/cnl/programs';
  const files = fs.readdirSync(testDir, { recursive: true, withFileTypes: true });

  let updatedCount = 0;
  for (const entry of files) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.aster')) continue;

    // @ts-ignore - parentPath exists in Node 20+
    const asterPath = path.join(entry.parentPath ?? entry.path, entry.name);
    const expectedPath = asterPath.replace(/\.aster$/, '') + '.ast.json';
    const expectedPathWithPrefix = path.join(
      path.dirname(asterPath),
      'expected_' + path.basename(asterPath).replace(/\.aster$/, '.ast.json')
    );

    // Check if expected file exists (with or without prefix)
    if (fs.existsSync(expectedPath)) {
      updateOneAst(asterPath, expectedPath);
      updatedCount++;
    } else if (fs.existsSync(expectedPathWithPrefix)) {
      updateOneAst(asterPath, expectedPathWithPrefix);
      updatedCount++;
    }
  }

  console.log(`\nUpdated ${updatedCount} golden AST files`);
}

main();
