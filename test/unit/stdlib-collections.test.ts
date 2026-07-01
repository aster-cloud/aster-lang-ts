import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// evaluate 的 maxSteps 选项：受信、计算量已知有界的场景（如 poker best-5-of-7：
// 21 组合×classify ~数万步但 <6ms）可上调步数闸门；默认 10000 不变（untrusted DoS 防护）。
describe('evaluate maxSteps option', () => {
  // 制造一个超过默认 10000 步但有界的计算：对一个长列表反复 map（步数随长度线性增长）。
  const heavy = `Module probe.
Rule dbl given x, produce:
  Return x times 2.
Rule main given seed as Int, produce Int:
  Let xs be List.range(0, 4000).
  Let a be List.map(xs, dbl).
  Let b be List.map(a, dbl).
  Let c be List.map(b, dbl).
  Return List.length(c).`;
  it('heavy computation exceeds default 10000 steps', () => {
    const m = compile(heavy);
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 });
    assert.equal(ev.success, false);
    assert.match(String(ev.error), /Maximum execution steps \(10000\)/);
  });
  it('same computation succeeds with raised maxSteps', () => {
    const m = compile(heavy);
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 200000 });
    assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
    assert.equal(ev.value, 4000);
  });
});

// ADR 0024 受控 stdlib：通用集合 builtin（与 truffle Builtins 镜像，逐位 parity）。
function run(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}
const R = (expr: string): string => `Rule main given seed as Int, produce Int:\n  Return ${expr}.`;
const Rf = (helper: string, expr: string): string => `${helper}\nRule main given seed as Int, produce Int:\n  Return ${expr}.`;

describe('ADR 0024 stdlib — 通用集合 builtin', () => {
  it('List.sum', () => assert.equal(run(R('List.sum([3, 8, 1, 9])')), 21));
  it('List.sum empty', () => assert.equal(run(R('List.sum([])')), 0));
  it('List.min', () => assert.equal(run(R('List.min([3, 8, 1, 9])')), 1));
  it('List.max', () => assert.equal(run(R('List.max([3, 8, 1, 9])')), 9));
  it('List.distinct', () => assert.equal(run(R('List.length(List.distinct([2, 2, 5, 2, 9]))')), 3));
  it('List.range', () => assert.equal(run(R('List.length(List.range(2, 7))')), 5));
  it('List.sort ascending', () => assert.equal(run(R('List.get(List.sort([9, 1, 5]), 0)')), 1));
  it('List.count', () => assert.equal(run(Rf('Rule big given x, produce:\n  Return x greater than 5.', 'List.count([3, 8, 1, 9, 6], big)')), 3));
  it('List.sortBy', () => assert.equal(run(Rf('Rule neg given x, produce:\n  Return 0 - x.', 'List.get(List.sortBy([3, 8, 1], neg), 0)')), 8));
  it('List.maxBy', () => assert.equal(run(Rf('Rule id given x, produce:\n  Return x.', 'List.maxBy([3, 8, 1], id)')), 8));
  it('List.minBy', () => assert.equal(run(Rf('Rule id given x, produce:\n  Return x.', 'List.minBy([3, 8, 1], id)')), 1));
  it('List.groupBy', () => assert.equal(run(Rf('Rule par given x, produce:\n  Return x modulo 2.', 'Map.size(List.groupBy([1, 2, 3, 4, 5], par))')), 2));
  // List.combinations(list, k)：C(n,k) 个 k 元素子集，确定性递增索引字典序。
  it('List.combinations count C(4,2)=6', () => assert.equal(run(R('List.length(List.combinations([10, 20, 30, 40], 2))')), 6));
  it('List.combinations count C(7,5)=21 (poker best-5-of-7)', () => assert.equal(run(R('List.length(List.combinations([2, 3, 4, 5, 6, 7, 8], 5))')), 21));
  it('List.combinations k=0 → [[]]', () => assert.equal(run(R('List.length(List.combinations([1, 2, 3], 0))')), 1));
  it('List.combinations k>n → []', () => assert.equal(run(R('List.length(List.combinations([1, 2], 5))')), 0));
  it('List.combinations first subset is [0,1] indices', () => assert.equal(run(R('List.get(List.get(List.combinations([10, 20, 30], 2), 0), 0)')), 10));
  it('List.combinations second subset is [0,2] → [10,30]', () => assert.equal(run(R('List.get(List.get(List.combinations([10, 20, 30], 2), 1), 1)')), 30));
});

// 红队 P0-B：List.range 内存耗尽 DoS 防护。range 是唯一「从标量凭空造大列表」的
// builtin，MAX_STEPS 只数解释器步进不数 native 循环 → 必须按结果长度设上限。
describe('红队 P0-B — List.range DoS 上限', () => {
  // 返回 evaluate 结果（不 assert 成功），用于断言失败路径。
  function tryRun(body: string): { success: boolean; error?: unknown; value?: unknown } {
    const c = compile(`Module probe.\n${body}\n`);
    assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
    return evaluate(c.core!, 'main', { seed: 0 });
  }

  it('range 超上限（超 1e6）被拒绝，报内存耗尽 DoS', () => {
    // 2_000_000 > MAX_RANGE_SIZE(1_000_000)
    const ev = tryRun(R('List.length(List.range(0, 2000000))'));
    assert.equal(ev.success, false, '超上限 range 必须失败，不得占死内存');
    assert.match(String(ev.error), /List\.range: 长度过大.*拒绝以防内存耗尽 DoS/);
  });

  it('range 恰在上限内（1e6）成功', () => {
    // 边界：正好 MAX_RANGE_SIZE 应放行；用较高 maxSteps 让 length 计算有余量
    const c = compile(`Module probe.\n${R('List.length(List.range(0, 1000000))')}\n`);
    assert.ok(c.core);
    const ev = evaluate(c.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000 });
    assert.ok(ev.success, `边界内 range 应成功: ${ev.error ?? ''}`);
    assert.equal(ev.value, 1000000);
  });

  it('range 常规小区间不受影响', () => {
    assert.equal(run(R('List.length(List.range(2, 7))')), 5);
  });
});

// 红队 P2-I：Map.keys/values 确定性顺序（插入序）。TS 用 JS object，Object.keys/values
// 天然插入序；truffle 侧改用 LinkedHashMap 对齐。此处锁 TS 契约，与 truffle
// StdlibCollectionTest.mapKeysPreserveInsertionOrder 双引擎一致。
describe('红队 P2-I — Map.keys/values 插入序确定性', () => {
  // 返回原始值（不强转 Int），供 List 结果断言。
  function runVal(body: string): unknown {
    const c = compile(`Module probe.\n${body}\n`);
    assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
    const ev = evaluate(c.core!, 'main', { seed: 0 });
    assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
    return ev.value;
  }
  // produce 无类型标注，返回 List（keys 是文本列表）。
  const RList = (expr: string): string =>
    `Rule main given seed as Int, produce:\n  Return ${expr}.`;

  it('Map.keys 保留插入序（非哈希序/字母序）', () => {
    // zebra→apple→mango→delta 插入，keys 必须按此序（非字母序）
    const expr =
      'Map.keys(Map.put(Map.put(Map.put(Map.put(Map.empty(), "zebra", 1), "apple", 2), "mango", 3), "delta", 4))';
    const keys = runVal(RList(expr));
    assert.deepEqual(keys, ['zebra', 'apple', 'mango', 'delta']);
  });

  it('Map.values 保留插入序', () => {
    const expr =
      'Map.values(Map.put(Map.put(Map.put(Map.empty(), "zebra", 10), "apple", 20), "mango", 30))';
    const vals = runVal(RList(expr));
    assert.deepEqual(vals, [10, 20, 30]);
  });

  it('Map.remove 后剩余键保持相对序', () => {
    const expr =
      'Map.keys(Map.remove(Map.put(Map.put(Map.put(Map.empty(), "zebra", 1), "apple", 2), "mango", 3), "apple"))';
    const keys = runVal(RList(expr));
    assert.deepEqual(keys, ['zebra', 'mango']);
  });
});
