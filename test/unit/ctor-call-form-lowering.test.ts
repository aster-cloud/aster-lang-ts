import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';

// 内置变体调用形式的降级归一（aster-lang-ts#124）。
//
// `Some(x)` / `Ok(x)` / `Err(x)` / `None()` 与关键字形式 `some of x` 必须降到
// **完全相同**的 Core IR 节点。此前只有关键字形式产出 Expr.Some，调用形式一路
// 保留成 Call{Name 'Some'}，靠解释器在求值期特判兜底——单跑 TS 没问题，但把
// 这样的 IR 交给 JVM 引擎就炸（truffle 期望独立 Some 节点，只认 Call 会报
// `Unknown call target: Some`）。即两引擎各自都"能跑"，唯独跨引擎喂 IR 不通。
//
// Java 侧在 parse 期就归一（AstBuilder 对 Ok/Err/Some/None 调用形式特判），
// 故其 IR 里始终是独立节点。本次在 lower 期补上同一步。
//
// 跨引擎那一半由 aster-lang-truffle 的 StdlibHofProbeTest#ctorCallFormCrossEngine
// 锁住（fixture 由本引擎产出，JVM 执行得 42）。

initializeAllBundledLexicons();

/** 编译并返回 Core IR（去掉 origin，便于比较两种写法是否等价）。 */
function ir(body: string): string {
  const c = compile(`Module p.\n\n${body}\n`, { lexicon: EN_US });
  assert.ok(c.success && c.core, `compile 失败: ${JSON.stringify(c.parseErrors ?? [])}`);
  return JSON.stringify(c.core, (k, v) => (k === 'origin' ? undefined : v));
}

/** 编译并求值。 */
function run(body: string, fn = 'f'): unknown {
  const c = compile(`Module p.\n\n${body}\n`, { lexicon: EN_US });
  assert.ok(c.success && c.core, `compile 失败: ${JSON.stringify(c.parseErrors ?? [])}`);
  const out = evaluate(c.core, fn, {}) as { success: boolean; value?: unknown; error?: string };
  assert.ok(out.success, `求值失败: ${out.error}`);
  return out.value;
}

describe('内置变体调用形式降级归一', () => {
  // 核心不变式：调用形式与关键字形式产出**逐字节相同**的 IR。
  // 这正是 ADR 0027「等价 fn(arg)」不变式对内置变体的要求。
  it('Some(x) 与 some of x 产出相同 IR', () => {
    assert.equal(
      ir('Rule f produce Int:\n  Return Maybe.withDefault(Some(21), 0).'),
      ir('Rule f produce Int:\n  Return Maybe.withDefault(Some of 21, 0).'),
    );
  });

  it('Ok(x) 与 ok of x 产出相同 IR', () => {
    assert.equal(
      ir('Rule f produce Int:\n  Return Result.unwrap(Ok(5)).'),
      ir('Rule f produce Int:\n  Return Result.unwrap(Ok of 5).'),
    );
  });

  it('Err(x) 与 err of x 产出相同 IR', () => {
    assert.equal(
      ir('Rule f produce Int:\n  Return Result.unwrapErr(Err(7)).'),
      ir('Rule f produce Int:\n  Return Result.unwrapErr(Err of 7).'),
    );
  });

  // ★这几条是跨引擎可移植性的直接判据：IR 里必须是独立节点而非 Call。
  // 只断言"求值结果对"锁不住——修复前求值同样是对的（解释器特判兜底），
  // 炸的是把 IR 交给 JVM 的时候。
  it('调用形式在 IR 里产出独立节点而非 Call', () => {
    for (const [expr, kind] of [
      ['Maybe.withDefault(Some(1), 0)', 'Some'],
      ['Result.unwrap(Ok(1))', 'Ok'],
      ['Result.unwrapErr(Err(1))', 'Err'],
    ] as const) {
      const json = ir(`Rule f produce Int:\n  Return ${expr}.`);
      assert.match(json, new RegExp(`"kind":"${kind}"`), `${expr} 应产出独立 ${kind} 节点`);
      assert.doesNotMatch(
        json,
        new RegExp(`"kind":"Call","target":\\{"kind":"Name","name":"${kind}"`),
        `${expr} 不应残留 Call{Name '${kind}'}——那种 IR 在 JVM 引擎上会报 Unknown call target`,
      );
    }
  });

  it('语义不变：两种写法求值结果一致', () => {
    assert.equal(run('Rule f produce Int:\n  Return Maybe.withDefault(Some(21), 0).'), 21);
    assert.equal(run('Rule f produce Int:\n  Return Maybe.withDefault(Some of 21, 0).'), 21);
    assert.equal(run('Rule f produce Int:\n  Return Result.unwrap(Ok(5)).'), 5);
    assert.equal(run('Rule f produce Int:\n  Return Maybe.withDefault(None, 0).'), 0);
  });

  // 归一只在 arity 匹配时生效（Some/Ok/Err 恰 1 参、None 恰 0 参），
  // 与 Java AstBuilder 的特判条件一致；不匹配的仍降级为普通 Call，
  // 交由后续「未定义函数」逻辑处理，而不是被硬塞成内置变体。
  //
  // 注：这里不能用「用户自定义同名规则」来测——`Some` 是关键字，
  // `Rule Some ...` 在 parser 阶段就报 Expected identifier，走不到降级。
  it('不误伤：arity 不匹配时仍降级为普通 Call', () => {
    for (const expr of ['Some(1, 2)', 'Some()']) {
      const json = ir(`Rule f produce Int:\n  Return ${expr}.`);
      assert.match(
        json,
        /"kind":"Call","target":\{"kind":"Name","name":"Some"/,
        `${expr} 的 arity 与内置变体不符，应保留成普通 Call`,
      );
      assert.doesNotMatch(json, /"kind":"Some"/, `${expr} 不应被归一成 Some 节点`);
    }
  });
});
