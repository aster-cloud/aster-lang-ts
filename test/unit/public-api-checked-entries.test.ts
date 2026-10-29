/**
 * 包入口只暴露带名称解析检查的出口（ADR 0051 裁决 R49）。
 *
 * 原始 lowerModule 与不抛错的 resolveAndLower 可能产出含本地化名或未解析名的 Core，
 * 不得作为公开 API；外部调用方经 resolveAndLowerChecked / compile / resolvePolicyTypes 取得 IR。
 */
import test from 'node:test';
import assert from 'node:assert';
import * as indexEntry from '../../src/index.js';
import * as browserEntry from '../../src/browser.js';

const ENTRIES = { index: indexEntry, browser: browserEntry } as const;

for (const [label, entry] of Object.entries(ENTRIES)) {
  test(`${label} 入口不导出原始降级与未检查的名称解析`, () => {
    assert.ok(!('lowerModule' in entry), 'lowerModule 不应从包入口导出');
    assert.ok(!('resolveAndLower' in entry), 'resolveAndLower 不应从包入口导出');
  });

  test(`${label} 入口导出带检查的出口`, () => {
    assert.strictEqual(typeof entry.parseSource, 'function');
    assert.strictEqual(typeof entry.resolveAndLowerChecked, 'function');
    assert.strictEqual(typeof entry.resolvePolicyTypes, 'function');
  });
}

test('resolveAndLowerChecked 遇 E8xx 抛出 NameResolutionError，成功时返回已解析 Core', () => {
  const ok = indexEntry.resolveAndLowerChecked(
    indexEntry.parseSource('Module m.\n\nRule f given x as Int, produce Int:\n  Return x.\n').ast
  );
  assert.strictEqual(ok.core.kind, 'Module');
  assert.throws(
    () => indexEntry.resolveAndLowerChecked(
      indexEntry.parseSource('Module m.\n\nRule f given x as Int, produce Int:\n  Return x plus unbekannt.\n').ast
    ),
    (e: unknown) => e instanceof indexEntry.NameResolutionError && e.diagnostics.some((d) => d.code === 'E802')
  );
});
