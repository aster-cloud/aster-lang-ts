import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalDecimalFromLiteral } from '../../../src/core/canonical-decimal.js';
import { CoreIrFormatError, readCoreIr } from '../../../src/core/read-core-ir.js';
import { serializeCoreIr, validateCoreIrInvariants, type CoreIrProblem } from '../../../src/core/serialize-core-ir.js';
import { locateLocalesCoreIr } from '../../helpers/locales-core-ir.js';

// ADR 0055 §3 / §5：readCoreIr 与 Java CoreIrJson.read 用 locales 的同一套夹具核对。
// 比较规则（locales core-ir/README.md「夹具的比较规则」）：期望 code 为 schema 的夹具只比 code，
// 不变式夹具比 {path, code} 全等；三个 schemaVersion 夹具在 schema 校验之前即报版本错误。
interface Expected {
  readonly file: string;
  readonly problems: readonly CoreIrProblem[];
}

const VERSION_FIXTURES = new Set([
  'bad-missing-schema-version.json',
  'bad-schema-version-1.json',
  'bad-schema-version-string.json',
]);

const expectedPath = locateLocalesCoreIr(join('test-fixtures', 'expected-problems.json'));
const fixtureDir = expectedPath === undefined ? undefined : dirname(expectedPath);
const expected: readonly Expected[] = expectedPath === undefined
  ? []
  : (JSON.parse(readFileSync(expectedPath, 'utf8')) as Expected[]);

/** 与 validateCoreIrInvariants 相同的排序：先 path、再 code（码元序）。 */
function byPathThenCode(a: CoreIrProblem, b: CoreIrProblem): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.code === b.code ? 0 : a.code < b.code ? -1 : 1;
}

function readError(json: string): CoreIrFormatError {
  try {
    readCoreIr(json);
  } catch (e) {
    if (e instanceof CoreIrFormatError) return e;
    throw e;
  }
  assert.fail('readCoreIr 应当拒收');
}

describe('readCoreIr rejects every locales bad fixture with expected problems', () => {
  test('夹具目录存在且 expected-problems.json 覆盖目录中的每个夹具', (t) => {
    if (fixtureDir === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
    const onDisk = readdirSync(fixtureDir).filter(f => /^(bad|ok)-.*\.json$/.test(f)).sort();
    assert.deepEqual(expected.map(e => e.file).sort(), onDisk);
    assert.ok(onDisk.filter(f => f.startsWith('bad-')).length >= 24, '负例数异常偏少');
  });

  for (const { file, problems } of expected) {
    test(file, () => {
      const json = readFileSync(join(fixtureDir!, file), 'utf8');
      if (problems.length === 0) {
        assert.doesNotThrow(() => readCoreIr(json));
        return;
      }
      const err = readError(json);
      if (VERSION_FIXTURES.has(file)) {
        assert.equal(err.code, 'unsupported_schema_version');
        return;
      }
      assert.equal(err.code, 'invalid_request');
      if (problems.every(p => p.code === 'schema')) {
        assert.ok(err.problems.length > 0);
        assert.deepEqual([...new Set(err.problems.map(p => p.code))], ['schema']);
      } else {
        // 不变式夹具必须先通过 schema，问题列表只含不变式问题
        assert.deepEqual(err.problems, [...problems].sort(byPathThenCode));
      }
    });
  }
});

describe('readCoreIr 版本预检查与解析错误', () => {
  test('非 JSON 报 invalid_request', () => {
    assert.equal(readError('{').code, 'invalid_request');
  });
  test('数组、null 与缺失 schemaVersion 都报 unsupported_schema_version', () => {
    for (const json of ['[]', 'null', '{"kind":"Module"}', '{"schemaVersion":"2"}', '{"schemaVersion":1}']) {
      assert.equal(readError(json).code, 'unsupported_schema_version', json);
    }
  });
  test('版本正确但形状不对报 invalid_request 且问题 code 为 schema', () => {
    const err = readError('{"schemaVersion":2}');
    assert.equal(err.code, 'invalid_request');
    assert.ok(err.problems.length > 0 && err.problems.every(p => p.code === 'schema'));
  });
});

describe('double literals match locales fixture', () => {
  test('每条源码字面量的规范十进制串都与夹具一致', (t) => {
    const path = locateLocalesCoreIr(join('test-fixtures', 'double-literals.json'));
    if (path === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
    const rows = JSON.parse(readFileSync(path, 'utf8')) as { source: string; canonical: string }[];
    assert.ok(rows.length >= 8);
    for (const { source, canonical } of rows) {
      assert.equal(canonicalDecimalFromLiteral(source), canonical, source);
    }
  });
  test('不经 double：超出双精度有效位的字面量原样保留', () => {
    assert.equal(canonicalDecimalFromLiteral('123456789012345678901.5'), '123456789012345678901.5');
    assert.equal(canonicalDecimalFromLiteral('-0'), '0');
    assert.equal(canonicalDecimalFromLiteral('-1.50'), '-1.5');
    assert.equal(canonicalDecimalFromLiteral('007.0'), '7');
  });
  test('输出满足 schema 的 CanonicalDecimal pattern', () => {
    const pattern = /^(0|-?[1-9][0-9]*(\.[0-9]*[1-9])?|-?0\.[0-9]*[1-9])$/;
    for (const raw of ['0.1', '1.0', '-0.0', '1E3', '0.000', '-0.25', '100']) {
      assert.match(canonicalDecimalFromLiteral(raw), pattern, raw);
    }
  });
});

describe('serializeCoreIr', () => {
  test('ok 夹具读入后规范输出：键按码点升序，null 与空数组显式输出，读回仍通过', (t) => {
    if (fixtureDir === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
    for (const file of expected.filter(e => e.problems.length === 0).map(e => e.file)) {
      const module = readCoreIr(readFileSync(join(fixtureDir, file), 'utf8'));
      const bytes = serializeCoreIr(module);
      assert.ok(bytes.startsWith('{"decls":['), file);
      assert.ok(bytes.includes('"written":null'), file);
      assert.deepEqual(readCoreIr(bytes), module, file);
      assert.equal(serializeCoreIr(readCoreIr(bytes)), bytes, `${file} 规范输出应当幂等`);
    }
  });
  test('validateCoreIrInvariants 对 ok 夹具无问题', (t) => {
    if (fixtureDir === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
    for (const file of expected.filter(e => e.problems.length === 0).map(e => e.file)) {
      const module = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
      assert.deepEqual(validateCoreIrInvariants(module), [], file);
    }
  });
});
