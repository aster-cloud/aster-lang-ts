import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// 补齐 TS interpreter 与 truffle 对等的 Map.* （put/remove/keys/values）——
// 之前 TS 仅有 empty/get/contains/size，List.groupBy(...) 的 Map.values 链需要。
function run(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}
const R = (expr: string): string => `Rule main given seed as Int, produce Int:\n  Return ${expr}.`;

describe('Map.* 双引擎对等补齐', () => {
  it('Map.put then Map.get/size', () => assert.equal(run(R('Map.size(Map.put(Map.empty(), "a", 1))')), 1));
  it('Map.values length', () => assert.equal(run(R('List.length(Map.values(Map.put(Map.put(Map.empty(), "a", 1), "b", 2)))')), 2));
  it('Map.keys length', () => assert.equal(run(R('List.length(Map.keys(Map.put(Map.empty(), "a", 1)))')), 1));
  it('Map.remove', () => assert.equal(run(R('Map.size(Map.remove(Map.put(Map.empty(), "a", 1), "a"))')), 0));
});

// null 键必须被**显式拒绝**，而不是塌陷成字符串 "null"（ADR 0035 档位 A / truffle#74 第 1 项）。
//
// 此前四处 Map builtin 各写 String(k)，而 String(null) === "null"：
// Map.put(m, null, a) 与 Map.put(m, "null", b) 落到同一槽位、后者静默覆盖前者、
// size 仍为 1 —— **两个不同的逻辑键被悄悄合并**。对合规决策引擎，
// 静默丢数据比抛错危险得多。Java 侧同步拒绝，维持双引擎一致。
describe('Map null 键显式拒绝', () => {
  const expectRejected = (expr: string, what: string) => {
    const c = compile(`Module probe.\nRule main given seed as Int, produce Int:\n  Return ${expr}.\n`);
    assert.ok(c.core, 'compile 应成功——拒绝发生在运行期');
    const ev = evaluate(c.core!, 'main', { seed: 0 });
    assert.equal(ev.success, false, `${what} 的 null 键必须被拒`);
    assert.match(String(ev.error), /Map key must not be null/);
  };

  // 四个带键的 builtin 共用 mapKey，逐个钉住——避免将来某个绕过归一化。
  it('Map.put 拒绝 null 键', () => expectRejected('Map.size(Map.put(Map.empty(), null, 1))', 'Map.put'));
  it('Map.get 拒绝 null 键', () => expectRejected('Map.get(Map.empty(), null)', 'Map.get'));
  it('Map.remove 拒绝 null 键', () => expectRejected('Map.size(Map.remove(Map.empty(), null))', 'Map.remove'));
  it('Map.contains 拒绝 null 键', () =>
    expectRejected('If Map.contains(Map.empty(), null) then 1 else 0', 'Map.contains'));

  // ★反向保险：字符串 "null" 本身是合法键，不得被误伤。
  //   若实现写成「把 null 与 "null" 一起拒」，就从「静默合并」变成「误杀合法键」。
  it('字符串 "null" 仍是合法键', () =>
    assert.equal(run(R('Map.size(Map.put(Map.empty(), "null", 1))')), 1));
});

// List.groupBy 自己建 GuestMap，**绕过**了 Map.* 共用的 mapKey 归一化点。
// 补漏前：keyFn 返回真 null 与返回字符串 "null" 会塌陷到同一个桶
// （实测期望 2 组、实得 1 组，两个元素并进一个 bucket）——
// 与 Map.put 的 null 键塌陷是**同一个 bug 的第二个入口**。
describe('List.groupBy 的分组键同样走 mapKey', () => {
  it('null 分组键被拒，而不是与字符串 "null" 静默合并', () => {
    const c = compile(`Module probe.
Rule keyOf given x as Text, produce Text:
  Let m be Map.put(Map.empty(), "x", "null").
  Return Map.get(m, x).

Rule main given xs as List, produce Int:
  Return Map.size(List.groupBy(xs, keyOf)).
`);
    assert.ok(c.core);
    // 'x' → 字符串 "null"；'zzz' 缺键 → 真 null
    const ev = evaluate(c.core!, 'main', { xs: ['x', 'zzz'] });
    assert.equal(ev.success, false, '★null 分组键必须被拒，而不是静默并桶');
    assert.match(String(ev.error), /Map key must not be null/);
  });

  it('正常分组键不受影响', () => {
    const c = compile(`Module probe.
Rule keyOf given x as Text, produce Text:
  Return x.

Rule main given xs as List, produce Int:
  Return Map.size(List.groupBy(xs, keyOf)).
`);
    assert.ok(c.core);
    const ev = evaluate(c.core!, 'main', { xs: ['a', 'b', 'a'] });
    assert.equal(ev.success, true, `正常键应照常分组: ${ev.error ?? ''}`);
    assert.equal(ev.value, 2, 'a/b 两组');
  });
});
