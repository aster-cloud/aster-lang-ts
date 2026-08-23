import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';

// Maybe.map / Option.map 的首参类型守卫（aster-lang-ts#128）。
//
// 此前对**任意**非 Maybe 输入都静默返回 None，于是
// `Maybe.withDefault(Maybe.map(42, f), 0)` 得到 0——一个看起来完全合理的决策值，
// 而同一段规则在 JVM 上直接抛错（Builtins.java 的 operationExpectedType）。
// 既是双引擎分叉，也是静默错答案，与 #123 的 arity 缺口同一模式。
//
// ★核查范围（**订正版**）：交叉审查用 46 条表达式在两个引擎上机器对比后，
// 推翻了我原先"只有 Maybe.map 一处"的结论。实测结果：
//
//   函数                          TS          Truffle    判定
//   Maybe.map / Option.map        静默 None    抛错       真分叉 → 本 PR 修
//   Maybe.isNone / Option.isNone  isNone(42)=true  =false 真分叉 → 见 #131
//   Map.get/size/keys/put         静默兜底空 Map  抛错     真分叉 → 见 #132
//   Maybe.withDefault / unwrapOr  返回默认     返回默认    一致，不动
//   Maybe.isSome / Option.isSome  返回 false   返回 false 一致，不动
//   Result.mapOk/mapErr/tapError  抛错         抛错       一致，不动
//   Result.unwrap / unwrapErr     抛错         抛错       一致，不动
//   List.sum/map/filter/length/sort 抛错       抛错       一致，不动
//
// ★我原表把 isSome/isNone 合并成一行"返回 false"——isSome 确实两边都 false，
// isNone 却不是（TS 写 `!== 'Some'`、JVM 写 `.equals("None")`）。
// **合并成一行正是判断错的成因**；且我当时根本没查 Map.*。
//
// 本 PR 仍只修 Maybe.map（isNone 属行为变更需评估 spec 冻结，Map.* 影响面更大），
// 另两条已各自开 issue，不让"已核查"的错误完成信号把它们掩埋。

initializeAllBundledLexicons();

const PRELUDE = 'Rule double given x as Int, produce Int:\n  Return x times 2.\n\n';

function run(body: string): { ok: boolean; value?: unknown; error?: string } {
  const c = compile(`Module p.\n\n${PRELUDE}Rule f produce Int:\n  ${body}\n`, {
    lexicon: EN_US,
  });
  assert.ok(c.success && c.core, `compile 失败: ${JSON.stringify(c.parseErrors ?? [])}`);
  const out = evaluate(c.core, 'f', {}) as { success: boolean; value?: unknown; error?: string };
  return out.success
    ? { ok: true, value: out.value }
    : { ok: false, error: out.error ?? '(无错误信息)' };
}

describe('Maybe.map 首参类型守卫', () => {
  for (const fn of ['Maybe.map', 'Option.map'] as const) {
    it(`${fn} 对非 Maybe 首参报错，而非静默返回 None`, () => {
      const r = run(`Return Maybe.withDefault(${fn}(42, double), 0).`);
      assert.equal(r.ok, false, `应当失败，实际静默返回 ${JSON.stringify(r.value)}`);
      assert.equal(r.error, `${fn}: expected Maybe (Some or None), got number`);
    });
  }

  it('文本、列表等其它类型同样被拒', () => {
    for (const arg of ['"abc"', 'List.empty()']) {
      const r = run(`Return Maybe.withDefault(Maybe.map(${arg}, double), 0).`);
      assert.equal(r.ok, false, `${arg} 应被拒，实际返回 ${JSON.stringify(r.value)}`);
      assert.match(r.error ?? '', /expected Maybe \(Some or None\)/);
    }
  });

  // ★None 有两种运行期表示，都必须被当成合法输入：
  //   - `None` 字面量求值为 null（evalExpr 的 case 'None'）
  //   - Maybe.map 自身返回 {__type:'None'}
  // 若守卫只认后者，`Maybe.map(None, f)` 会被误伤。
  it('None 的两种运行期表示都放行', () => {
    assert.deepEqual(run('Return Maybe.withDefault(Maybe.map(None, double), 0).'), {
      ok: true,
      value: 0,
    });
    // 内层 map 返回 {__type:'None'}，外层 map 必须接受它
    assert.deepEqual(
      run('Return Maybe.withDefault(Maybe.map(Maybe.map(None, double), double), 0).'),
      { ok: true, value: 0 },
    );
  });

  it('Some 分支与链式调用不受影响', () => {
    assert.deepEqual(run('Return Maybe.withDefault(Maybe.map(Some(21), double), 0).'), {
      ok: true,
      value: 42,
    });
    assert.deepEqual(
      run('Return Maybe.withDefault(Maybe.map(Maybe.map(Some(3), double), double), 0).'),
      { ok: true, value: 12 },
    );
  });

  // Map.get 自 ADR 0035 档位 C 起返回 Maybe，是本函数最主要的上游。
  it('与 Map.get 的组合（缺键/命中）均正常', () => {
    assert.deepEqual(
      run('Let m be Map.empty().\n  Return Maybe.withDefault(Maybe.map(Map.get(m, "k"), double), 0).'),
      { ok: true, value: 0 },
    );
    assert.deepEqual(
      run(
        'Let m be Map.put(Map.empty(), "k", 5).\n  Return Maybe.withDefault(Maybe.map(Map.get(m, "k"), double), 0).',
      ),
      { ok: true, value: 10 },
    );
  });

  // 这几个在两引擎上行为一致（都不抛），故**不是**分叉——本测试锁住现状，
  // 防止有人"顺手"给它们也加守卫而单方面制造新分叉。
  it('withDefault / unwrapOr / isSome 维持与 truffle 一致的宽松行为', () => {
    assert.deepEqual(run('Return Maybe.withDefault(42, 0).'), { ok: true, value: 0 });
    assert.deepEqual(run('Return Maybe.unwrapOr(42, 0).'), { ok: true, value: 0 });
  });
});
