import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// List.* 对非列表输入必须**响亮失败**，与 truffle 对齐。
//
// ★发现经过：验证「档位 C 之后档位 B 还有没有必要」时，逐个试了 B 原本要拦的
// 四种「未处理 null 就使用」，发现前三种都已响亮失败，唯独
// `List.length(Map.get(...))` **静默返回 0**。
//
// 进一步查证发现这不只是 null 问题：`List.length(Some([1,2,3]))` 也返回 0
// —— 命中的非空列表被报成空。根因是这五个 builtin 对**任何**非列表输入
// 静默返回 0/true/null/false/[x]，而 Java 侧一律 throw。
// 既是双引擎分叉，也是静默错答案：规则跑通了、结果是错的。
function run(expr: string, ret = 'Int') {
  const c = compile(`Module probe.\nRule r given a as Int, produce ${ret}:\n  Return ${expr}.\n`);
  if (!c.core) return { ok: false, value: undefined, error: 'compile failed' };
  const ev = evaluate(c.core, 'r', { a: 1 });
  return { ok: ev.success, value: ev.value, error: String(ev.error ?? '') };
}

describe('List.* 对非列表输入响亮失败（与 truffle 对齐）', () => {
  const cases: Array<[string, string, string]> = [
    ['List.length', 'List.length("x")', 'Int'],
    ['List.isEmpty', 'List.isEmpty("x")', 'Bool'],
    ['List.get', 'List.get("x", 0)', 'Int'],
    ['List.contains', 'List.contains("x", 1)', 'Bool'],
    ['List.append', 'List.length(List.append("x", 1))', 'Int'],
  ];
  for (const [name, expr, ret] of cases) {
    it(`${name} 非列表输入必须报错，而不是静默给答案`, () => {
      const r = run(expr, ret);
      assert.equal(r.ok, false, `★${name} 静默返回了 ${JSON.stringify(r.value)}——静默错答案比报错危险`);
      assert.match(r.error, /expected List/i);
    });
  }

  // ★真实触发场景（本次的发现入口）：Map.get 返回 Maybe 后，
  //   忘记解包就传给 List.length，此前会把「命中的非空列表」报成空。
  it('Map.get 结果未解包就传给 List.length → 报错（此前静默返回 0）', () => {
    const r = run('List.length(Map.get(Map.put(Map.empty(),"k",List.range(1,4)), "k"))');
    assert.equal(r.ok, false, '★Some([1,2,3]) 不是列表，必须报错而非返回 0');
  });

  // 反向保险：正常列表不得被误伤
  it('正常列表照常工作', () => {
    assert.equal(run('List.length(List.range(1,4))').value, 3);
    assert.equal(run('List.isEmpty(List.empty())', 'Bool').value, true);
    assert.equal(run('List.length(List.append(List.empty(), 1))').value, 1);
  });

  // 正确写法必须可用
  it('withDefault 解包后正常', () =>
    assert.equal(run('List.length(Maybe.withDefault(Map.get(Map.put(Map.empty(),"k",List.range(1,4)),"k"), List.empty()))').value, 3));
});
