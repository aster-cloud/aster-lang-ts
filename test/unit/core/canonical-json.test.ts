import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICALIZATION_VERSION,
  CanonicalJsonError,
  canonicalJson,
  decimalTypeContext,
} from '../../../src/core/canonical-json.js';
import { locateSiblingSource } from '../../helpers/sibling-source.js';

// 与 core CanonicalJsonParityTest 共用同一份 golden 夹具（ADR 0055 §5）：TS 产出 == 夹具 == Java 产出。
interface Fixture {
  readonly name: string;
  readonly input: unknown;
  readonly decimalPaths: readonly string[];
  readonly canonical: string;
  readonly hash: string;
}

const root = process.cwd();
const FIXTURE = join('test', 'fixtures', 'canonical', 'canonical-json-fixtures.json');
const fixtureText = readFileSync(join(root, FIXTURE), 'utf8');
const fixtures = JSON.parse(fixtureText) as { version: string; cases: Fixture[] };

test('canonical-json golden：夹具版本与算法版本一致且用例不少于 20 个', () => {
  assert.equal(fixtures.version, CANONICALIZATION_VERSION);
  assert.ok(fixtures.cases.length >= 20, `用例数异常偏少（${fixtures.cases.length}）`);
});

for (const f of fixtures.cases) {
  test(`canonical-json golden：${f.name}`, () => {
    const actual = canonicalJson(f.input, decimalTypeContext(f.decimalPaths));
    assert.equal(actual, f.canonical);
    const hash = createHash('sha256').update(`${CANONICALIZATION_VERSION}\n${actual}`, 'utf8').digest('hex');
    assert.equal(hash, f.hash);
  });
}

test('canonical-json 夹具与 core 副本逐字节一致', (t) => {
  const cwd = process.cwd();
  const source = locateSiblingSource(
    [
      join(cwd, '..', 'aster-lang-core', 'src', 'test', 'resources', 'canonical', 'canonical-json-fixtures.json'),
      join(cwd, 'aster-lang-core', 'src', 'test', 'resources', 'canonical', 'canonical-json-fixtures.json'),
    ],
    'aster-lang-core 以校验 canonical-json 夹具副本',
  );
  if (source === undefined) return t.skip('本地未并列 checkout aster-lang-core');
  assert.equal(fixtureText, readFileSync(source, 'utf8'));
});

test('非 Decimal 路径上的非整数与 undefined 被拒收', () => {
  assert.throws(() => canonicalJson({ x: 0.1 }), (e: unknown) => e instanceof CanonicalJsonError && e.reason === 'NON_INTEGER_NUMBER');
  assert.throws(() => canonicalJson({ x: undefined }), (e: unknown) => e instanceof CanonicalJsonError && e.reason === 'UNSUPPORTED_VALUE');
});
