#!/usr/bin/env node
import * as fsn from 'node:fs';
import * as path from 'node:path';
import * as fc from 'fast-check';
import { buildCstLossless } from '../../src/cst/cst_builder.js';
import { printCNLFromCst } from '../../src/cst/cst_printer.js';

function readExamples(): string[] {
  const dir = path.join(process.cwd(), 'test/cnl', 'programs');

  // Recursively find all .aster files
  function findAsterFiles(directory: string): string[] {
    const entries = fsn.readdirSync(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...findAsterFiles(fullPath));
      } else if (entry.name.endsWith('.aster')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const files = findAsterFiles(dir);
  return files.map(f => fsn.readFileSync(f, 'utf8'));
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function injectTrivia(src: string, seed: number): string {
  // Replace spaces around common separators with random trivia; add random blank lines and comments
  const rnd = mulberry32(seed >>> 0);
  const pick = (arr: string[]) => arr[Math.floor(rnd() * arr.length)]!;
  const WS = [' ', '  ', '\t', ' \t', '\t ', ''];
  // Randomize EOL modes: LF or CRLF sequences
  const EOL = ['\n', '\n\n', '\n\n\n', '\r\n', '\r\n\r\n'];
  const COM = [' // fuzz', ' // fuzz comment', ' # fuzz'];

  let s = src;
  // Spaces before punctuation
  s = s.replace(/\s*,\s*/g, () => pick(WS) + ',' + pick(WS));
  s = s.replace(/\s*:\s*/g, () => pick(WS) + ':' + pick(WS));
  s = s.replace(/\s*\)\s*/g, () => ')' + pick(WS));
  s = s.replace(/\s*\(\s*/g, () => pick(WS) + '(' + pick(WS));
  s = s.replace(/\s*\.\s*/g, () => pick(WS) + '.' + pick(WS));
  // Randomly add comment before EOL
  s = s.replace(/\.[ \t]*\n/g, () => '.' + (Math.floor(rnd() * 3) === 0 ? pick(COM) : '') + pick(EOL));
  // Random blank lines inserted after headers
  s = s.replace(/:\n/g, () => ':' + pick(EOL));

  // Optionally add BOM at file start
  if (Math.floor(rnd() * 4) === 0 && !/^\uFEFF/.test(s)) s = '\uFEFF' + s;
  
  // Indentation tweaks: insert tabs before existing indentation without changing space count
  const lines = s.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    // Measure leading spaces
    const m = lines[i]!.match(/^(\s*)(.*)$/);
    if (!m) continue;
    const lead = m[1] ?? '';
    const rest = m[2] ?? '';
    // Only alter lines that begin with multiples of two spaces (valid indent) possibly preceded by tabs/spaces
    const spMatch = lead.match(/^(\t| )*( *)(.*)$/);
    const baseSpaces = spMatch ? (spMatch[2] ?? '') : '';
    if (baseSpaces.length % 2 !== 0) continue; // avoid breaking indent structure
    // Insert 0-2 tabs before the spaces with small probability
    const tabsToInsert = Math.floor(rnd() * 3); // 0..2
    const maybeTabs = '\t'.repeat(tabsToInsert);
    // With some probability, add trailing spaces at end of line
    const trail = Math.floor(rnd() * 4) === 0 ? (rnd() < 0.5 ? ' ' : '\t') : '';
    lines[i] = maybeTabs + baseSpaces + rest + trail;
  }
  s = lines.join('\n');
  return s;
}

function fuzzLosslessIdempotence(): void {
  const examples = readExamples();
  // For a subset of examples, generate random variants and check identity
  let cases = 0;
  const sampleCount = Math.min(20, examples.length);
  for (let i = 0; i < sampleCount; i++) {
    const base = examples[i]!;
    try {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed: number) => {
          const mutated = injectTrivia(base, seed);
          const cst = buildCstLossless(mutated);
          const out = printCNLFromCst(cst);
          return out === mutated;
        }),
        { numRuns: 200, seed: 42 + i } // Fixed seed for deterministic testing, offset by example index
      );
    } catch (e) {
      console.error(`Failed on example index ${i}`);
      throw e;
    }
    cases += 200;
  }
  console.log(`✓ Lossless CST identity under trivia/comments: ${cases} cases`);
}

function main(): void {
  try {
    fuzzLosslessIdempotence();
    console.log('\n✅ Lossless CST fuzz test passed');
  } catch (e) {
    console.error('\n❌ Lossless CST fuzz test failed:', (e as Error).message);
    process.exit(1);
  }
}

main();
