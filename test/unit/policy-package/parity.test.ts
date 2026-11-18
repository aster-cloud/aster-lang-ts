import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '../../../src/core/canonical-json.js';
import { ERROR_CODES } from '../../../src/policy-package/errors.js';
import { anchorKids, builtinTrustAnchor } from '../../../src/policy-package/trust-anchor.js';
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

/**
 * 内置信任锚 = 生产导出密钥（ADR 0059 P2 T25，§6.2「先发布锚，再签名」）。两个 CLI 的文件逐字节相同：
 * aster-lang-truffle `cli/src/main/resources/aster/cli/export-jwks.json` 的测试断言同一 SHA-256。
 * 测试密钥（kid 以 `test-` 开头，conformance keys/README.md M4）只能经 --jwks / --pubkey 注入，绝不内置。
 */
const BUILTIN_JWKS_SHA256 = '7e24a91332d6bc04b8311d233aa09e2fb14b6a1fa40248815edc91e93a10a4f7';

test('内置信任锚：只含生产导出密钥 export-2026-11a，规范 JSON，字节与 truffle 相同', () => {
  const bytes = readFileSync(join(process.cwd(), 'src/policy-package/trust/export-jwks.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), BUILTIN_JWKS_SHA256);
  const jwks = JSON.parse(bytes.toString('utf8')) as { keys: Record<string, string>[] };
  assert.equal(bytes.toString('utf8'), `${canonicalJson(jwks)}\n`);
  assert.deepEqual(jwks.keys.map((k) => k['kid']), ['export-2026-11a']);
  for (const k of jwks.keys) {
    assert.ok(!k['kid']!.startsWith('test-'), `测试密钥不得内置：${k['kid']}`);
    assert.deepEqual([k['kty'], k['crv'], k['alg'], k['use']], ['OKP', 'Ed25519', 'EdDSA', 'sig']);
  }
  assert.deepEqual(anchorKids(builtinTrustAnchor()), ['export-2026-11a']);
});
