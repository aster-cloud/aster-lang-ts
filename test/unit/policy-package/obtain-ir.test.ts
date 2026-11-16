import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PackageError } from '../../../src/policy-package/errors.js';
import { obtainIr, positionFreeSha256, compilePackageSource } from '../../../src/policy-package/obtain-ir.js';
import { readPackage } from '../../../src/policy-package/read-package.js';
import { sha256Hex } from '../../../src/policy-package/integrity.js';
import { PACKAGE_V1, readFixtureJson } from '../../helpers/package-v1.js';

const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;
const pkg = (rel: string): ReturnType<typeof readPackage> => readPackage(join(PACKAGE_V1!, rel));

test('position-free-hash 向量：sha256 与投影哈希', { skip }, () => {
  const { vectors } = readFixtureJson<{ vectors: { name: string; coreJson: string; sha256: string; positionFreeSha256: string }[] }>(
    'vectors/position-free-hash.json',
  );
  assert.ok(vectors.length >= 3);
  for (const v of vectors) {
    assert.equal(sha256Hex(Buffer.from(v.coreJson, 'utf8')), v.sha256, v.name);
    assert.equal(positionFreeSha256(v.coreJson), v.positionFreeSha256, v.name);
  }
});

for (const name of ['b-credit-limit', 'b-alias', 'b-vocab-de', 'b-zh']) {
  test(`B 包本地重编译的投影哈希等于 manifest：${name}`, { skip }, () => {
    const p = pkg(`packages/${name}`);
    const r = obtainIr(p);
    assert.equal(r.recompiled, true);
    assert.equal(positionFreeSha256(r.coreJson), p.manifest.coreIr.positionFreeSha256);
  });
}

test('A 包原样使用 compiled/core.json', { skip }, () => {
  const p = pkg('packages/a-decimal');
  const r = obtainIr(p);
  assert.equal(r.recompiled, false);
  assert.equal(sha256Hex(Buffer.from(r.coreJson, 'utf8')), p.manifest.coreIr.sha256);
  // verify --recompile 对 A 包同样按投影哈希比对
  assert.equal(positionFreeSha256(compilePackageSource(p)), p.manifest.coreIr.positionFreeSha256);
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PackageError ? `${e.stage}:${e.code}` : String(e);
  }
};

test('改错 positionFreeSha256 并重新签名的 B 包报 PKG_IR_DRIFT；A 包 IR 读不进报 PKG_UNSUPPORTED_IR', { skip }, () => {
  assert.equal(codeOf(() => obtainIr(pkg('tamper/b-position-free-hash-wrong'))), 'ir:PKG_IR_DRIFT');
  assert.equal(codeOf(() => obtainIr(pkg('tamper/a-compiled-core-unreadable'))), 'ir:PKG_UNSUPPORTED_IR');
});
