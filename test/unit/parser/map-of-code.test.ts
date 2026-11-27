/**
 * aster-lang-ts#396：`Map of …` 与 core 同码、同位置、同 token 参数（报在 of 上）。
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
const RULE = (type: string, rest = ', produce Int:\n  Return 1.\n') => `${H}Rule f given x as ${type}${rest}`;

describe('#396：Map of 之后是类型起始记号，报 E061 在 of 上', () => {
  for (const after of ['Int', 'Text to Int', 'Map Int to Int to Int', '(Int) to Int', '@pii(L1, email) Text to Int']) {
    it(`Map of ${after}`, () => {
      assert.deepEqual(first(RULE(`Map of ${after}`)), { code: 'E061', line: 3, col: 23, params: { token: 'kw.of' } });
    });
  }

  it('嵌套的 Map of 报在内层 of 上', () => {
    assert.deepEqual(first(RULE('Map Map of Int to Int to Int')), { code: 'E061', line: 3, col: 27, params: { token: 'kw.of' } });
  });

  it('返回类型里的 Map of', () => {
    assert.deepEqual(first(`${H}Rule f given x as Int, produce Map of Int:\n  Return 1.\n`),
      { code: 'E061', line: 3, col: 36, params: { token: 'kw.of' } });
  });
});

describe('#396：Map of 之后不是类型，报 E062 在 of 上', () => {
  for (const [label, src] of [
    ['换行', RULE('Map of', '\n  Int, produce Int:\n  Return 1.\n')],
    ['逗号', RULE('Map of')],
    ['文件末', `${H}Rule f given x as Map of`],
    ['数字', RULE('Map of 1 to Int')],
  ] as const) {
    it(label, () => {
      assert.deepEqual(first(src), { code: 'E062', line: 3, col: 23, params: { token: 'kw.of', expected: 'token.type' } });
    });
  }
});

describe('#396：不带 of 的 Map 不受影响', () => {
  it('Map Text to Int 照常编译', () => {
    assert.doesNotThrow(() => compileSource(RULE('Map Text to Int'), { locale: 'en-US' }));
  });
});
