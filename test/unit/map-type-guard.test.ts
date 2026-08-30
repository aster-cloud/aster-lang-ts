import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';

// Map.* 的首参类型守卫（aster-lang-ts#132）。
//
// `asGuestMap` 此前对**任意**值静默兜底成空 Map：`Map.size(42)`→0、
// `Map.get(42,"k")`→None、`Map.keys(42)`→[]，全是**看起来完全合理**的值。
// 而 truffle 侧七个 Map.* 一律抛 `操作 Map.X 期望类型 Map`。
//
// ★危害高于 #128：`Map.get` 是策略规则读字段的主路径，
// `Maybe.withDefault(Map.get(applicant,"creditScore"), 0)` 在本引擎静默走兜底值
// 照常输出决策、在 JVM 上拒绝执行——同一条规则跨引擎决策翻转。
//
// ★核查方法（吸取 #128 的教训）：不读源码下结论，而是把同一份 IR 分别喂给
// 两个引擎逐个实测。对标量 / 列表 / 普通对象误用，七个 Map.* 在 truffle 上全部抛错。
//
// ★但**不要说"无一例外"**——交叉审查实测出一类残留分叉（#134）：
// `None` 首参在 truffle 上**不抛**（`Map.size(None)` 返回 1），因为 JVM 的 None 是
// `LinkedHashMap{_type:"None"}`，本身就是 java.util.Map，`_type` 被当成一个键数进去。
// 本引擎的 None 是裸 null，被守卫拒掉。方向仍是「TS 更严、JVM 更松」。
// 下面 `残留分叉` 那条用例锁住现状，防止它无声消失。

initializeAllBundledLexicons();

/** 编译 + 求值一个表达式（无参规则）。 */
function run(expr: string): { ok: boolean; value?: unknown; error?: string } {
  const c = compile(`Module p.\n\nRule f produce Int:\n  Return ${expr}.\n`, { lexicon: EN_US });
  if (!c.success || !c.core) return { ok: false, error: 'compile failed' };
  const out = evaluate(c.core, 'f', {}) as { success: boolean; value?: unknown; error?: string };
  return out.success
    ? { ok: true, value: out.value }
    : { ok: false, error: out.error ?? '(无错误信息)' };
}

/** 用宿主入参调用 `Rule f given m`，验证真实 context 形态。 */
function runWithMap(m: unknown): { ok: boolean; value?: unknown; error?: string } {
  const c = compile(`Module p.\n\nRule f given m, produce Int:\n  Return Map.size(m).\n`, {
    lexicon: EN_US,
  });
  assert.ok(c.success && c.core, 'compile 失败');
  const out = evaluate(c.core, 'f', { m }) as {
    success: boolean;
    value?: unknown;
    error?: string;
  };
  return out.success
    ? { ok: true, value: out.value }
    : { ok: false, error: out.error ?? '(无错误信息)' };
}

const MAP_OPS: ReadonlyArray<readonly [string, string]> = [
  ['Map.get', 'Maybe.withDefault(Map.get(42, "k"), 0)'],
  ['Map.size', 'Map.size(42)'],
  ['Map.put', 'Map.size(Map.put(42, "k", 1))'],
  ['Map.remove', 'Map.size(Map.remove(42, "k"))'],
  ['Map.keys', 'List.length(Map.keys(42))'],
  ['Map.values', 'List.length(Map.values(42))'],
];

describe('Map.* 首参类型守卫', () => {
  for (const [op, expr] of MAP_OPS) {
    it(`${op} 对非 Map 首参报错，而非静默兜底成空 Map`, () => {
      const r = run(expr);
      assert.equal(r.ok, false, `应当失败，实际静默返回 ${JSON.stringify(r.value)}`);
      assert.equal(r.error, `${op}: expected Map, got number`);
    });
  }

  // Map.contains 返回 Bool，单独用 If 取值。
  it('Map.contains 对非 Map 首参报错', () => {
    const c = compile(
      'Module p.\n\nRule f produce Int:\n  If Map.contains(42, "k"):\n    Return 1.\n  Return 0.\n',
      { lexicon: EN_US },
    );
    assert.ok(c.success && c.core, 'compile 失败');
    const out = evaluate(c.core, 'f', {}) as { success: boolean; error?: string };
    assert.equal(out.success, false);
    assert.equal(out.error, 'Map.contains: expected Map, got number');
  });

  it('文本 / null / 数组等其它类型同样被拒', () => {
    assert.equal(run('Map.size("abc")').error, 'Map.size: expected Map, got string');
    // None 的运行期表示是 `{__type:'None'}`（aster-lang-ts#137），故类型名报 `None`
    // ——与 truffle 的 typeName()（读 __type 标签）一致。此前是裸 null，被更前面的
    // null 分支拦下报 `got object`，那正是被修掉的分叉。
    assert.equal(run('Map.size(None)').error, 'Map.size: expected Map, got None');
    // 数组不是 Map：truffle 侧 java.util.List 既非 AsterMapValue 也非 Map，同样抛错。
    // 此前 `Map.size(List.range(0,2))` 会返回 2——把列表当成 Map 用。
    assert.equal(
      run('Map.size(List.range(0, 2))').error,
      'Map.size: expected Map, got List',
    );
  });

  // ★放行范围：宿主 context 里的 map 就是普通对象 / JS Map 两种形态，
  // 加守卫**不能**误伤它们，否则所有真实调用都会炸。
  it('宿主传入的普通对象与 JS Map 仍然可用', () => {
    assert.deepEqual(runWithMap({ a: 1, b: 2 }), { ok: true, value: 2 });
    assert.deepEqual(runWithMap(new Map([['a', 1]])), { ok: true, value: 1 });
    assert.deepEqual(runWithMap({}), { ok: true, value: 0 });
  });

  it('引擎内部产生的 Map 全链路正常', () => {
    assert.deepEqual(run('Map.size(Map.empty())'), { ok: true, value: 0 });
    assert.deepEqual(run('Map.size(Map.put(Map.empty(), "a", 1))'), { ok: true, value: 1 });
    assert.deepEqual(
      run('Maybe.withDefault(Map.get(Map.put(Map.empty(), "a", 7), "a"), 0)'),
      { ok: true, value: 7 },
    );
  });

  // ★Maybe/Result 变体不是 Map（#134 已在两引擎同步收紧）。
  // 这些变体的运行期表示本身就是"带 _type 的对象/Map"，不拦就会被当成普通 Map
  // 数键——`Map.size(Some(1))`→2、`Map.size(None)`→1（JVM），全是静默错答案。
  //
  // 二维矩阵实测（6 个 Map.* × 6 种输入 = 36 格）：修复前 None 那 6 格两引擎分叉、
  // Some/Ok/Err 那 18 格两引擎"一致地错"；修复后 36 格逐格一致。
  it('Maybe/Result 变体被 Map.* 拒绝（Some/None/Ok/Err）', () => {
    // ★四个变体现在走**同一条**路径：都是带 `__type` 的对象，类型名即标签值
    // （aster-lang-ts#137 起 None 也是 `{__type:'None'}`）。与 truffle 的
    // typeName()（`m.get("__type")` 命中即返回标签）逐格一致。
    for (const [arg, want] of [
      ['Some(1)', 'Some'],
      ['Ok(1)', 'Ok'],
      ['Err(1)', 'Err'],
      ['None', 'None'],
    ] as const) {
      const r = run(`Map.size(${arg})`);
      assert.equal(r.ok, false, `${arg} 应被拒绝，实际返回 ${JSON.stringify(r.value)}`);
      assert.equal(r.error, `Map.size: expected Map, got ${want}`);
    }
  });

  // ★宿主可能传进一个 `new Map([['_type','Some'],...])`——标签存在**条目**里、
  // 不是属性。只用 `v.__type` 读会读不到而放行（实测修复前 Map.size 返回 2）。
  // truffle 侧用 `m.get("_type")`（映射查找）天然覆盖，本引擎必须同时查两处才不分叉。
  it('JS Map 把变体标签放在条目里同样被拒绝', () => {
    const c = compile('Module p.\n\nRule f given m, produce Int:\n  Return Map.size(m).\n', {
      lexicon: EN_US,
    });
    assert.ok(c.success && c.core, 'compile 失败');
    for (const tag of ['_type', '__type'] as const) {
      const out = evaluate(c.core, 'f', {
        m: new Map<string, unknown>([[tag, 'Some'], ['value', 1]]),
      }) as { success: boolean; value?: unknown; error?: string };
      assert.equal(out.success, false, `Map 条目里的 ${tag} 应被拒，实际 ${JSON.stringify(out.value)}`);
      assert.equal(out.error, 'Map.size: expected Map, got Some');
    }
    // 正常 JS Map 不受影响
    const ok = evaluate(c.core, 'f', { m: new Map([['a', 1]]) }) as {
      success: boolean;
      value?: unknown;
    };
    assert.deepEqual({ ok: ok.success, value: ok.value }, { ok: true, value: 1 });
  });

  // 跨引擎 payload 可能带 JVM 形的单下划线 `_type`，同样要拦。
  it('JVM 形 _type 变体同样被拒绝', () => {
    const c = compile('Module p.\n\nRule f given m, produce Int:\n  Return Map.size(m).\n', {
      lexicon: EN_US,
    });
    assert.ok(c.success && c.core, 'compile 失败');
    const out = evaluate(c.core, 'f', { m: { _type: 'None' } }) as {
      success: boolean;
      error?: string;
    };
    assert.equal(out.success, false);
    assert.equal(out.error, 'Map.size: expected Map, got None');
  });

  // List.groupBy 内部构造 GuestMap，其结果会喂给 Map.size/keys/values。
  // 守卫若把内部形态也拒了，这条链会整个断掉。
  it('List.groupBy 产出的 Map 可被 Map.* 消费', () => {
    const c = compile(
      'Module p.\n\nRule keyf given x as Int, produce Int:\n  Return x modulo 2.\n\n' +
        'Rule f produce Int:\n  Return Map.size(List.groupBy(List.range(0, 6), keyf)).\n',
      { lexicon: EN_US },
    );
    assert.ok(c.success && c.core, 'compile 失败');
    const out = evaluate(c.core, 'f', {}) as { success: boolean; value?: unknown };
    assert.deepEqual({ ok: out.success, value: out.value }, { ok: true, value: 2 });
  });
});
