import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';
import Decimal from 'decimal.js';

// Decimal M2（ADR 0025）：Decimal.round(x, scale, mode) + Decimal.divide(x, y, scale, mode)。
// mode 字符串 HALF_UP/HALF_EVEN/DOWN，scale 0..18。三引擎逐位一致（与 truffle BigDecimal
// setScale/divide(RoundingMode) 对齐，含 2.5→2 银行家舍入 + DOWN 朝零截断 + canonical 去尾零）。
function runDecimal(body: string): string {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return (ev.value as Decimal).toFixed();
}
function evalErr(body: string): string {
  const c = compile(`Module probe.\n${body}\n`);
  if (!c.core) return 'COMPILE';
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  return ev.success ? '<no error>' : String(ev.error);
}
const R = (expr: string): string => `Rule main given seed as Int, produce Decimal:\n  Return ${expr}.`;

describe('Decimal M2 — round 舍入模式', () => {
  it('2.345m sc2 HALF_UP → 2.35', () => assert.equal(runDecimal(R('Decimal.round(2.345m, 2, "HALF_UP")')), '2.35'));
  it('2.345m sc2 HALF_EVEN → 2.34 (向偶)', () => assert.equal(runDecimal(R('Decimal.round(2.345m, 2, "HALF_EVEN")')), '2.34'));
  it('2.355m sc2 HALF_EVEN → 2.36 (向偶)', () => assert.equal(runDecimal(R('Decimal.round(2.355m, 2, "HALF_EVEN")')), '2.36'));
  it('2.5m sc0 HALF_EVEN → 2 (银行家)', () => assert.equal(runDecimal(R('Decimal.round(2.5m, 0, "HALF_EVEN")')), '2'));
  it('3.5m sc0 HALF_EVEN → 4 (银行家)', () => assert.equal(runDecimal(R('Decimal.round(3.5m, 0, "HALF_EVEN")')), '4'));
  it('2.999m sc0 DOWN → 2 (截断)', () => assert.equal(runDecimal(R('Decimal.round(2.999m, 0, "DOWN")')), '2'));
  it('2.50m sc2 → 2.5 (canonical 去尾零)', () => assert.equal(runDecimal(R('Decimal.round(2.50m, 2, "HALF_UP")')), '2.5'));
});

describe('Decimal M2 — divide 精确除法', () => {
  it('10m / 3m sc4 HALF_UP → 3.3333', () => assert.equal(runDecimal(R('Decimal.divide(10m, 3m, 4, "HALF_UP")')), '3.3333'));
  it('2m / 3m sc2 HALF_UP → 0.67', () => assert.equal(runDecimal(R('Decimal.divide(2m, 3m, 2, "HALF_UP")')), '0.67'));
  it('1m / 8m sc2 DOWN → 0.12', () => assert.equal(runDecimal(R('Decimal.divide(1m, 8m, 2, "DOWN")')), '0.12'));
  it('1m / 3m sc2 HALF_EVEN → 0.33', () => assert.equal(runDecimal(R('Decimal.divide(1m, 3m, 2, "HALF_EVEN")')), '0.33'));
  it('100m / 4m sc2 → 25 (整除 canonical)', () => assert.equal(runDecimal(R('Decimal.divide(100m, 4m, 2, "HALF_UP")')), '25'));
});

describe('Decimal M2 — 合规场景 (利率/分摊)', () => {
  it('月利率: 年息 7.25% / 12 期, sc6 HALF_EVEN', () => {
    // 0.0725 / 12 = 0.00604166... → sc6 HALF_EVEN = 0.006042
    assert.equal(runDecimal(R('Decimal.divide(0.0725m, 12m, 6, "HALF_EVEN")')), '0.006042');
  });
  it('税额: 108.00m round sc2 = 108', () => assert.equal(runDecimal(R('Decimal.round(100.00m times 1.08m, 2, "HALF_UP")')), '108'));
});

describe('Decimal M2 — 错误处理', () => {
  it('除零 → error', () => assert.match(evalErr(R('Decimal.divide(1m, 0m, 2, "HALF_UP")')), /division by zero/i));
  it('未知 mode → error', () => assert.match(evalErr(R('Decimal.round(1.5m, 2, "CEILING")')), /unknown rounding mode/i));
  it('scale 越界(>18) → error', () => assert.match(evalErr(R('Decimal.round(1.5m, 19, "HALF_UP")')), /scale must be/i));
  // 注：负 scale 无法用 CNL 字面量构造（无前缀 -，`-1` 解析失败）；runtime 仍校验 n<0，
  // 但只能通过非字面量路径触发（例如 evaluation 输入），此处不测无法构造的输入。
});
