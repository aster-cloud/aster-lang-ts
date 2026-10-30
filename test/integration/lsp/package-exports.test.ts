/**
 * 包入口（package.json exports）中的 LSP 补全 API（#260）：aster-cloud 的补全单测须按包入口引用
 * 成员补全与文档解析，而不是相对路径引用 dist（包结构一变就失效）。
 * 通过包名自引用加载，与下游 `import ... from '@aster-cloud/aster-lang-ts/lsp/completion'` 走同一解析路径。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PKG = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  name: string;
  exports: Record<string, { types: string; import: string }>;
};

describe('包入口：LSP 补全', () => {
  it('./lsp/completion 导出 memberCompletions、parseDocumentText 等补全 API，可完成一次成员补全', async () => {
    const completion = (await import(`${PKG.name}/lsp/completion`)) as typeof import('../../../src/lsp/completion.js');
    for (const name of ['memberCompletions', 'constructFieldCompletions', 'controlCompletions', 'parseDocumentText', 'registerCompletionHandlers']) {
      assert.equal(typeof (completion as Record<string, unknown>)[name], 'function', name);
    }
    const { EN_US } = (await import(`${PKG.name}/lexicons/en-US`)) as typeof import('../../../src/config/lexicons/en-US.js');
    const text = ['Module demo.p.', '', 'Define Driver has name as Text, age as Int.', '', 'Rule f given d as Driver, produce Int:', '  Return d.', ''].join('\n');
    const doc = { text, ...completion.parseDocumentText(text, EN_US, undefined, undefined) };
    const items = completion.memberCompletions(doc, { line: 5, character: '  Return d.'.length }, EN_US);
    assert.deepEqual(items?.map((i) => i.label).sort(), ['age', 'name']);
  });

  it('exports 中每个入口的产物都存在', () => {
    for (const [entry, target] of Object.entries(PKG.exports)) {
      assert.ok(existsSync(resolve(target.import)), `${entry} → ${target.import}`);
      assert.ok(existsSync(resolve(target.types)), `${entry} → ${target.types}`);
    }
  });
});
