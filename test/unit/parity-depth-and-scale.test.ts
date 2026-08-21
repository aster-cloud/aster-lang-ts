import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// 与 truffle 对齐的两处 parity（ADR 0035 / truffle#74）：
//   1. valueEquals 的结构比较深度上限（此前 TS 侧**完全没有**）
//   2. 字符串 scale 的严格数字校验（此前 TS 侧 Number("0x10")=16 被接受）
//
// ★两处的共同立意：同一段规则在两套引擎、在不同机器上必须给出**同一个结果**。
//   跟随运行时栈的 RangeError、以及只在一侧接受的十六进制，都会破坏这一点。

function evalRule(body: string, ctx: Record<string, unknown>): { ok: boolean; value: unknown; error: string } {
  const c = compile(`Module probe.\n${body}\n`);
  if (!c.core) return { ok: false, value: undefined, error: 'compile failed' };
  const ev = evaluate(c.core, 'main', ctx);
  return { ok: ev.success, value: ev.value, error: String(ev.error ?? '') };
}

describe('valueEquals 深度上限与 truffle 同值', () => {
  // 深度 100 以内的正常嵌套必须照常工作——否则「加了上限」会误伤合法数据。
  it('深层但有限的嵌套仍可比较', () => {
    // List.contains 走 valueEquals；构造 60 层嵌套列表远超普通用法但在上限内。
    let expr = '1';
    for (let i = 0; i < 60; i++) expr = `List.append(List.empty(), ${expr})`;
    const r = evalRule(
      `Rule main given seed as Int, produce Bool:\n  Return List.contains(List.append(List.empty(), ${expr}), ${expr}).`,
      { seed: 0 });
    assert.equal(r.ok, true, `60 层嵌套应正常比较，实际: ${r.error ?? ''}`);
    assert.equal(r.value, true);
  });

  // 上限本身：CNL 层造不出真环形（Aster 集合不可变），故从宿主侧注入两个
  // **结构等价但引用不同**的 300 层嵌套 —— 引用不同才会真正逐层递归下去
  // （比自己会在 x===y 处早返回，测不到深度，我第一版就踩了这个坑）。
  it('超过上限时抛域内错误，而非宿主 RangeError', () => {
    const deep = (n: number): unknown => (n === 0 ? 1 : [deep(n - 1)]);
    const c = compile(
      'Module probe.\nRule main given xs as List, produce Bool:\n  Return List.contains(xs, List.get(xs, 1)).\n');
    assert.ok(c.core);
    const ev = evaluate(c.core!, 'main', { xs: [deep(300), deep(300)] });

    assert.equal(ev.success, false, '★300 层递归应触发深度上限');
    const msg = String(ev.error ?? '');
    assert.match(msg, /depth exceeded 100/,
      `★应抛域内深度错误；实际: ${msg}`);
    assert.doesNotMatch(msg, /RangeError|Maximum call stack/,
      '★不得泄漏宿主 RangeError（栈深相关、同一规则在不同机器上结果不同）');
  });
});

describe('字符串 scale 严格校验与 truffle 对齐', () => {
  const round = (scale: string) =>
    evalRule(`Rule main given seed as Int, produce Decimal:\n  Return Decimal.round(1.005m, ${scale}, "HALF_UP").`, { seed: 0 });

  it('数字 scale 正常', () => assert.equal(round('2').ok, true));
  it('"1e1" 与 truffle 一致地接受', () => assert.equal(round('"1e1"').ok, true));

  // ★这两条是本次修复点：此前 Number("0x10")=16 被静默接受，与 Java 分叉。
  it('"0x10" 必须拒绝（此前 TS 接受为 16，与 Java 分叉）', () => {
    const r = round('"0x10"');
    assert.equal(r.ok, false, '十六进制 scale 必须被拒绝');
    assert.match(String(r.error), /scale must be an integer/);
  });
  it('"2d" 必须拒绝', () => {
    const r = round('"2d"');
    assert.equal(r.ok, false);
    assert.match(String(r.error), /scale must be an integer/);
  });
});
