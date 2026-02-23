#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fc from 'fast-check';
import { formatCNL } from '../../src/formatter.js';

function idempotenceOnExamples(): void {
  const dir = path.join(process.cwd(), 'test', 'cnl', 'programs', 'basics');
  if (!fs.existsSync(dir)) {
    console.log('⏭ Skipping idempotence on examples: directory not found');
    return;
  }
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.aster'))
    .map(f => path.join(dir, f));
  let checked = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const once = formatCNL(src);
    const twice = formatCNL(once);
    if (twice !== once) {
      throw new Error(`Formatter not idempotent for ${f}`);
    }
    checked++;
  }
  console.log(`✓ Formatter idempotence on examples: ${checked} files`);
}

function fuzzIdempotence(): void {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input: string) => {
      const once = formatCNL(input);
      const twice = formatCNL(once);
      return once === twice;
    }),
    { numRuns: 200 }
  );
  console.log('✓ Formatter fuzz idempotence (200 runs)');
}

function main(): void {
  try {
    idempotenceOnExamples();
    fuzzIdempotence();
    console.log('\n✅ Formatter scaffolding tests passed');
  } catch (e) {
    console.error('\n❌ Formatter tests failed:', (e as Error).message);
    process.exit(1);
  }
}

main();
