import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PackageError } from '../../../src/policy-package/errors.js';
import { fetchJwks, isUriReference, loadTrustAnchor, resolveReference } from '../../../src/policy-package/trust-anchor.js';

// https 信任锚取回的细则（aster-lang-test#218 README「信任锚」与 2026-11-17 裁决）：直连不读代理变量、只认 301/302/303/307/308、
// Accept-Encoding: identity、非 identity 的 Content-Encoding 失败、本地锚文件 ≤ 1 MiB。一致性夹具 https-jwks-* 覆盖其余规则。
const JWKS = JSON.stringify({ keys: [{ crv: 'Ed25519', kid: 'k', kty: 'OKP', x: '8dfz-daPQgc3ZDU3qhgH23T0RCgeJU6POxG70ZlJ9HA' }] });

const dir = mkdtempSync(join(tmpdir(), 'aster-anchor-unit-'));
const gen = spawnSync('openssl', [
  'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
]);
const skip = gen.status === 0 ? false : 'openssl 不可用';

const usageOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof PackageError ? e.code : String(e);
  }
};

test('https 锚：直连、只认五种重定向、identity 编码', { skip }, async () => {
  let acceptEncoding: string | undefined;
  const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    acceptEncoding = req.headers['accept-encoding'];
    switch (req.url) {
      case '/ok':
        return void res.writeHead(200).end(JWKS);
      case '/identity':
        return void res.writeHead(200, { 'content-encoding': 'identity' }).end(JWKS);
      case '/gzip':
        return void res.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync(JWKS));
      case '/relative':
        return void res.writeHead(307, { location: 'ok' }).end();
      case '/s300':
        return void res.writeHead(300, { location: '/ok' }).end();
      case '/s304':
        return void res.writeHead(304, { location: '/ok' }).end();
      case '/no-location':
        return void res.writeHead(302).end();
      default:
        return void res.writeHead(404).end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `https://localhost:${(server.address() as { port: number }).port}`;
  const env = { ASTER_ANCHOR_CA_FILE: join(dir, 'cert.pem'), HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', NO_PROXY: '' };
  try {
    // 代理变量指向不可达地址也照常直连
    assert.equal(Buffer.from(await fetchJwks(`${base}/ok`, env)).toString(), JWKS);
    assert.equal(acceptEncoding, 'identity');
    assert.equal(Buffer.from(await fetchJwks(`${base}/identity`, env)).toString(), JWKS);
    assert.equal(Buffer.from(await fetchJwks(`${base}/relative`, env)).toString(), JWKS);
    for (const p of ['/gzip', '/s300', '/s304', '/no-location', '/missing']) assert.equal(await usageOf(fetchJwks(`${base}${p}`, env)), 'USAGE', p);
    // ASTER_ANCHOR_CA_FILE 是追加：不给时自签名证书不受信任
    assert.equal(await usageOf(fetchJwks(`${base}/ok`, {})), 'USAGE');
    assert.equal(await usageOf(fetchJwks(`${base}/ok`, { ASTER_ANCHOR_CA_FILE: join(dir, 'missing.pem') })), 'USAGE');
  } finally {
    server.close();
  }
});

test('锚 URL 必须是字面量小写 https://；本地锚文件超过 1 MiB 为 USAGE', async () => {
  for (const u of ['HTTPS://localhost/x', 'http://localhost/x', 'ftp://localhost/x']) assert.equal(await usageOf(loadTrustAnchor({ jwks: u })), 'USAGE', u);
  const big = join(dir, 'big-jwks.json');
  writeFileSync(big, JWKS + ' '.repeat(1024 * 1024));
  assert.equal(await usageOf(loadTrustAnchor({ jwks: big })), 'USAGE');
  assert.equal(await usageOf(loadTrustAnchor({ pubkey: big })), 'USAGE');
});

test('信任根：缺省 CA + 系统 CA，ASTER_ANCHOR_CA_FILE 追加且去重', { skip }, async () => {
  const tls = await import('node:tls');
  const { anchorCaCertificates } = await import('../../../src/policy-package/trust-anchor.js');
  const base = anchorCaCertificates({});
  const expected = new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
  assert.deepEqual(new Set(base), expected);
  assert.equal(base.length, expected.size, '应去重');
  const pem = readFileSync(join(dir, 'cert.pem'), 'utf8');
  const withExtra = anchorCaCertificates({ ASTER_ANCHOR_CA_FILE: join(dir, 'cert.pem') });
  assert.ok(withExtra.includes(pem), '应含追加的测试证书');
  for (const c of base) assert.ok(withExtra.includes(c), '追加不得替换缺省 / 系统 CA');
  assert.equal(withExtra.length, base.length + 1);
});

test('Location 原文按 RFC 3986 URI-reference 校验（与参照实现同一字符级判定）', () => {
  for (const ok of ['https://h/x', 'HTTPS://h:8443/a/b?c=d#e', '/abs/path', 'rel/path', '../../x', '?q', '#f', '.', '//host/p', 'https://[::1]:443/x', '/a%20b', "/a!$&'()*+,;=:@b"]) {
    assert.ok(isUriReference(ok), ok);
  }
  for (const bad of ['', '/a b', '/a\\b', '/a\u0001b', '/caf\u00e9', '/x\u2028', '/%zz', '1abc:/x', '/a{b}', '/a^b', '/a"b', '/a<b>', '/a|b']) {
    assert.ok(!isUriReference(bad), JSON.stringify(bad));
  }
});

test('resolveReference：RFC 3986 §5.4 的示例', () => {
  const base = 'http://a/b/c/d;p?q';
  const examples: Record<string, string> = {
    'g:h': 'g:h', g: 'http://a/b/c/g', './g': 'http://a/b/c/g', 'g/': 'http://a/b/c/g/', '/g': 'http://a/g', '//g': 'http://g',
    '?y': 'http://a/b/c/d;p?y', 'g?y': 'http://a/b/c/g?y', '#s': 'http://a/b/c/d;p?q#s', 'g#s': 'http://a/b/c/g#s',
    ';x': 'http://a/b/c/;x', '.': 'http://a/b/c/', './': 'http://a/b/c/', '..': 'http://a/b/', '../': 'http://a/b/',
    '../g': 'http://a/b/g', '../..': 'http://a/', '../../g': 'http://a/g', '../../../g': 'http://a/g', '/./g': 'http://a/g',
    '/../g': 'http://a/g', 'g.': 'http://a/b/c/g.', '.g': 'http://a/b/c/.g', './../g': 'http://a/b/g', 'g;x=1/../y': 'http://a/b/c/y',
    'http:g': 'http:g',
  };
  for (const [ref, want] of Object.entries(examples)) assert.equal(resolveReference(base, ref), want, ref);
  assert.equal(resolveReference('https://h/a', 'HTTPS://k/x'), 'https://k/x');
  assert.throws(() => resolveReference(base, '/a b'), (e: unknown) => e instanceof PackageError && e.code === 'USAGE');
});

test('https 锚：Location 相对解析（RFC 3986 §5.2）、scheme 不区分大小写、非法 Location 为 USAGE', { skip }, async () => {
  let port = 0;
  const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    const loc = (l: string): void => void res.writeHead(302, { location: l }).end();
    switch (req.url) {
      case '/a/b/c/jwks.json':
      case '/x':
      case '/a/x':
      case '/q?q':
        return void res.writeHead(200).end(JWKS);
      case '/a/b/c/rel':
        return loc('jwks.json');
      case '/a/b/c/up':
        return loc('../../x'); // RFC 3986 §5.2：/a/b/c/up + ../../x → /a/x
      case '/q':
        return loc('?q');
      case '/upper':
        return loc(`HTTPS://localhost:${port}/x`);
      case '/space':
        return loc('/x y');
      case '/backslash':
        return loc('\\x');
      case '/latin1':
        return loc('/caf\u00e9');
      case '/empty':
        return loc('');
      default:
        return void res.writeHead(404).end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as { port: number }).port;
  const base = `https://localhost:${port}`;
  const env = { ASTER_ANCHOR_CA_FILE: join(dir, 'cert.pem') };
  try {
    for (const p of ['/a/b/c/rel', '/a/b/c/up', '/q', '/upper']) assert.equal(Buffer.from(await fetchJwks(`${base}${p}`, env)).toString(), JWKS, p);
    for (const p of ['/space', '/backslash', '/latin1', '/empty']) assert.equal(await usageOf(fetchJwks(`${base}${p}`, env)), 'USAGE', p);
  } finally {
    server.close();
  }
});
