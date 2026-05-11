#!/usr/bin/env node
/**
 * Reverse inventory: feed every "java" sample from the shared corpus
 * (cloud.aster-lang:aster-lang-test, npm: @aster-cloud/aster-lang-test)
 * through the TypeScript parser. Per the dual-engine bidirectional-equivalence
 * principle (RFC §8.5), failures here represent grammar features Java ANTLR
 * accepts but TS PEG does not.
 *
 * Corpus source: linked locally at ../aster-lang-test/packages/js (until the
 * package is published).
 *
 * Output: markdown table to stdout + cluster tally to stderr.
 *
 * Usage:
 *   cd aster-lang-ts && pnpm build
 *   node scripts/java-corpus-parse-inventory.mjs
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDefaultLexicons, EN_US } from '../dist/src/config/lexicons/index.js';
import { canonicalize } from '../dist/src/frontend/canonicalizer.js';
import { lex } from '../dist/src/frontend/lexer.js';
import { parse } from '../dist/src/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Prefer the published package; fall back to the sibling monorepo for dev.
async function loadCorpus() {
  try {
    return await import('@aster-cloud/aster-lang-test');
  } catch {
    const local = resolve(__dirname, '..', '..', 'aster-lang-test', 'packages', 'js', 'dist', 'loader.js');
    const url = new URL('file://' + local);
    return await import(url);
  }
}

function tryParse(source) {
  initializeDefaultLexicons();
  const canonical = canonicalize(source, EN_US);
  const tokens = lex(canonical, EN_US);
  const result = parse(tokens, EN_US);
  if (result.diagnostics && result.diagnostics.length > 0) {
    return { ok: false, err: formatDiag(result.diagnostics[0]) };
  }
  return { ok: true };
}

function formatDiag(d) {
  const loc = d.span?.start ? `L${d.span.start.line}:${d.span.start.col}` : '?';
  let msg = d.message || String(d);
  if (msg.length > 140) msg = msg.slice(0, 137) + '...';
  return `${loc} ${msg}`;
}

async function main() {
  const { listSamples } = await loadCorpus();

  // Scope: samples where engines includes "java" AND tier != 3
  // (tier3 is single-engine fixture by design, not part of equivalence target).
  const samples = listSamples().filter(
    (s) => s.meta.engines.includes('java') && s.meta.tier !== 3,
  );

  console.log('# Java-engine corpus → TS PEG parse inventory');
  console.log();
  console.log(`Discovered ${samples.length} samples claiming java support`);
  console.log();
  console.log('| Sample | TS parse | First error |');
  console.log('|---|---|---|');

  let pass = 0, fail = 0;
  const failures = [];

  for (const sample of samples) {
    const source = sample.readSource();
    let result;
    try {
      result = tryParse(source);
    } catch (e) {
      result = { ok: false, err: `THROWN: ${e?.name || 'Error'}: ${e?.message || e}`.slice(0, 200) };
    }
    if (result.ok) {
      pass++;
    } else {
      fail++;
      const safe = result.err.replace(/\|/g, '\\|');
      console.log(`| ${sample.path} | ❌ | ${safe} |`);
      failures.push({ path: sample.path, err: result.err });
    }
  }

  console.log();
  console.log(`Total: ${samples.length}, Pass: ${pass}, Fail: ${fail}, Pass-rate: ${samples.length ? ((pass / samples.length) * 100).toFixed(1) : 0}%`);

  if (failures.length > 0) {
    const tally = new Map();
    for (const f of failures) {
      const key = f.err
        .replace(/L\d+:\d+ /, '')
        .replace(/'[^']+'/g, "'<TOKEN>'")
        .slice(0, 120);
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    console.error('\n=== Failure clusters (root-cause tally) ===');
    [...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      console.error(`  ${String(v).padStart(4)} × ${k}`);
    });
  }

  // Gate: tier1 must always be 100% parsable by both engines.
  const tier1Fails = failures.filter((f) => f.path.includes('tier1-equivalence'));
  if (tier1Fails.length > 0) {
    console.error(`\n❌ GATE FAIL: ${tier1Fails.length} tier1 sample(s) failed TS parse — see above`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Inventory failed:', e);
  process.exit(1);
});
