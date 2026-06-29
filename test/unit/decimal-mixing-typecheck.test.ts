import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import { typecheckModule } from '../../src/typecheck.js';
import type { Module as AstModule } from '../../src/types.js';

// Decimal↔Double 混算编译期拦截（ADR 0025，M1 后续）。
// runtime 只能 catch 非整数 Double（2.5）；整数值 Double（2.0）与 Int（2）在 JS number
// 不可分——必须靠 typechecker 在编译期按 AST 节点 kind（Double vs Decimal）拦截。
// Int/Long↔Decimal 精确提升放行。错误码 E031 DECIMAL_DOUBLE_MIXING。
function diagnose(body: string): string[] {
  const src = `Module probe.\n${body}\n`;
  const ast = parse(lex(canonicalize(src))).ast as AstModule;
  const core = lowerModule(ast);
  return typecheckModule(core).map(d => `${d.code}:${d.message}`);
}
function hasMixingError(body: string): boolean {
  return diagnose(body).some(d => d.startsWith('E031'));
}

describe('Decimal M1 后续 — Double↔Decimal 混算编译期拦截', () => {
  it('1.08m plus 2.0 (整数值 Double) → E031 (runtime 抓不到, 编译期拦)', () => {
    assert.ok(hasMixingError('Rule main produce Decimal:\n  Return 1.08m plus 2.0.'));
  });
  it('2.0 (Double) times 3m → E031', () => {
    assert.ok(hasMixingError('Rule main produce Decimal:\n  Return 2.0 times 3m.'));
  });
  it('1.08m minus 2.5 (非整数 Double) → E031 (编译期也拦, 不止 runtime)', () => {
    assert.ok(hasMixingError('Rule main produce Decimal:\n  Return 1.08m minus 2.5.'));
  });
  it('嵌套: (100.00m times 1.08m) plus 0.5 → E031 (Decimal 结果类型传播)', () => {
    assert.ok(hasMixingError('Rule main produce Decimal:\n  Return 100.00m times 1.08m plus 0.5.'));
  });
  // Codex 审查 P0：比较运算符混算（整数值 Double 不可 runtime catch，必须编译期拦）
  it('1.0m equals to 1.0 (整数值 Double 比较) → E031 (TS runtime=true 但 Truffle 抛错=分歧)', () => {
    assert.ok(hasMixingError('Rule main produce Bool:\n  Return 1.0m equals to 1.0.'));
  });
  it('1.0m at most 2.0 → E031', () => {
    assert.ok(hasMixingError('Rule main produce Bool:\n  Return 1.0m at most 2.0.'));
  });
  it('2.0 greater than 1.0m → E031', () => {
    assert.ok(hasMixingError('Rule main produce Bool:\n  Return 2.0 greater than 1.0m.'));
  });
  // Codex 审查 P0：Decimal.round/divide 的 Decimal 参数位混 Double
  it('Decimal.divide(1m, 2.0, 2, "HALF_UP") → E031 (divisor 是 Double)', () => {
    assert.ok(hasMixingError('Rule main produce Decimal:\n  Return Decimal.divide(1m, 2.0, 2, "HALF_UP").'));
  });
  it('Decimal.round(2.0, 1, "HALF_UP") → E031 (x 是 Double)', () => {
    assert.ok(hasMixingError('Rule main produce Decimal:\n  Return Decimal.round(2.0, 1, "HALF_UP").'));
  });
});

describe('Decimal M1 后续 — 比较/builtin 合法组合不误报', () => {
  it('1.0m equals to 1.00m (Decimal 比较) → 无 E031', () => {
    assert.ok(!hasMixingError('Rule main produce Bool:\n  Return 1.0m equals to 1.00m.'));
  });
  it('1.0m at most 2 (Int 比较) → 无 E031 (精确提升)', () => {
    assert.ok(!hasMixingError('Rule main produce Bool:\n  Return 1.0m at most 2.'));
  });
  it('Decimal.divide(1m, 2m, 2, "HALF_UP") → 无 E031', () => {
    assert.ok(!hasMixingError('Rule main produce Decimal:\n  Return Decimal.divide(1m, 2m, 2, "HALF_UP").'));
  });
  it('1.0 equals to 2.0 (纯 Double 比较) → 无 E031', () => {
    assert.ok(!hasMixingError('Rule main produce Bool:\n  Return 1.0 equals to 2.0.'));
  });
});

describe('Decimal M1 后续 — 合法组合不误报', () => {
  it('1.08m plus 2 (Int) → 无 E031 (精确提升允许)', () => {
    assert.ok(!hasMixingError('Rule main produce Decimal:\n  Return 1.08m plus 2.'));
  });
  it('1.08m plus 2.50m (Decimal+Decimal) → 无 E031', () => {
    assert.ok(!hasMixingError('Rule main produce Decimal:\n  Return 1.08m plus 2.50m.'));
  });
  it('1.08 plus 2.5 (Double+Double) → 无 E031 (纯 Double 合法)', () => {
    assert.ok(!hasMixingError('Rule main produce Double:\n  Return 1.08 plus 2.5.'));
  });
  it('1 plus 2 (Int+Int) → 无 E031', () => {
    assert.ok(!hasMixingError('Rule main produce Int:\n  Return 1 plus 2.'));
  });
});
