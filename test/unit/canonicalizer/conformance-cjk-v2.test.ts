// 跨实现 conformance 测试（TS 端）。
//
// 对 corpus/conformance/cjk-v2/*.aster 的每个文件，断言 TS canonicalizer
// 输出与 .expected.txt 字节相等。配套的 Java 端测试在
// aster-lang-core/src/test/java/aster/core/canonicalizer/CjkV2ConformanceTest.java
// 必须产生相同的字节输出。
//
// 这是 v2 关键字 + CJK 标点归一化的合同测试——任何 byte drift 都是 P0 阻塞。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCJKPunctuationOnly } from '../../../src/frontend/canonicalizer.js';

const here = dirname(fileURLToPath(import.meta.url));
// 编译后位置：dist/test/unit/canonicalizer/  →  回退到 aster-lang-ts/，
// 然后进 node_modules 找 corpus 链接。同时也兼容直接从 src/ 跑（测试环境）。
const conformanceDir = join(
  here,
  '..', '..', '..', '..',  // → aster-lang-ts/ (from dist/test/unit/canonicalizer/)
  'node_modules', '@aster-cloud', 'aster-lang-test',
  'corpus', 'conformance', 'cjk-v2',
);

describe('Conformance: CJK v2 cross-impl 字节等价（TS 端）', () => {
  const entries = readdirSync(conformanceDir);
  const asterFiles = entries.filter((f) => f.endsWith('.aster'));

  it('应至少有 4 个 conformance 测试用例', () => {
    assert.ok(asterFiles.length >= 4, `期望 ≥4 个 .aster 文件，实际 ${asterFiles.length}`);
  });

  for (const file of asterFiles) {
    it(`${file} 的 normalize-CJK 输出应与 .expected.txt 字节相等`, () => {
      const srcPath = join(conformanceDir, file);
      const expectedPath = srcPath.replace(/\.aster$/, '.expected.txt');
      const source = readFileSync(srcPath, 'utf8');
      const expected = readFileSync(expectedPath, 'utf8');

      // 仅验证 v2 新增的 CJK 标点归一化层（不含关键字翻译、空格折叠等）
      // 这是 Java/TS 字节等价的唯一可达层面；全 canonicalize 因双 parser 设计差异
      // 不可能 byte-identical（见 ADR-0008 "范围之外"）。
      const actual = normalizeCJKPunctuationOnly(source);

      assert.strictEqual(
        actual,
        expected,
        `${file} CJK 归一化 drift:\n--- expected ---\n${expected}\n--- actual ---\n${actual}\n`,
      );
    });
  }
});
