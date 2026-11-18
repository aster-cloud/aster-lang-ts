/**
 * 同步 SHA-256（FIPS 180-4），纯 JS 实现，不依赖 `node:crypto` 与 `Buffer`。
 *
 * 只给 `./package-check`（Cloudflare Workers 内的 Node 包复核，ADR 0059 修订 3 P2-R7）计算投影哈希用：
 * Workers 的 Web Crypto `subtle.digest` 只有异步接口，而 `compileSourcePositionFreeSha256` 是同步契约。
 * CLI 的包完整性检查仍用 `node:crypto`（`integrity.ts`）；两者结果由 test/unit/policy-package/sha256.test.ts 对拍。
 * 输入是 Core IR 规范 JSON（≤ 数 MiB），吞吐不是瓶颈。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** 对一个 64 字节块做压缩，更新 h。 */
function compress(h: Uint32Array, w: Uint32Array, block: DataView, offset: number): void {
  for (let i = 0; i < 16; i++) w[i] = block.getUint32(offset + i * 4);
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
    const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
  }
  let [a, b, c, d, e, f, g, k] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
  for (let i = 0; i < 64; i++) {
    const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    [k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
  }
  const out = [a, b, c, d, e, f, g, k];
  for (let i = 0; i < 8; i++) h[i] = (h[i]! + out[i]!) | 0;
}

/** 小写十六进制 SHA-256；字符串按 UTF-8 编码（孤立代理项按 TextEncoder 规则替换为 U+FFFD）。 */
export function sha256HexSync(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  // 填充：0x80、若干 0、64 位大端比特长度，总长为 64 的倍数
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) compress(h, w, view, off);
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
