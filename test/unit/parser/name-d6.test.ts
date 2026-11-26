/**
 * 裁决 D6（Wave D，ADR 0019 G1）：与 core 同口径的两处放宽。
 * - 小写 `if` 后面紧跟 `.` / `,` / `)` 时是名字（`Return if.`、`g(if, 1)`、`h(if)`），其余位置仍是 if 表达式；
 * - Let 名收大写开头的名字（`Let Foo be x`、de `sei Betrag gleich x`），结构关键词的规范拼写（`If`、`Return`）仍报 E901。
 * 两引擎一致性由 aster-lang-test 的 tier1 样本 name-d6-en / name-d6-de 守护。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompileFailure, compileSource } from '../../../src/policy-package/compile-source.js';

function firstCode(source: string, locale = 'en-US'): string | null {
  try {
    compileSource(source, { locale });
    return null;
  } catch (e) {
    if (!(e instanceof CompileFailure)) throw e;
    return String(JSON.parse(e.diagnostics[0] ?? '{}').code);
  }
}

const H = 'Module m.\n\nRule h given a as Int, produce Int:\n  Return a.\n\nRule g given a as Int, b as Int, produce Int:\n  Return a.\n\n';

describe('裁决 D6：if 作名字', () => {
  for (const [name, body] of [
    ['Return if.', '  Return if.\n'],
    ['g(if, 1)', '  Return g(if, 1).\n'],
    ['h(if)', '  Return h(if).\n'],
  ] as const) {
    it(`${name} 编译通过`, () => assert.equal(firstCode(`${H}Rule f given if as Int, produce Int:\n${body}`), null));
  }

  it('if 表达式不受影响', () => {
    assert.equal(firstCode(`${H}Rule f given x as Int, produce Int:\n  Return if x > 1 then 1 else 2.\n`), null);
  });
});

describe('裁决 D6：大写开头的 Let 名', () => {
  it('Let Foo / Let IF 编译通过', () => {
    assert.equal(firstCode(`${H}Rule f given x as Int, produce Int:\n  Let Foo be x.\n  Let IF be Foo.\n  Return IF.\n`), null);
  });

  it('de sei Betrag gleich x 编译通过', () => {
    assert.equal(firstCode('Modul m.\n\nRegel f gegeben x als Int, liefert Int:\n  sei Betrag gleich x.\n  gib zurueck Betrag.\n', 'de-DE'), null);
  });

  it('结构关键词的规范拼写仍报 E901', () => {
    assert.equal(firstCode(`${H}Rule f given x as Int, produce Int:\n  Let If be x.\n  Return 1.\n`), 'E901');
    assert.equal(firstCode(`${H}Rule f given x as Int, produce Int:\n  Let Return be x.\n  Return 1.\n`), 'E901');
  });
});
