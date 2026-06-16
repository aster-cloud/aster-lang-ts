/**
 * Vendored corpus version guard (#24 — PARTIAL).
 *
 * The real fix for the corpus version skew (vendored 0.0.3 vs published 0.0.2 vs
 * source 1.0.2) requires publishing the corpus to npm, which is out of scope.
 *
 * As a guard, this test asserts the vendored corpus version matches the expected
 * value. When the corpus is re-published / re-synced, update
 * EXPECTED_CORPUS_VERSION here AND the tarball reference in package.json (see
 * vendor/README.md "Removal Conditions"). A mismatch here means the vendored
 * tarball drifted from what the build expects.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Bump this together with the vendored tarball in package.json on every re-sync.
const EXPECTED_CORPUS_VERSION = '0.0.3';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/test/unit → repo root
const repoRoot = join(__dirname, '..', '..', '..');

test('corpus version guard', async (t) => {
  await t.test('installed corpus matches expected version', () => {
    const pkgPath = join(
      repoRoot,
      'node_modules',
      '@aster-cloud',
      'aster-lang-test',
      'package.json'
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    assert.strictEqual(
      pkg.version,
      EXPECTED_CORPUS_VERSION,
      `Vendored corpus version drift: installed ${pkg.version}, expected ${EXPECTED_CORPUS_VERSION}. ` +
        `Re-sync required — see vendor/README.md and bump EXPECTED_CORPUS_VERSION.`
    );
  });

  await t.test('package.json references the expected vendored tarball', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
    const dep = pkg.devDependencies['@aster-cloud/aster-lang-test'];
    assert.ok(dep, 'corpus devDependency must be present');
    assert.ok(
      dep.includes(EXPECTED_CORPUS_VERSION),
      `package.json corpus reference (${dep}) must match EXPECTED_CORPUS_VERSION ${EXPECTED_CORPUS_VERSION}`
    );
  });
});
