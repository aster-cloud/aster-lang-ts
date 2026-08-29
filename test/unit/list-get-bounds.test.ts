import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

/**
 * `List.get` 越界必须抛错（issue aster-dev#32）。
 *
 * ★真实缺陷：TS 侧直接 `arr[idx]`，JS 语义下越界得 `undefined` 且**静默成功**；
 * 而 truffle `Builtins.List.get` 有显式边界检查并抛 `BuiltinException`。
 * 同一段源码两引擎一个静默产 undefined、一个响亮失败，而文档声称
 * 「越界报错且双引擎一致」——文档描述的是 truffle 的行为。
 *
 * 实测（修复前）：
 *
 *     List.get([1,2,3], 99)        → success:true, value:undefined
 *     List.get([1,2,3], 0 minus 1) → success:true, value:undefined
 *
 * undefined 随后会一路流进裁决结果，是最危险的一类静默错答案：
 * 既不报错、又不是正确值。
 */
function run(body: string): { success: boolean; value: unknown; error: string } {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  return { success: ev.success, value: ev.value, error: String(ev.error ?? '') };
}

describe('List.get 越界响亮失败（与 truffle 对齐）', () => {
  it('★索引超出长度（此前 success:true, value:undefined）', () => {
    const r = run('Rule main produce Int:\n  Return List.get([1, 2, 3], 99).');
    assert.equal(r.success, false, `必须失败，实际 value=${JSON.stringify(r.value)}`);
    assert.match(r.error, /index out of bounds/, `实际：${r.error}`);
  });

  it('★负索引同样越界（JS 里 arr[-1] 也是 undefined）', () => {
    const r = run('Rule main produce Int:\n  Return List.get([1, 2, 3], 0 minus 1).');
    assert.equal(r.success, false, `必须失败，实际 value=${JSON.stringify(r.value)}`);
    assert.match(r.error, /index out of bounds/, `实际：${r.error}`);
  });

  it('★恰好等于长度的索引越界（经典 off-by-one）', () => {
    const r = run('Rule main produce Int:\n  Return List.get([1, 2, 3], 3).');
    assert.equal(r.success, false, `size=3 时索引 3 越界，实际 value=${JSON.stringify(r.value)}`);
  });

  it('空列表任何索引都越界', () => {
    const r = run('Rule main produce Int:\n  Return List.get([], 0).');
    assert.equal(r.success, false, `实际 value=${JSON.stringify(r.value)}`);
  });

  it('★错误消息须带索引与长度（对齐 truffle collectionIndexOutOfBounds 英文形式）', () => {
    // 只断言「失败了」不够：用户需要知道越界的是哪个索引、列表多长。
    const r = run('Rule main produce Int:\n  Return List.get([1, 2, 3], 99).');
    assert.match(r.error, /99/, `须点名越界索引；实际：${r.error}`);
    assert.match(r.error, /size=3/, `须点名列表长度；实际：${r.error}`);
  });
});

describe('合法索引行为不变（反向护栏）', () => {
  // ★没有这一组，把 List.get 写成「一律抛错」也能让上面全部变绿。
  it('首元素 / 中间 / 末元素都正常', () => {
    assert.equal(run('Rule main produce Int:\n  Return List.get([10, 20, 30], 0).').value, 10);
    assert.equal(run('Rule main produce Int:\n  Return List.get([10, 20, 30], 1).').value, 20);
    assert.equal(run('Rule main produce Int:\n  Return List.get([10, 20, 30], 2).').value, 30);
  });

  it('单元素列表索引 0 正常', () => {
    const r = run('Rule main produce Int:\n  Return List.get([42], 0).');
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 42);
  });
});
