import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

/**
 * 严格整型换算（issue aster-lang-ts#144）。
 *
 * ★真实缺陷：`Date.*` / `List.range` / `List.get` / `List.slice` / `Text.substring`
 * 用裸 `Number()` 强转。`Number("x")` 得 `NaN` 后**所有防线同时失效**——
 * `NaN < MIN || NaN > MAX` 两侧都是 false 于是放行；`size > MAX_RANGE_SIZE` 同理，
 * 然后循环零次静默返回 `[]`。非法输入不报错，反而产出「看起来正常」的决策值。
 *
 * 实测（修复前）：
 *
 *     Date.daysBetween("x","b")            → success:true, value:NaN
 *     Date.addDays("x",5) greater than 0   → success:true, value:false
 *     List.length(List.range("a",5))       → success:true, value:0
 *
 * 而 truffle 同输入抛 `NumberFormatException`——**同一条规则两引擎一个静默出错答案、
 * 一个响亮失败**。对合规引擎，静默的那个远更危险：错误答案会一路流进裁决结果。
 */
function run(body: string): { success: boolean; value: unknown; error: string } {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  return { success: ev.success, value: ev.value, error: String(ev.error ?? '') };
}

function expectLoudFailure(body: string, mustMention: string): void {
  const r = run(body);
  assert.equal(r.success, false, `必须响亮失败，实际 success=true value=${JSON.stringify(r.value)}`);
  assert.match(r.error, /expected Int/, `错误信息须指明期望 Int；实际：${r.error}`);
  assert.ok(
    r.error.includes(mustMention),
    `错误信息须点名出问题的 builtin（${mustMention}），否则用户无从定位；实际：${r.error}`,
  );
}

describe('非法整型入参必须响亮失败（不得静默产 NaN）', () => {
  it('★Date.daysBetween 非数字字符串（此前 success:true, value:NaN）', () => {
    expectLoudFailure('Rule main produce Int:\n  Return Date.daysBetween("x", "b").', 'Date.daysBetween');
  });

  it('★Date.addDays 非数字字符串（此前静默产出 false 决策）', () => {
    // 这条最能说明危害：NaN 参与比较后产出一个**看似正常的布尔裁决**。
    expectLoudFailure('Rule main produce Bool:\n  Return Date.addDays("x", 5) greater than 0.', 'Date.addDays');
  });

  it('★List.range 非数字字符串（此前静默返回空列表）', () => {
    expectLoudFailure('Rule main produce Int:\n  Return List.length(List.range("a", 5)).', 'List.range');
  });

  it('List.get / List.slice / Text.substring 同样收口', () => {
    expectLoudFailure('Rule main produce Int:\n  Return List.get([1, 2, 3], "x").', 'List.get');
    expectLoudFailure('Rule main produce Int:\n  Return List.length(List.slice([1, 2, 3], "x", 2)).', 'List.slice');
    expectLoudFailure('Rule main produce Text:\n  Return Text.substring("hello", "x").', 'Text.substring');
  });

  it('★小数字符串被拒（对齐 Integer.parseInt，不接受 "5.0"）', () => {
    expectLoudFailure('Rule main produce Int:\n  Return List.length(List.range("5.0", 9)).', 'List.range');
  });

  it('★十六进制字符串被拒（裸 Number("0x10") 会读成 16，Java 侧拒绝）', () => {
    // 与 decimalScale 里已记录的同一类分叉：JS 的宽松数字解析会与 Java 分叉。
    expectLoudFailure('Rule main produce Int:\n  Return List.length(List.range("0x10", 99)).', 'List.range');
  });

  it('★空串与纯空白被拒（Number("") 是 0，会静默变成合法索引）', () => {
    expectLoudFailure('Rule main produce Int:\n  Return List.get([1, 2, 3], "").', 'List.get');
    expectLoudFailure('Rule main produce Int:\n  Return List.get([1, 2, 3], " ").', 'List.get');
  });
});

describe('合法输入行为不变（反向护栏）', () => {
  // ★没有这一组，把 toInt 写成「一律抛错」也能让上面全部变绿。
  it('List.range 正常', () => {
    const r = run('Rule main produce Int:\n  Return List.length(List.range(1, 5)).');
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 4);
  });

  it('Date.addDays 正常', () => {
    const r = run('Rule main produce Int:\n  Return Date.addDays(Date.fromISO("2026-01-01"), 5).');
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 20459);
  });

  it('List.get 正常', () => {
    const r = run('Rule main produce Int:\n  Return List.get([10, 20, 30], 1).');
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 20);
  });

  it('★数字字符串仍被接受（对齐 Integer.parseInt 收 "5"）', () => {
    const r = run('Rule main produce Int:\n  Return List.length(List.range("1", 5)).');
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 4);
  });

  it('★负数与前后空白仍被接受（parseInt 亦然）', () => {
    const r = run('Rule main produce Int:\n  Return List.length(List.range("-2", 2)).');
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 4);
  });

  it('★Double 入参按截断取整（对齐 Java Number.intValue()）', () => {
    // 不是拒绝——truffle 的 toInt 对 Number 走 intValue() 截断，必须一致。
    const r = run('Rule main produce Int:\n  Return List.get([10, 20, 30], 1.9).');
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 20, '1.9 应截断为 1');
  });
});
