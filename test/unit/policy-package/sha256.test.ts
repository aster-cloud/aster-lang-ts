import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256HexSync } from '../../../src/policy-package/sha256.js';

// 纯 JS SHA-256（./package-check 的投影哈希用，ADR 0059 P2 T23）与 node:crypto 对拍。
const node = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

test('FIPS 180-4 已知向量', () => {
  assert.equal(sha256HexSync(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256HexSync('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256HexSync('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('每个填充边界长度（0–200 字节）与随机输入都与 node:crypto 相同', () => {
  for (let n = 0; n <= 200; n++) {
    const b = randomBytes(n);
    assert.equal(sha256HexSync(b), node(b), `长度 ${n}`);
  }
  const big = randomBytes(1_000_003);
  assert.equal(sha256HexSync(big), node(big));
});

test('字符串按 UTF-8 编码（含中文、补充平面字符与孤立代理项）', () => {
  for (const s of ['块.遮蔽', 'Kennzahl ä', '😀', '\uD800x']) assert.equal(sha256HexSync(s), node(Buffer.from(s, 'utf8')), s);
});
