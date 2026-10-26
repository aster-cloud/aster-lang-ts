/**
 * @module test/unit/identifiers/casefold.test
 *
 * Unicode 15.1 简单折叠：跨语言测试向量 + 辅助函数。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCodePoints, foldKey, nfc } from '../../../src/config/lexicons/identifiers/casefold.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const vectorsPath = join(repoRoot, 'test', 'fixtures', 'casefold', 'test-vectors.json');

// aster-lang-locales/casefold/test-vectors.json 原件的 sha256；副本必须逐字节一致。
const VECTORS_SHA256 = '0d8a9a43d7a7a90f1a8ccd964f868f8043dd0e5b2b9ded1ea850071799a71bb3';

interface Vector {
  readonly a: string;
  readonly b: string;
  readonly equal: boolean;
  readonly note: string;
  readonly codepoints: { readonly a: number[]; readonly b: number[] };
}

describe('casefold 测试向量', () => {
  const raw = readFileSync(vectorsPath);

  it('向量文件副本与 locales 原件一致', () => {
    assert.strictEqual(createHash('sha256').update(raw).digest('hex'), VECTORS_SHA256);
  });

  const vectors = JSON.parse(raw.toString('utf8')) as Vector[];
  it('向量非空', () => assert.ok(vectors.length > 0));

  for (const v of vectors) {
    it(`${v.note}: ${JSON.stringify(v.a)} / ${JSON.stringify(v.b)} => ${v.equal}`, () => {
      // 以码点数组还原输入，避免文件编码影响
      const a = String.fromCodePoint(...v.codepoints.a);
      const b = String.fromCodePoint(...v.codepoints.b);
      assert.strictEqual(foldKey(a) === foldKey(b), v.equal);
    });
  }
});

describe('foldKey / compareCodePoints', () => {
  it('不依赖宿主 toLowerCase：土耳其 İ 保持不变', () => {
    assert.strictEqual(foldKey('İ'), 'İ');
  });
  it('未映射码点（含增补平面）保持不变', () => {
    assert.strictEqual(foldKey('天城文𝒜'), '天城文𝒜');
  });
  it('增补平面大小写：U+10400 折叠为 U+10428', () => {
    assert.strictEqual(foldKey('\u{10400}'), '\u{10428}');
  });
  it('nfc 合成组合字符', () => {
    assert.strictEqual(nfc('é'), 'é');
  });
  it('码点序而非 UTF-16 单元序：U+FF5E < U+10000', () => {
    assert.ok(compareCodePoints('～', '\u{10000}') < 0);
    assert.ok('～' > '\u{10000}'); // UTF-16 单元序相反，证明确有差异
    assert.strictEqual(compareCodePoints('abc', 'abc'), 0);
    assert.ok(compareCodePoints('ab', 'abc') < 0);
  });
});
