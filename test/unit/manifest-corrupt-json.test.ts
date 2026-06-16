/**
 * manifest-parser 损坏 JSON 处理测试 (#24)
 *
 * 验证 parseManifest 对损坏 JSON 返回 M001 诊断而非抛出崩溃，
 * 且模块顶层不再因 schema 加载失败而在 import 时崩溃。
 */

import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest } from '../../src/package/manifest-parser.js';
import { DiagnosticCode, type Diagnostic } from '../../src/diagnostics/diagnostics.js';

const TEST_DIR = '/tmp/aster-manifest-corrupt-test';

test('manifest 损坏 JSON 处理', async (t) => {
  await t.before(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  await t.after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  await t.test('损坏的 JSON 返回 M001 诊断，不抛出', () => {
    const file = join(TEST_DIR, 'broken.json');
    writeFileSync(file, '{ "name": "demo.pkg", "version": ', 'utf-8');

    let result: ReturnType<typeof parseManifest> | undefined;
    assert.doesNotThrow(() => {
      result = parseManifest(file);
    });
    assert.ok(Array.isArray(result), 'should return diagnostics array');
    const diags = result as Diagnostic[];
    assert.ok(
      diags.some((d) => d.code === DiagnosticCode.M001_ManifestParseError),
      'expected M001_ManifestParseError'
    );
  });

  await t.test('完全非 JSON 内容也安全降级', () => {
    const file = join(TEST_DIR, 'notjson.json');
    writeFileSync(file, 'this is definitely not json <<<', 'utf-8');
    const result = parseManifest(file);
    assert.ok(Array.isArray(result));
    assert.ok((result as Diagnostic[]).some((d) => d.code === DiagnosticCode.M001_ManifestParseError));
  });
});
