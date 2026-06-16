/**
 * hi-IN 导出测试 (#24)
 *
 * 验证：
 * 1. hi-IN 子路径模块可被导入且导出 HI_IN
 * 2. package.json 的 exports 暴露 ./lexicons/hi-IN（与 en/zh/de 镜像）
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/test/unit/lexicons → 回到项目根目录
const repoRoot = join(__dirname, '..', '..', '..', '..');

describe('hi-IN export', () => {
  test('hi-IN module exports a HI_IN lexicon', () => {
    assert.ok(HI_IN, 'HI_IN should be defined');
    assert.strictEqual(HI_IN.id, 'hi-IN');
  });

  test('package.json exports ./lexicons/hi-IN', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
    const entry = pkg.exports['./lexicons/hi-IN'];
    assert.ok(entry, 'expected ./lexicons/hi-IN in package.json exports');
    assert.strictEqual(entry.types, './dist/src/config/lexicons/hi-IN.d.ts');
    assert.strictEqual(entry.import, './dist/src/config/lexicons/hi-IN.js');
  });

  test('hi-IN exports mirror en-US / zh-CN / de-DE shape', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
    for (const locale of ['en-US', 'zh-CN', 'de-DE', 'hi-IN']) {
      const entry = pkg.exports[`./lexicons/${locale}`];
      assert.ok(entry, `expected ./lexicons/${locale} export`);
      assert.ok(entry.types && entry.import, `${locale} export must have types + import`);
    }
  });
});
