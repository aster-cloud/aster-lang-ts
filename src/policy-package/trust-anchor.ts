/**
 * 信任锚（README「信任锚」，ADR 0059 §6.2、修订 2 R8）。
 *
 * 读取与校验属于 usage 阶段：锚文件不可读或不合法、`--jwks` 与 `--pubkey` 同时给出，一律 `USAGE`（在读包之前）。
 *   - 不给锚：内置 `trust/export-jwks.json`（P1 为 `{"keys":[]}`，任何签名包都是 `PKG_UNTRUSTED_KID`）；
 *   - `--jwks <file|url>`：JWKS，按签名文件的 kid 查找；参数形如 `scheme://` 即为 URL，只有字面量小写 `https://` 联网（见 {@link fetchJwks}）；
 *   - `--pubkey <file>`：按首个非空白字符区分原始公钥（不看 kid）与单个 JWK（带 kid 时必须相符）。
 * 锚文件按严格 JSON 读（无 BOM、无重复键），与 manifest 同一读取器。
 */
import { readFileSync, statSync } from 'node:fs';
import * as https from 'node:https';
import * as tls from 'node:tls';
import { createPublicKey, type KeyObject } from 'node:crypto';
import { fail } from './errors.js';
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
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) return usage(`锚文件不是普通文件：${path}`);
    size = st.size;
  } catch {
    return usage(`锚文件不可读：${path}`);
  }
  if (size > ANCHOR_FILE_MAX_BYTES) usage(`锚文件超过 1 MiB：${path}`);
  try {
    return readFileSync(path);
  } catch {
    return usage(`锚文件不可读：${path}`);
  }
}

/** https 取锚的上限（README「信任锚」）。 */
const JWKS_MAX_BYTES = 1024 * 1024;
/** 本地 `--jwks` / `--pubkey` 文件的上限（超出为 USAGE）。 */
const ANCHOR_FILE_MAX_BYTES = 1024 * 1024;
const JWKS_MAX_REDIRECTS = 3;

// RFC 3986 的字符类：unreserved / sub-delims / pct-encoded（`new URL()` 会静默修补空格、反斜杠、控制字符与非 ASCII，
// 所以重定向的 Location 原文必须先按 RFC 3986 校验再解析）
const PCT = '%[0-9A-Fa-f]{2}';
const UNRESERVED = "A-Za-z0-9\\-._~";
const SUB_DELIMS = "!$&'()*+,;=";
const PCHAR = `(?:[${UNRESERVED}${SUB_DELIMS}:@]|${PCT})`;
const SEGMENT_NZ_NC = `(?:[${UNRESERVED}${SUB_DELIMS}@]|${PCT})+`;
const QUERY_OR_FRAGMENT = new RegExp(`^(?:${PCHAR}|[/?])*$`);
const PATH_ABEMPTY = new RegExp(`^(?:/${PCHAR}*)*$`);
const PATH_ABSOLUTE = new RegExp(`^/(?:${PCHAR}+(?:/${PCHAR}*)*)?$`);
const PATH_ROOTLESS = new RegExp(`^${PCHAR}+(?:/${PCHAR}*)*$`);
const PATH_NOSCHEME = new RegExp(`^${SEGMENT_NZ_NC}(?:/${PCHAR}*)*$`);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const USERINFO = new RegExp(`^(?:[${UNRESERVED}${SUB_DELIMS}:]|${PCT})*$`);
const REG_NAME = new RegExp(`^(?:[${UNRESERVED}${SUB_DELIMS}]|${PCT})*$`);
const IP_LITERAL = new RegExp(`^\\[(?:[0-9A-Fa-f:.]+|[vV][0-9A-Fa-f]+\\.[${UNRESERVED}${SUB_DELIMS}:]+)\\]$`);
const PORT = /^[0-9]*$/;
/** RFC 3986 附录 B 的分解正则。 */
const URI_PARTS = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

/** authority = [ userinfo "@" ] host [ ":" port ]，host 为 IP-literal 或 reg-name（IPv4 也满足 reg-name）。 */
function isAuthority(a: string): boolean {
  const at = a.lastIndexOf('@');
  if (at >= 0 && !USERINFO.test(a.slice(0, at))) return false;
  const hostPort = a.slice(at + 1);
  const m = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(hostPort);
  if (!m) return false;
  const host = m[1]!;
  const hostOk = host.startsWith('[') ? IP_LITERAL.test(host) : REG_NAME.test(host);
  return hostOk && (m[2] === undefined || PORT.test(m[2]));
}

/**
 * 原文是否为 RFC 3986 §4.1 的 URI-reference（URI 或 relative-ref），且非空。空格、反斜杠、控制字符、未编码的非 ASCII
 * 都不合法。用于重定向 Location：先校验原文，再按 §5.2 相对当前请求 URL 解析。
 */
export function isUriReference(ref: string): boolean {
  if (ref === '') return false;
  const m = URI_PARTS.exec(ref);
  if (!m) return false;
  const [, scheme, authority, path = '', query, fragment] = m;
  if (scheme !== undefined && !SCHEME.test(scheme)) return false;
  if (query !== undefined && !QUERY_OR_FRAGMENT.test(query)) return false;
  if (fragment !== undefined && !QUERY_OR_FRAGMENT.test(fragment)) return false;
  if (authority !== undefined) return isAuthority(authority) && PATH_ABEMPTY.test(path);
  if (path === '' || PATH_ABSOLUTE.test(path)) return true;
  // 无 authority 的非空相对路径：有 scheme 时为 path-rootless，否则首段不得含 ':'（path-noscheme）
  return scheme !== undefined ? PATH_ROOTLESS.test(path) : PATH_NOSCHEME.test(path);
}

/** 被当作重定向跟随的状态码；其他 3xx 一律 USAGE。 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * 取信任锚用的 TLS 信任根（README「信任锚」）：Node 缺省 CA（内置 Mozilla 根 + `NODE_EXTRA_CA_CERTS`）+ 操作系统信任库，
 * 再**追加**仅供测试的 `ASTER_ANCHOR_CA_FILE`（PEM）；去重后返回。总是显式给出列表：Node 的缺省信任库不含系统 CA
 * （除非以 `--use-system-ca` 启动），而只要给 `ca` 就会替换缺省信任库，所以缺省、系统与追加三部分必须一起列出。
 */
export function anchorCaCertificates(env: NodeJS.ProcessEnv): string[] {
  const get = (tls as { getCACertificates?: (kind: 'default' | 'system') => string[] }).getCACertificates;
  const cas = get ? [...get('default'), ...get('system')] : [...tls.rootCertificates];
  const extra = env['ASTER_ANCHOR_CA_FILE'];
  if (extra) {
    try {
      cas.push(readFileSync(extra, 'utf8'));
    } catch {
      usage(`ASTER_ANCHOR_CA_FILE 不可读：${extra}`);
    }
  }
  return [...new Set(cas)];
}

interface FetchedResponse {
  readonly status: number;
  readonly location: string | undefined;
  readonly contentEncoding: string | undefined;
  readonly body: Buffer;
}

/** 一次 GET（直连，不经代理）：响应体超过上限立即中止；deadline 之前未完成即失败。 */
function getOnce(url: string, agent: https.Agent, deadline: number): Promise<FetchedResponse> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { agent, headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > JWKS_MAX_BYTES) {
            req.destroy(new Error('响应体超过 1 MiB'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, location: res.headers.location, contentEncoding: res.headers['content-encoding'], body: Buffer.concat(chunks) }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

/**
 * 取回 https 信任锚（README「信任锚」）：只接受字面量小写 `https://`；直连，不读任何代理环境变量；全部跳合计 10 s；
 * 只有 301/302/303/307/308 按重定向手动跟随：Location 原文先按 RFC 3986 校验（不合法为 USAGE），相对引用按 §5.2 相对当前请求 URL 解析，
 * scheme 不区分大小写；至多 3 次且每一跳都必须是 https；
 * 其他 3xx 与非 2xx 失败；请求 `Accept-Encoding: identity`，响应带非 identity 的 `Content-Encoding` 失败；响应体 ≤ 1 MiB。
 * 任何失败都是 USAGE。
 */
export async function fetchJwks(url: string, env: NodeJS.ProcessEnv = process.env): Promise<Uint8Array> {
  if (!url.startsWith('https://')) usage(`--jwks 的 URL 必须以小写 https:// 开头：${url}`);
  const deadline = Date.now() + JWKS_FETCH_TIMEOUT_MS;
  const agent = new https.Agent({ ca: anchorCaCertificates(env) });
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      // 首跳已要求字面量小写 https://；重定向目标的 scheme 不区分大小写（解析后已规范为小写）
      if (new URL(current).protocol !== 'https:') return usage(`重定向到非 https 地址：${current}`);
      let res: FetchedResponse;
      try {
        res = await getOnce(current, agent, deadline);
      } catch (e) {
        return usage(`--jwks ${current} 取不到：${e instanceof Error ? e.message : String(e)}`);
      }
      if (REDIRECT_STATUSES.has(res.status)) {
        if (res.location === undefined) return usage(`--jwks ${current} 返回 ${res.status} 但没有 Location`);
        if (hop + 1 > JWKS_MAX_REDIRECTS) return usage(`--jwks 重定向超过 ${JWKS_MAX_REDIRECTS} 次`);
        if (!isUriReference(res.location)) return usage(`--jwks ${current} 的 Location 不是合法的 URI-reference：${JSON.stringify(res.location)}`);
        current = new URL(res.location, current).toString();
        continue;
      }
      if (res.status < 200 || res.status > 299) return usage(`--jwks ${current} 返回 HTTP ${res.status}`);
      if (res.contentEncoding !== undefined && res.contentEncoding.trim().toLowerCase() !== 'identity') {
        return usage(`--jwks ${current} 的 Content-Encoding 为 ${res.contentEncoding}`);
      }
      return new Uint8Array(res.body);
    }
  } finally {
    agent.destroy();
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
