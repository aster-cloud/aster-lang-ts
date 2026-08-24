import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';

// Maybe.isNone / Option.isNone 的语义：「**是** None」而非「不是 Some」（#131）。
//
// 旧写法 `?.__type !== 'Some'` 会把任意非 Maybe 输入也判成 None：
//   Maybe.isNone(42) → true，而 JVM 侧（`"None".equals(m.get("_type"))`）→ false
//
// ★核查方法：36 格矩阵（6 个谓词 × 6 种输入）两引擎逐格实跑对比。
// 结果：仅 isNone / Option.isNone 的 Ok/Err/Int/Text 四格分叉（共 8 格），
// isSome / Result.isOk / Result.isErr 全部对齐。
// JVM 那侧是对的——isNone 不该对 `Ok(1)`、`42` 返回 true。
//
// ★为什么 isSome 没有同类问题：它写的是 `=== 'Some'`（正向判定），
// 天然对非 Maybe 返回 false。是 isNone 用了取反才引入这个洞——
// 这也是我在 #128 的核查表里把 isSome/isNone 合并成一行、从而漏判的根源。

initializeAllBundledLexicons();

/** 用 If 取布尔谓词的结果：真→1、假→0。 */
function predicate(expr: string): number {
  const c = compile(
    `Module p.\n\nRule f produce Int:\n  If ${expr}:\n    Return 1.\n  Return 0.\n`,
    { lexicon: EN_US },
  );
  assert.ok(c.success && c.core, `compile 失败: ${JSON.stringify(c.parseErrors ?? [])}`);
  const out = evaluate(c.core, 'f', {}) as { success: boolean; value?: unknown };
  assert.ok(out.success, 'evaluate 失败');
  return out.value as number;
}

describe('Maybe.isNone 语义：是 None，而非"不是 Some"', () => {
  for (const fn of ['Maybe.isNone', 'Option.isNone'] as const) {
    it(`${fn} 对非 Maybe 输入返回 false（与 JVM 一致）`, () => {
      // 这四格是修复前与 JVM 分叉的位置：旧实现全部返回 true。
      for (const arg of ['Ok(1)', 'Err(1)', '42', '"a"']) {
        assert.equal(predicate(`${fn}(${arg})`), 0, `${fn}(${arg}) 应为 false`);
      }
    });

    it(`${fn} 对 None 返回 true、对 Some 返回 false`, () => {
      assert.equal(predicate(`${fn}(None)`), 1);
      assert.equal(predicate(`${fn}(Some(1))`), 0);
    });
  }

  // ★两种 None 表示都要认：`None` 字面量是裸 null，Maybe.map 等返回 {__type:'None'}。
  // 只认后者会让 `Maybe.isNone(None)` 变 false——这是修复时最容易踩的坑。
  it('None 的两种运行期表示都判为 true', () => {
    assert.equal(predicate('Maybe.isNone(None)'), 1, '裸 null 形');
    // Maybe.map(None, f) 返回 {__type:'None'}
    assert.equal(predicate('Maybe.isNone(Maybe.map(None, Maybe.unwrap))'), 1, '带标签形');
  });

  it('与 Map.get 的组合（ADR 0035 起 Map.get 返回 Maybe）', () => {
    const missing = compile(
      'Module p.\n\nRule f produce Int:\n  Let m be Map.empty().\n' +
        '  If Maybe.isNone(Map.get(m, "k")):\n    Return 1.\n  Return 0.\n',
      { lexicon: EN_US },
    );
    assert.ok(missing.success && missing.core);
    assert.equal((evaluate(missing.core, 'f', {}) as { value?: unknown }).value, 1, '缺键应为 None');

    const hit = compile(
      'Module p.\n\nRule f produce Int:\n  Let m be Map.put(Map.empty(), "k", 5).\n' +
        '  If Maybe.isNone(Map.get(m, "k")):\n    Return 1.\n  Return 0.\n',
      { lexicon: EN_US },
    );
    assert.ok(hit.success && hit.core);
    assert.equal((evaluate(hit.core, 'f', {}) as { value?: unknown }).value, 0, '命中不应为 None');
  });

  // isSome 是正向判定（`=== 'Some'`），本就没有这个洞；锁住它以防有人"顺手对称化"
  // 而把 isSome 也改成取反、反向引入同一个缺陷。
  it('isSome 保持正向判定：对非 Maybe 返回 false', () => {
    for (const arg of ['Ok(1)', 'Err(1)', '42', '"a"', 'None']) {
      assert.equal(predicate(`Maybe.isSome(${arg})`), 0, `Maybe.isSome(${arg}) 应为 false`);
    }
    assert.equal(predicate('Maybe.isSome(Some(1))'), 1);
  });

  // Result 侧两个谓词矩阵实测已对齐，锁住现状防回退。
  it('Result.isOk / isErr 对非 Result 输入返回 false', () => {
    for (const arg of ['None', 'Some(1)', '42', '"a"']) {
      assert.equal(predicate(`Result.isOk(${arg})`), 0, `Result.isOk(${arg})`);
      assert.equal(predicate(`Result.isErr(${arg})`), 0, `Result.isErr(${arg})`);
    }
    assert.equal(predicate('Result.isOk(Ok(1))'), 1);
    assert.equal(predicate('Result.isErr(Err(1))'), 1);
  });
});
