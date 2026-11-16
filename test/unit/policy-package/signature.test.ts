import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PackageError } from '../../../src/policy-package/errors.js';
import { parseCanonicalManifest } from '../../../src/policy-package/manifest.js';
import { verifyManifestSignature } from '../../../src/policy-package/signature.js';
import { parseJwks, parsePubkey, loadTrustAnchor } from '../../../src/policy-package/trust-anchor.js';
import { PACKAGE_V1, readFixtureJson } from '../../helpers/package-v1.js';

interface SigningVector {
  readonly name: string;
  readonly manifestFileB64u: string;
  readonly canonicalUtf8B64u: string | null;
  readonly sigFileB64u: string;
  readonly valid: boolean;
  readonly code: string | null;
}

const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;

/** 签名向量的检查顺序：manifest 规范字节 → 签名文件 → kid 查锚 → 验签。返回错误码或 null。 */
function check(v: SigningVector): string | null {
  const anchor = parseJwks(readFileSync(join(PACKAGE_V1!, 'keys/test-jwks.json')), 'test-jwks');
  const manifest = Buffer.from(v.manifestFileB64u, 'base64url');
  try {
    parseCanonicalManifest(manifest);
    verifyManifestSignature(manifest, Buffer.from(v.sigFileB64u, 'base64url'), anchor);
    return null;
  } catch (e) {
    if (e instanceof PackageError) return e.code;
    throw e;
  }
}

if (PACKAGE_V1 !== undefined) {
  for (const v of readFixtureJson<{ vectors: SigningVector[] }>('vectors/signing.json').vectors) {
    test(`签名向量：${v.name}`, () => {
      assert.equal(check(v), v.valid ? null : v.code);
    });
  }
} else {
  test('签名向量', { skip }, () => {});
}

const usageOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PackageError ? e.code : 'other';
  }
};

test('信任锚：合法与非法锚文件', { skip }, () => {
  const file = (rel: string): Buffer => readFileSync(join(PACKAGE_V1!, rel));
  assert.equal(parseJwks(file('keys/test-jwks.json'), 'x').kind, 'jwks');
  assert.equal(parsePubkey(file('keys/test-ed25519.pub.b64u'), 'x').kind, 'raw');
  const jwk = parsePubkey(file('anchors/test-pub.jwk.json'), 'x');
  assert.ok(jwk.kind === 'jwk' && jwk.kid === 'test-2026-11');
  const noKid = parsePubkey(file('anchors/test-pub-no-kid.jwk.json'), 'x');
  assert.ok(noKid.kind === 'jwk' && noKid.kid === undefined);
  for (const bad of ['jwks-duplicate-kid.json', 'jwks-not-json.json', 'jwks-short-x.json', 'jwks-wrong-alg.json', 'jwks-wrong-curve.json']) {
    assert.equal(usageOf(() => parseJwks(file(`anchors/${bad}`), bad)), 'USAGE', bad);
  }
  for (const bad of ['pub-31-bytes.b64u', 'pub-crlf.b64u', 'pub-padded.b64u']) {
    assert.equal(usageOf(() => parsePubkey(file(`anchors/${bad}`), bad)), 'USAGE', bad);
  }
});

test('信任锚：--jwks 与 --pubkey 同时给出、文件不存在、非 https URL 都是 USAGE', async () => {
  const code = async (opts: { jwks?: string; pubkey?: string }): Promise<string | undefined> => {
    try {
      await loadTrustAnchor(opts);
      return undefined;
    } catch (e) {
      return e instanceof PackageError ? e.code : 'other';
    }
  };
  assert.equal(await code({ jwks: 'a', pubkey: 'b' }), 'USAGE');
  assert.equal(await code({ jwks: '/no/such/file.json' }), 'USAGE');
  assert.equal(await code({ jwks: 'http://example.invalid/jwks.json' }), 'USAGE');
  const builtin = await loadTrustAnchor({});
  assert.ok(builtin.kind === 'jwks' && builtin.keys.size === 0);
});
