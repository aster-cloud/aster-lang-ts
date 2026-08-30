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
//
// ★同一个塌陷还有第三个入口：**变体键**。`String(obj)` 恒为 "[object Object]"，
// 于是 `Some("null")` 与 `None` 并桶。见下方用例（aster-lang-ts#137）。
describe('List.groupBy 的分组键同样走 mapKey', () => {
  // ★Map.get 返回 Maybe（ADR 0035 档位 C）后，缺键得 `None` 而非裸 null，
  //   故这里**不再**触发 null 键守卫。真正要锁的是：`Some("null")` 与 `None`
  //   必须落进**两个**桶。
  //
  //   aster-lang-ts#137 统一 None 表示后实测暴露：TS 的 `String(obj)` 对任何
  //   对象都得 `"[object Object]"`，两个变体键塌陷成 1 桶；truffle 的
  //   `String.valueOf(map)` 渲染内容，得 2 桶——双引擎分叉且 TS 侧静默丢数据。
  //
  //   期望值取自 truffle 实测（同一份 IR、同一入参）：
  //     Map.size(...) → 2
  //     Map.keys(...) → [{__type=Some, value=null}, {__type=None}]
  //   TS 侧现已逐字节一致。
  it('★变体分组键按内容归一：Some("null") 与 None 不得并桶', () => {
    const c = compile(`Module probe.
Rule keyOf given x as Text, produce Text:
  Let m be Map.put(Map.empty(), "x", "null").
  Return Map.get(m, x).

Rule main given xs as List, produce Int:
  Return Map.size(List.groupBy(xs, keyOf)).
`);
    assert.ok(c.core);
    // 'x' → Some("null")；'zzz' 缺键 → None
    const ev = evaluate(c.core!, 'main', { xs: ['x', 'zzz'] });
    assert.equal(ev.success, true, String(ev.error ?? ''));
    assert.equal(ev.value, 2, '★两个不同的变体键必须分成两桶（truffle 实测为 2）');
  });

  // 反向护栏：键**字符串**也必须与 truffle 逐字节一致，否则只是"桶数碰巧相同"，
  // 跨引擎 Map.get 仍会查不到。分隔符 `, ` 与 truffle String.valueOf(Map) 对齐。
  it('★变体键的字符串形式与 truffle 逐字节一致', () => {
    const c = compile(`Module probe.
Rule keyOf given x as Text, produce Text:
  Let m be Map.put(Map.empty(), "x", "null").
  Return Map.get(m, x).

Rule main given xs as List, produce List:
  Return Map.keys(List.groupBy(xs, keyOf)).
`);
    assert.ok(c.core);
    const ev = evaluate(c.core!, 'main', { xs: ['x', 'zzz'] });
    assert.equal(ev.success, true, String(ev.error ?? ''));
    assert.deepEqual(ev.value, ['{__type=Some, value=null}', '{__type=None}']);
  });

  // null 键守卫本身不得被本次改动削弱：真 null 仍要响亮失败。
  it('真 null 分组键仍被拒', () => {
    const c = compile(`Module probe.
Rule keyOf given x as Text, produce Text:
  Return null.

Rule main given xs as List, produce Int:
  Return Map.size(List.groupBy(xs, keyOf)).
`);
    assert.ok(c.core);
    const ev = evaluate(c.core!, 'main', { xs: ['a', 'b'] });
    assert.equal(ev.success, false, '★真 null 键必须被拒');
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

// ★四个变体标签逐一独立钉死 + 嵌套载荷递归归一。
//
// 交叉审查（false-green-hunter）实测发现：此前只有 `Some`/`None` 被"顺带"覆盖
// ——因为唯一那条键测试恰好用了这两个。删掉 isVariantValue 里的 `Ok` 或 `Err`
// 全部测试仍绿；把 mapKeyPart 的递归改成 String(v) 也全绿（嵌套变体键 2 桶塌成 1 桶）。
//
// map-type-guard.test.ts 里那个 ['Some','Ok','Err','None'] 四变体矩阵**不构成覆盖**：
// 它测的是 asGuestMap 的类型守卫（`Map.size(Ok(1))` 要报错），根本不经过 mapKey。
// 典型的「名字像、断言在别处」。
//
// 期望值全部取自 truffle 实测（同一份 core IR 喂 CoreIrEvalCli）：
//   [{__type=Some, value=null}, {__type=Some, value={__type=Some, value=1}},
//    {__type=Ok, value=1}, {__type=Err, value=1}]
describe('变体作 Map 键：四标签 × 嵌套载荷', () => {
  const keysOf = (body: string) => {
    const c = compile(`Module probe.\nRule main produce List:\n${body}  Return Map.keys(m).\n`);
    assert.ok(c.core, `compile 失败: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
    const ev = evaluate(c.core!, 'main', {});
    assert.equal(ev.success, true, String(ev.error ?? ''));
    return ev.value as string[];
  };

  it('★Ok / Err 各自成键（删掉任一标签此前都不会变红）', () => {
    const keys = keysOf(
      '  Let m be Map.put(Map.put(Map.empty(), Ok(1), "a"), Err(1), "b").\n',
    );
    assert.deepEqual(keys, ['{__type=Ok, value=1}', '{__type=Err, value=1}']);
  });

  it('★Some / None 各自成键', () => {
    const keys = keysOf(
      '  Let m be Map.put(Map.put(Map.empty(), Some(1), "a"), none, "b").\n',
    );
    assert.deepEqual(keys, ['{__type=Some, value=1}', '{__type=None}']);
  });

  it('★嵌套载荷递归归一：Some(Some(1)) 与 Some(Some(2)) 不得并桶', () => {
    const keys = keysOf(
      '  Let m be Map.put(Map.put(Map.empty(), Some(Some(1)), "a"), Some(Some(2)), "b").\n',
    );
    assert.deepEqual(keys, [
      '{__type=Some, value={__type=Some, value=1}}',
      '{__type=Some, value={__type=Some, value=2}}',
    ]);
  });

  it('★嵌套 Some(None) 与 Some(Some(1)) 不得并桶', () => {
    const keys = keysOf(
      '  Let m be Map.put(Map.put(Map.empty(), Some(none), "a"), Some(Some(1)), "b").\n',
    );
    assert.deepEqual(keys, [
      '{__type=Some, value={__type=None}}',
      '{__type=Some, value={__type=Some, value=1}}',
    ]);
  });
});

// ★接受侧收紧：裸 null 不再被当作 None。
//
// 交叉审查发现这部分**零净覆盖**——把两处放行原样加回（即完整回退到修复前形态）
// 测试仍全绿。原因是 maybe-isnone-semantics / maybe-map-type-guard 里那两条
// 「两种 None 表示」用例，在 None 统一表示后两种形态求值成同一个东西，
// 断言退化成重复断言，而**真正的裸 null**从未被喂进去过。
//
// 期望值依据：truffle 的 `"None".equals(m.get("__type"))` 对 null 返回 false，
// `Maybe.map` 要求带标签的 map、对裸 null 直接抛错。
describe('接受侧：裸 null 不是 None（与 truffle 对齐）', () => {
  const run = (body: string) => {
    const c = compile(`Module probe.\n${body}`);
    assert.ok(c.core, `compile 失败: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
    return evaluate(c.core!, 'main', {});
  };

  it('★Maybe.isNone(null) 为 false（回退放行则变 true）', () => {
    const ev = run('Rule main produce Bool:\n  Return Maybe.isNone(null).\n');
    assert.equal(ev.success, true, String(ev.error ?? ''));
    assert.equal(ev.value, false, '裸 null 不是 None——truffle 侧同样返回 false');
  });

  it('★Option.isNone(null) 同样为 false（与 Maybe.isNone 共用实现）', () => {
    const ev = run('Rule main produce Bool:\n  Return Option.isNone(null).\n');
    assert.equal(ev.success, true, String(ev.error ?? ''));
    assert.equal(ev.value, false);
  });

  it('★Maybe.map(null, f) 响亮报错，而非静默返回 None', () => {
    // 回退放行后：静默得 None，再被 withDefault 兜成 9——一个看起来完全合理的
    // 决策值，正是本仓最危险的"静默错答案"。
    const ev = run(
      'Rule inc given x, produce:\n  Return x plus 1.\n\n'
      + 'Rule main produce Int:\n  Return Maybe.withDefault(Maybe.map(null, inc), 9).\n',
    );
    assert.equal(ev.success, false, `必须报错，实际得 value=${JSON.stringify(ev.value)}`);
    assert.match(String(ev.error), /expected Maybe \(Some or None\)/);
  });

  it('反向护栏：真正的 None 仍被 isNone/map 正确接受', () => {
    // 没有这条，把 isNone 写成"恒 false"、map 写成"恒报错"也能让上面全绿。
    const a = run('Rule main produce Bool:\n  Return Maybe.isNone(none).\n');
    assert.equal(a.value, true, 'None() 必须被认作 None');

    const b = run(
      'Rule inc given x, produce:\n  Return x plus 1.\n\n'
      + 'Rule main produce Int:\n  Return Maybe.withDefault(Maybe.map(Some(1), inc), 9).\n',
    );
    assert.equal(b.success, true, String(b.error ?? ''));
    assert.equal(b.value, 2, 'Some(1) 经 inc 应得 Some(2)，withDefault 取出 2');
  });
});

// ★`None()` 零参**调用形式**——与 evalExpr 的 `case 'None'` 是两条独立代码路径。
// 交叉审查实测：把 evalCall 这处改回 null，全部测试仍绿（另一处则会红 7 条）。
// commit 自称"产出侧三处统一"，这是其中唯一没被测到的一处。
//
// ★注意：`None()` **不是合法的 CNL 表层语法**（实测报 `Expected '.' at end of
// statement`），故只能直接构造 Core IR 来覆盖。这条路径并非死代码——本仓是 IR 的
// **生产者**，宿主或其它前端可以直接投喂 `Call{Name 'None', []}`；若它返回裸 null，
// 正是本次要消灭的那条分叉，且不会被任何表层语法测试发现。
describe('None() 调用形式与 None 字面量表示一致（IR 级）', () => {
  it('★Call{None, []} 求值为 {__type:"None"}', () => {
    // 先编译一份 `Return none.`，再把 Return 的表达式换成**调用形式**
    // ——这样 Module/Func/Block 的其余结构完全取自真实编译器产物，
    // 不必手写（手写易与真实 IR 形状漂移，且漂移后测试会以"编译失败"的
    // 方式假红/假绿，掩盖真正要测的东西）。
    const c = compile('Module probe.\nRule main produce:\n  Return none.\n');
    assert.ok(c.core, 'fixture 编译应成功');
    const core = JSON.parse(JSON.stringify(c.core)) as {
      decls: { body: { statements: { expr: unknown }[] } }[];
    };
    core.decls[0]!.body.statements[0]!.expr = {
      kind: 'Call',
      target: { kind: 'Name', name: 'None' },
      args: [],
    };
    const ev = evaluate(core as unknown as Parameters<typeof evaluate>[0], 'main', {});
    assert.equal(ev.success, true, String(ev.error ?? ''));
    assert.deepEqual(ev.value, { __type: 'None' });
    assert.notEqual(ev.value, null, 'None() 调用形式不得退化为裸 null');
  });
});
