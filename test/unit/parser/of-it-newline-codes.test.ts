/**
 * aster-lang-ts#389：`of` 之后换行与句点后的 `It` 不接 `performs` 时，与 core 同码、同位置、同参数。
 * 码与行由共享夹具 shared/parse_diagnostics_parity.json 两引擎对照；这里另外钉住列号与参数（夹具只比码与行）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompileFailure, compileSource } from '../../../src/policy-package/compile-source.js';

function first(source: string): { code: string; line: number; col: number; params: Record<string, unknown> } {
  try {
    compileSource(source, { locale: 'en-US' });
  } catch (e) {
    if (!(e instanceof CompileFailure)) throw e;
    const d = JSON.parse(e.diagnostics[0] ?? '{}');
    return { code: d.code, line: d.span.start.line, col: d.span.start.col, params: d.params ?? {} };
  }
  assert.fail('应编译失败');
}

const H = 'Module m.\n\n';

describe('#389：of 之后换行', () => {
  for (const kw of ['List of', 'list of', 'option of', 'result of']) {
    it(`${kw} ⏎ 缩进：E062 报在换行处`, () => {
      const col = 'Rule f given x as '.length + kw.length + 1;
      assert.deepEqual(first(`${H}Rule f given x as ${kw}\n  Int, produce Int:\n  Return 1.\n`),
        { code: 'E062', line: 3, col, params: { token: 'token.newline', expected: 'token.type' } });
    });
  }

  it('同列续写类型：E061', () => {
    assert.deepEqual(first(`${H}Rule f given x as List of\nInt, produce Int:\n  Return 1.\n`),
      { code: 'E061', line: 3, col: 26, params: { token: 'token.newline' } });
  });
});

describe('#389：句点后的 It 不接 performs', () => {
  it('It ⏎：E055 kw.performs，报在换行处', () => {
    assert.deepEqual(first(`${H}Rule f given x as Int, produce Int. It\n  performs io:\n  Return 1.\n`),
      { code: 'E055', line: 3, col: 39, params: { token: 'kw.performs' } });
  });

  it('It 文件结束：E055', () => {
    assert.deepEqual(first(`${H}Rule f given x as Int, produce Int. It`),
      { code: 'E055', line: 3, col: 39, params: { token: 'kw.performs' } });
  });

  it('It does：E060 before', () => {
    assert.deepEqual(first(`${H}Rule f given x as Int, produce Int. It does io:\n  Return 1.\n`),
      { code: 'E060', line: 3, col: 40, params: { token: 'kw.performs', before: "'does'" } });
  });
});
