import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// `is equal to` 必须是**结构相等**，与 truffle 的 eq 回退路径（Objects.equals）
// 以及本仓 List.contains/distinct（valueEquals）保持同一口径。
//
// ★背景：此前 TS 用 `left === right`（引用相等），于是
//   - 两个字段完全相同的结构体 → false，而 Java 判 true（**双引擎分叉**）
//   - 同一对值 List.contains 判相等、`=` 判不等（**TS 内部不自洽**）
// 等价性语料的 18-comparison-is-equal 只喂标量，故长期未被拓到。
function evalBool(body: string, ctx: Record<string, unknown> = { a: 1 }): boolean | string {
  const c = compile(`Module probe.\n${body}\n`);
  if (!c.core) return 'compile failed';
  const ev = evaluate(c.core, 'r', ctx);
  return ev.success ? (ev.value as boolean) : `ERR ${ev.error}`;
}

describe('is equal to 使用结构相等（双引擎对齐）', () => {
  it('字段相同的两个结构体相等', () =>
    assert.equal(evalBool(
      'Define P has x as Int.\n\nRule r given a as Int, produce Bool:\n'
      + '  Let p1 be P with x set to 1.\n  Let p2 be P with x set to 1.\n'
      + '  Return p1 is equal to p2.'), true));

  it('字段不同的结构体不相等', () =>
    assert.equal(evalBool(
      'Define P has x as Int.\n\nRule r given a as Int, produce Bool:\n'
      + '  Let p1 be P with x set to 1.\n  Let p2 be P with x set to 2.\n'
      + '  Return p1 is equal to p2.'), false));

  it('内容相同的两个列表相等', () =>
    assert.equal(evalBool(
      'Rule r given a as Int, produce Bool:\n  Return List.range(1,3) is equal to List.range(1,3).'), true));

  it('内容不同的列表不相等', () =>
    assert.equal(evalBool(
      'Rule r given a as Int, produce Bool:\n  Return List.range(1,3) is equal to List.range(1,4).'), false));

  // ★与 List.contains 同口径——这条锁住「内部自洽」，是本次修复的核心动机之一。
  it('= 与 List.contains 对同一对值给出一致答案', () => {
    const body = (op: string) =>
      'Define P has x as Int.\n\nRule r given a as Int, produce Bool:\n'
      + '  Let p1 be P with x set to 7.\n  Let p2 be P with x set to 7.\n'
      + `  Return ${op}.`;
    assert.equal(evalBool(body('p1 is equal to p2')),
      evalBool(body('List.contains(List.append(List.empty(), p1), p2)')),
      '★两条路径必须给出同一答案，否则规则作者会看到自相矛盾的结果');
  });

  // 标量/文本不得被改动波及（valueEquals 首行 x === y 短路）
  it('标量与文本行为不变', () => {
    assert.equal(evalBool('Rule r given a as Int, produce Bool:\n  Return 5 is equal to 5.'), true);
    assert.equal(evalBool('Rule r given a as Int, produce Bool:\n  Return 5 is equal to 6.'), false);
    assert.equal(evalBool('Rule r given a as Int, produce Bool:\n  Return "x" is equal to "x".'), true);
    assert.equal(evalBool('Rule r given a as Int, produce Bool:\n  Return "x" is not equal to "y".'), true);
  });
});
