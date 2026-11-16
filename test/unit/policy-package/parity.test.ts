import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES } from '../../../src/policy-package/errors.js';
import { PACKAGE_V1, readFixtureJson } from '../../helpers/package-v1.js';

// 包格式 v1 的 schema 副本与错误码表必须与 aster-lang-test 真相源逐字节 / 逐条一致（ADR 0059 P1 T2）。
const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;

for (const name of ['manifest-1.0.schema.json', 'sig-1.0.schema.json']) {
  test(`schema 副本与真相源逐字节相同：${name}`, { skip }, () => {
    const ours = readFileSync(join(process.cwd(), 'src/policy-package/schema', name));
    const theirs = readFileSync(join(PACKAGE_V1!, 'schema', name));
    assert.ok(ours.equals(theirs), `${name} 与 aster-lang-test 不同，重新复制`);
  });
}

test('错误码表与 exit-codes.json 逐条一致', { skip }, () => {
  const truth = readFixtureJson<{ codes: Record<string, { exit: number; message: string }> }>('exit-codes.json');
  assert.deepEqual(
    Object.fromEntries(Object.entries(ERROR_CODES).map(([k, v]) => [k, { exit: v.exit, message: v.message }])),
    truth.codes,
  );
});

test('内置信任锚 P1 为空', () => {
  const jwks = JSON.parse(readFileSync(join(process.cwd(), 'src/policy-package/trust/export-jwks.json'), 'utf8')) as unknown;
  assert.deepEqual(jwks, { keys: [] });
});
