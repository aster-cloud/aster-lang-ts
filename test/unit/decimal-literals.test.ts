import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';
import Decimal from 'decimal.js';

// Decimal M1（ADR 0025）：m 后缀字面量 + canonical 字符串 + 精确加减乘 + 比较 + 禁 Double 混算。
// 运行时 Decimal 值=decimal.js 实例；测试比规范化字符串（与 truffle BigDecimal toPlainString 对齐）。
function runDecimal(body: string): string {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return (ev.value as Decimal).toFixed();
}
function runBool(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, ev.error ?? '');
  return ev.value;
}
function evalErr(body: string): string {
  const c = compile(`Module probe.\n${body}\n`);
  if (!c.core) return 'COMPILE:' + JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? []);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  return ev.success ? '<no error>' : String(ev.error);
}
const RD = (expr: string): string => `Rule main given seed as Int, produce Decimal:\n  Return ${expr}.`;
const RB = (expr: string): string => `Rule main given seed as Int, produce Bool:\n  Return ${expr}.`;

describe('Decimal M1 — 字面量位数上限 (ADR 0025 v1 ≤38, Codex P1)', () => {
  // 超 38 位会让 decimal.js(precision 80) 乘法静默舍入 vs BigDecimal 精确 → 双引擎分歧。硬拒。
  it('38 位有效数字 → 接受', () => assert.equal(runDecimal(RD('1'.repeat(38) + 'm')), '1'.repeat(38)));
  it('39 位有效数字 → 拒绝 (parse error)', () =>
    assert.match(evalErr(RD('1'.repeat(39) + 'm')), /COMPILE|38|significant digits/i));
  it('纯小数前导零不计有效位 (0.000…1 仅 1 位)', () =>
    assert.equal(runDecimal(RD('0.' + '0'.repeat(38) + '1m')), '0.' + '0'.repeat(38) + '1'));
});

describe('Decimal M1 — 字面量 canonical', () => {
  it('1.08m → 1.08', () => assert.equal(runDecimal(RD('1.08m')), '1.08'));
  it('1.00m → 1 (去尾零)', () => assert.equal(runDecimal(RD('1.00m')), '1'));
  it('001.2300m → 1.23 (去前导+尾零)', () => assert.equal(runDecimal(RD('001.2300m')), '1.23'));
  it('0.000m → 0', () => assert.equal(runDecimal(RD('0.000m')), '0'));
  it('10m → 10', () => assert.equal(runDecimal(RD('10m')), '10'));
});

describe('Decimal M1 — 精确加减乘', () => {
  it('0.1m plus 0.2m → 0.3 (无二进制误差)', () => assert.equal(runDecimal(RD('0.1m plus 0.2m')), '0.3'));
  it('100.01m minus 0.02m → 99.99', () => assert.equal(runDecimal(RD('100.01m minus 0.02m')), '99.99'));
  it('1.20m times 1.080m → 1.296 (scale 增长)', () => assert.equal(runDecimal(RD('1.20m times 1.080m')), '1.296'));
  it('price times taxRate 自然写法', () => assert.equal(runDecimal(RD('100.00m times 1.08m')), '108'));
});

describe('Decimal M1 — Int/Long 精确提升', () => {
  it('1m plus 2 (Int) → 3', () => assert.equal(runDecimal(RD('1m plus 2')), '3'));
  it('5 (Int) times 1.5m → 7.5', () => assert.equal(runDecimal(RD('5 times 1.5m')), '7.5'));
});

describe('Decimal M1 — 比较 (compareTo, 值语义)', () => {
  it('1.0m equals to 1.00m → true (值语义)', () => assert.equal(runBool(RB('1.0m equals to 1.00m')), true));
  it('1.01m greater than 1.001m → true', () => assert.equal(runBool(RB('1.01m greater than 1.001m')), true));
  it('100.00m at least 50m → true', () => assert.equal(runBool(RB('100.00m at least 50m')), true));
  it('0.1m plus 0.2m equals to 0.3m → true (精确)', () => assert.equal(runBool(RB('0.1m plus 0.2m equals to 0.3m')), true));
});

describe('Decimal M1 — 禁 Double 混算 (runtime 层: 非整数 Double 可catch)', () => {
  // 注：runtime Int/Double 都是 JS number, 无法区分 2.0(Double) vs 2(Int)——非整数 Double
  // (2.5)runtime 能 catch; 整数值 Double(2.0)的混算禁须由 **typechecker** 在编译期拦
  // (AST 节点 kind Int/Double/Decimal 可分)。typechecker 规则是 M1 后续(见 ADR 0025)。
  it('1.08m plus 2.5 (非整数 Double) → error', () => assert.match(evalErr(RD('1.08m plus 2.5')), /Cannot combine Decimal and Double/));
  it('2.5 (Double) times 3m → error', () => assert.match(evalErr(RD('2.5 times 3m')), /Cannot combine Decimal and Double/));
  it('Decimal / 禁 → error', () => assert.match(evalErr(RD('6m divided by 2m')), /Decimal .* not supported|use Decimal\.divide/i));
});

describe('Decimal M1 — 合规场景 (信贷 DTI 用 Decimal)', () => {
  it('月负债+预估还款 精确', () => {
    const src = `Rule main given seed as Int, produce Decimal:
  Let debt be 1200.50m.
  Let payment be 800.25m.
  Return debt plus payment.`;
    assert.equal(runDecimal(src), '2000.75');
  });
});
