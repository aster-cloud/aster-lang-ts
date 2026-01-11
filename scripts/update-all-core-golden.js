#!/usr/bin/env node
/**
 * Update all Core IR golden test files to match current compiler output.
 * This is needed when the Core IR structure changes (e.g., adding annotations support).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, lex, parse } from '../dist/src/index.js';
import { lowerModule } from '../dist/src/lower_to_core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__dirname);
const programsDir = path.join(rootDir, 'test', 'cnl', 'programs');

function collectAsterFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectAsterFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.aster')) {
      results.push(fullPath);
    }
  }
  return results;
}

const asterFiles = collectAsterFiles(programsDir);
console.log(`Found ${asterFiles.length} .aster files under test/cnl/programs`);

let updated = 0;
let errors = 0;

for (const asterPath of asterFiles) {
  const dir = path.dirname(asterPath);
  const baseName = path.basename(asterPath, '.aster');
  const corePath = path.join(dir, `expected_${baseName}_core.json`);

  if (!fs.existsSync(corePath)) {
    continue;
  }

  try {
    const src = fs.readFileSync(asterPath, 'utf8');
    const can = canonicalize(src);
    const toks = lex(can);
    const ast = parse(toks);
    const core = lowerModule(ast);

    const pruned = JSON.parse(
      JSON.stringify(core, (key, value) => {
        if (key === 'origin' || key === 'span' || key === 'nameSpan' || key === 'variantSpans') {
          return undefined;
        }
        return value;
      })
    );

    fs.writeFileSync(corePath, JSON.stringify(pruned, null, 2) + '\n', 'utf8');
    updated++;
    console.log(`✓ Updated ${path.relative(rootDir, corePath)}`);
  } catch (e) {
    errors++;
    console.error(`✗ Failed to update ${path.relative(rootDir, corePath)}:`, e.message);
  }
}

console.log(`\nSummary: ${updated} updated, ${errors} errors`);
process.exitCode = errors > 0 ? 1 : 0;
