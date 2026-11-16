/**
 * 信任锚（README「信任锚」，ADR 0059 §6.2、修订 2 R8）。
 *
 * 读取与校验属于 usage 阶段：锚文件不可读或不合法、`--jwks` 与 `--pubkey` 同时给出，一律 `USAGE`（在读包之前）。
 *   - 不给锚：内置 `trust/export-jwks.json`（P1 为 `{"keys":[]}`，任何签名包都是 `PKG_UNTRUSTED_KID`）；
 *   - `--jwks <file|url>`：JWKS，按签名文件的 kid 查找；只有 https URL 联网，10 s 超时；
 *   - `--pubkey <file>`：按首个非空白字符区分原始公钥（不看 kid）与单个 JWK（带 kid 时必须相符）。
 * 锚文件按严格 JSON 读（无 BOM、无重复键），与 manifest 同一读取器。
 */
import { readFileSync } from 'node:fs';
import { createPublicKey, type KeyObject } from 'node:crypto';
import { fail, PackageError } from './errors.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';
import builtinJwks from './trust/export-jwks.json' with { type: 'json' };

/** 已校验的信任锚。`raw` 与不带 kid 的 `jwk` 不看签名文件的 kid。 */
export type TrustAnchor =
  | { readonly kind: 'jwks'; readonly keys: ReadonlyMap<string, KeyObject> }
  | { readonly kind: 'raw'; readonly key: KeyObject }
  | { readonly kind: 'jwk'; readonly kid: string | undefined; readonly key: KeyObject };

export interface TrustAnchorOptions {
  readonly pubkey?: string | undefined;
  readonly jwks?: string | undefined;
}

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const B64U_32 = /^[A-Za-z0-9_-]{43}(?![\s\S])/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const JWKS_FETCH_TIMEOUT_MS = 10_000;

const usage = (why: string): never => fail('usage', 'USAGE', why);

/** 32 字节原始公钥 → KeyObject。 */
export function publicKeyFromRaw(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** 规范 base64url（无填充）的 32 字节；否则返回 undefined。 */
function decodeB64u32(s: unknown): Buffer | undefined {
  if (typeof s !== 'string' || !B64U_32.test(s)) return undefined;
  const raw = Buffer.from(s, 'base64url');
  return raw.length === 32 && raw.toString('base64url') === s ? raw : undefined;
}

/** 校验单个 JWK；`requireKid` 为 JWKS 成员时为 true。 */
function parseJwk(v: JsonValue, requireKid: boolean, where: string): { kid: string | undefined; key: KeyObject } {
  if (!isJsonObject(v)) return usage(`${where}：JWK 不是对象`);
  if (v['kty'] !== 'OKP' || v['crv'] !== 'Ed25519') usage(`${where}：只接受 kty=OKP、crv=Ed25519`);
  if ('alg' in v && v['alg'] !== 'EdDSA') usage(`${where}：alg 必须是 EdDSA`);
  if ('use' in v && v['use'] !== 'sig') usage(`${where}：use 必须是 sig`);
  const kid = v['kid'];
  if (kid !== undefined && (typeof kid !== 'string' || kid === '')) usage(`${where}：kid 必须是非空字符串`);
  if (requireKid && kid === undefined) usage(`${where}：JWKS 中的 key 必须带 kid`);
  const raw = decodeB64u32(v['x']);
  if (!raw) return usage(`${where}：x 不是 32 字节的规范 base64url`);
  return { kid: kid as string | undefined, key: publicKeyFromRaw(raw) };
}

/** 校验 JWKS 文本（任何一个 key 不合法都使整个文件不合法；kid 不得重复）。 */
export function parseJwks(bytes: Uint8Array, where: string): TrustAnchor {
  let tree: JsonValue;
  try {
    tree = parseStrictJson(bytes);
  } catch (e) {
    return usage(`${where}：不是严格 JSON：${(e as Error).message}`);
  }
  if (!isJsonObject(tree) || !Array.isArray(tree['keys'])) return usage(`${where}：不是 {"keys":[…]}`);
  const keys = new Map<string, KeyObject>();
  for (const k of tree['keys']) {
    const { kid, key } = parseJwk(k, true, where);
    if (keys.has(kid!)) usage(`${where}：kid ${kid} 重复`);
    keys.set(kid!, key);
  }
  return { kind: 'jwks', keys };
}

/** `--pubkey` 文件：原始公钥（恰为规范 base64url，后面至多一个 `\n`）或单个 JWK。 */
export function parsePubkey(bytes: Uint8Array, where: string): TrustAnchor {
  const text = Buffer.from(bytes).toString('latin1');
  if (/^\s*\{/.test(text)) {
    let tree: JsonValue;
    try {
      tree = parseStrictJson(bytes);
    } catch (e) {
      return usage(`${where}：不是严格 JSON：${(e as Error).message}`);
    }
    const { kid, key } = parseJwk(tree, false, where);
    return { kind: 'jwk', kid, key };
  }
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const raw = decodeB64u32(body);
  if (!raw) return usage(`${where}：不是 32 字节公钥的规范 base64url`);
  return { kind: 'raw', key: publicKeyFromRaw(raw) };
}

function readAnchorFile(path: string): Uint8Array {
  try {
    return readFileSync(path);
  } catch {
    return usage(`锚文件不可读：${path}`);
  }
}

async function fetchJwks(url: string): Promise<Uint8Array> {
  if (!url.startsWith('https://')) usage(`--jwks 的 URL 必须是 https：${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS), redirect: 'error' });
    if (res.status !== 200) return usage(`--jwks ${url} 返回 HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof PackageError) throw e;
    return usage(`--jwks ${url} 取不到：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 按命令行选项取得信任锚（usage 阶段）。 */
export async function loadTrustAnchor(opts: TrustAnchorOptions): Promise<TrustAnchor> {
  if (opts.jwks !== undefined && opts.pubkey !== undefined) usage('--jwks 与 --pubkey 不能同时给出');
  if (opts.pubkey !== undefined) return parsePubkey(readAnchorFile(opts.pubkey), opts.pubkey);
  if (opts.jwks !== undefined) {
    const bytes = URL_SCHEME.test(opts.jwks) ? await fetchJwks(opts.jwks) : readAnchorFile(opts.jwks);
    return parseJwks(bytes, opts.jwks);
  }
  return builtinTrustAnchor();
}

/** 内置锚（随 CLI 发布；导出密钥在 P2 创建前为空）。 */
export function builtinTrustAnchor(): TrustAnchor {
  return parseJwks(Buffer.from(JSON.stringify(builtinJwks), 'utf8'), '内置 export-jwks.json');
}

/** 锚中可列出的 kid（`version` 子命令的 `trustAnchorKids`）。 */
export function anchorKids(anchor: TrustAnchor): string[] {
  if (anchor.kind === 'jwks') return [...anchor.keys.keys()];
  return anchor.kind === 'jwk' && anchor.kid !== undefined ? [anchor.kid] : [];
}
