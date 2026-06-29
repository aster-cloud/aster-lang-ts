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
