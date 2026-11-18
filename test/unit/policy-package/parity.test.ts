import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../../../src/core/canonical-json.js';
import { ERROR_CODES, PackageError } from '../../../src/policy-package/errors.js';
import { readPackage } from '../../../src/policy-package/read-package.js';
import { verifySignature } from '../../../src/policy-package/signature.js';
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
  // conformance 测试密钥（keys/README.md）的公钥不得出现在内置锚中
  assert.ok(jwks.keys.every((k) => k['x'] !== '8dfz-daPQgc3ZDU3qhgH23T0RCgeJU6POxG70ZlJ9HA'));
});

/** 把 a-decimal 复制到临时目录并改写签名文件的 kid，再用内置锚（不给 --jwks / --pubkey）验签。 */
function verifyWithBuiltinAnchor(kid: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'builtin-anchor-'));
  try {
    const pkgDir = join(dir, 'a-decimal');
    cpSync(join(PACKAGE_V1!, 'packages', 'a-decimal'), pkgDir, { recursive: true });
    const sigPath = join(pkgDir, 'manifest.sig.json');
    const sig = JSON.parse(readFileSync(sigPath, 'utf8')) as Record<string, string>;
    writeFileSync(sigPath, canonicalJson({ ...sig, kid }));
    try {
      verifySignature(readPackage(pkgDir), builtinTrustAnchor(), { allowUnsigned: false });
      return null;
    } catch (e) {
      if (e instanceof PackageError) return e.code;
      throw e;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('不给锚选项时按内置锚验签：生产 kid 走到签名比对，测试 kid 不受信', { skip }, () => {
  // 签名不是生产私钥签的，所以是 PKG_SIGNATURE 而不是 PKG_UNTRUSTED_KID：证明内置锚确实按 kid 取到了生产公钥
  assert.equal(verifyWithBuiltinAnchor('export-2026-11a'), 'PKG_SIGNATURE');
  assert.equal(verifyWithBuiltinAnchor('test-2026-11'), 'PKG_UNTRUSTED_KID');
});
