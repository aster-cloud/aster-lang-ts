/**
 * signature 阶段（README「检查顺序」signature 行，ADR 0059 §6.2）。
 *
 * 被签字节 = `manifest.json` 文件字节本身（manifest 阶段已保证它等于规范 JSON）。签名先于载荷校验：
 * 没有可信 manifest 就不读载荷哈希。无签名文件时 `--allow-unsigned` 继续（`signed=false`）；
 * 有签名文件时即使给了 `--allow-unsigned` 也必须成立。
 */
import { verify } from 'node:crypto';
import { fail } from './errors.js';
import { validateSigSchema } from './manifest.js';
import { MAX_SIG_BYTES } from './paths.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';
import type { TrustAnchor } from './trust-anchor.js';
import type { LoadedPackage } from './read-package.js';

const B64U_SIG = /^[A-Za-z0-9_-]{86}(?![\s\S])/;

/** 校验签名文件字节并验签 manifest 字节；成立返回 kid。 */
export function verifyManifestSignature(manifestBytes: Uint8Array, sigBytes: Uint8Array, anchor: TrustAnchor): string {
  const bad = (code: 'PKG_SIGNATURE' | 'PKG_UNTRUSTED_KID', why: string): never => fail('signature', code, why);
  if (sigBytes.length > MAX_SIG_BYTES) bad('PKG_SIGNATURE', '签名文件超过 64 KiB');
  let tree: JsonValue;
  try {
    tree = parseStrictJson(sigBytes, { maxDepth: 4 });
  } catch (e) {
    return bad('PKG_SIGNATURE', `签名文件不是严格 JSON：${(e as Error).message}`);
  }
  if (!validateSigSchema(tree) || !isJsonObject(tree)) return bad('PKG_SIGNATURE', '签名文件不符合 schema');
  const sig = tree['sig'] as string;
  const kid = tree['kid'] as string;
  const sigRaw = Buffer.from(sig, 'base64url');
  if (!B64U_SIG.test(sig) || sigRaw.length !== 64 || sigRaw.toString('base64url') !== sig) bad('PKG_SIGNATURE', 'sig 不是规范 base64url');
  let key;
  switch (anchor.kind) {
    case 'raw':
      key = anchor.key;
      break;
    case 'jwk':
      if (anchor.kid !== undefined && anchor.kid !== kid) bad('PKG_UNTRUSTED_KID', `kid ${kid} 与 --pubkey 的 JWK 不符`);
      key = anchor.key;
      break;
    case 'jwks':
      key = anchor.keys.get(kid) ?? bad('PKG_UNTRUSTED_KID', `kid ${kid} 不在信任锚中`);
      break;
  }
  // node:crypto（OpenSSL）的 Ed25519 验签按 RFC 8032 拒绝 S ≥ L 的可延展签名
  if (!verify(null, manifestBytes, key, sigRaw)) bad('PKG_SIGNATURE', 'Ed25519 验签失败');
  return kid;
}

/** signature 阶段：返回是否已验签（无签名且允许时为 false）。 */
export function verifySignature(pkg: LoadedPackage, anchor: TrustAnchor, opts: { allowUnsigned: boolean }): { signed: boolean } {
  const sigBytes = pkg.files.get('manifest.sig.json');
  if (!sigBytes) {
    if (opts.allowUnsigned) return { signed: false };
    return fail('signature', 'PKG_UNSIGNED', '包内没有 manifest.sig.json');
  }
  verifyManifestSignature(pkg.manifestBytes, sigBytes, anchor);
  return { signed: true };
}
