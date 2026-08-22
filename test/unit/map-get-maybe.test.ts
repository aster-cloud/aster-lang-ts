import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// Map.get 返回 Maybe（ADR 0035 档位 C）。
//
// ★这是对 Stable 集的**语义变更**，明知破坏 spec-1.0-freeze 的
// 「Stable 1.x 内语义不变」承诺，由用户拍板接受。
//
// 动机：此前 `Map.get(m,k) plus 1` 能**编译通过、运行才炸** ——
// 对合规决策引擎，「规则写出来、审批过了、上线后才在某条特定输入上炸」
// 是最该消灭的一类。返回 Maybe 让「键可能不存在」在代码里显式可见。
function run(body: string, ctx: Record<string, unknown> = { a: 1 }) {
  const c = compile(`Module probe.\n${body}\n`);
  if (!c.core) return { ok: false, value: undefined, error: 'compile failed' };
  const ev = evaluate(c.core, 'r', ctx);
  return { ok: ev.success, value: ev.value, error: String(ev.error ?? '') };
}

describe('Map.get 返回 Maybe', () => {
  it('命中 → Some(value)', () => {
    const r = run('Rule r given a as Int, produce Int:\n  Return Map.get(Map.put(Map.empty(),"k",7), "k").');
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.value, { __type: 'Some', value: 7 });
  });

  // ★TS 侧 None 的运行期表示**就是 null**（evalExpr 的 case 'None' 返回 null），
  //   故缺键返回 null 即等价于 None —— Maybe.isNone/withDefault 都已认它。
  it('缺键 → None', () => {
    const r = run('Rule r given a as Int, produce Bool:\n  Return Maybe.isNone(Map.get(Map.empty(), "k")).');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.value, true);
  });

  it('withDefault 命中取真值', () =>
    assert.equal(run('Rule r given a as Int, produce Int:\n'
      + '  Return Maybe.withDefault(Map.get(Map.put(Map.empty(),"k",7),"k"), 0).').value, 7));

  it('withDefault 缺键取兜底', () =>
    assert.equal(run('Rule r given a as Int, produce Int:\n'
      + '  Return Maybe.withDefault(Map.get(Map.empty(),"k"), 99).').value, 99));

  // ★本次修复的核心价值：裸算术不再静默给错答案，而是响亮失败。
  it('命中值直接参与算术 → 报错（不再静默错算）', () => {
    const r = run('Rule r given a as Int, produce Int:\n'
      + '  Return Map.get(Map.put(Map.empty(),"k",7),"k") plus 1.');
    assert.equal(r.ok, false, '★Some(7) 不是数字，直接相加必须失败而非静默给出错误答案');
  });

  // ★「键存在但值为 null」与「键不存在」是两件事，不能塌陷。
  it('命中值为 null 时仍是 Some（与缺键区分）', () => {
    const r = run('Rule r given a as Int, produce Bool:\n'
      + '  Let m be Map.put(Map.empty(), "k", None).\n'
      + '  Return Maybe.isSome(Map.get(m, "k")).');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.value, true, '★键存在即 Some，哪怕值本身是 null');
  });
});
