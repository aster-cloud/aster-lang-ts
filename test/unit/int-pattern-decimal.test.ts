import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

/**
 * 整数模式 `When N` 对 Decimal 值按精确数值比较（aster-lang-ts#289，对齐 truffle#166/#167）。
 * Decimal 运行时为 decimal.js 实例，原先 `value === pattern.value` 恒为 false。
 */
const SRC = `Module probe.

Rule classify given x, produce Text:
  Match x:
    When 0, Return "zero".
    When 1, Return "one".
    When other, Return "other".

Rule zero produce Text:
  Return classify(0m).

Rule zeroScaled produce Text:
  Return classify(0.00m).

Rule oneScaled produce Text:
  Return classify(1.000m).

Rule onePointFive produce Text:
  Return classify(1.5m).

Rule tinyFraction produce Text:
  Return classify(0.0000000000000000000001m).

Rule plainInt produce Text:
  Return classify(1).

Rule text produce Text:
  Return classify("0").
`;

function run(entry: string): unknown {
  const c = compile(SRC);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, entry, {});
  assert.equal(ev.success, true, String(ev.error ?? ''));
  return ev.value;
}

describe('整数模式匹配 Decimal（精确数值比较）', () => {
  it('Decimal 0 命中 When 0', () => assert.equal(run('zero'), 'zero'));
  it('Decimal 0.00 命中 When 0（不看 scale）', () => assert.equal(run('zeroScaled'), 'zero'));
  it('Decimal 1.000 命中 When 1', () => assert.equal(run('oneScaled'), 'one'));
  it('Decimal 1.5 不命中 When 1', () => assert.equal(run('onePointFive'), 'other'));
  it('极小非零小数不命中 When 0（不经 double 近似）', () => assert.equal(run('tinyFraction'), 'other'));
  it('Int 行为不变', () => assert.equal(run('plainInt'), 'one'));
  it('Text "0" 不命中 When 0', () => assert.equal(run('text'), 'other'));
});
