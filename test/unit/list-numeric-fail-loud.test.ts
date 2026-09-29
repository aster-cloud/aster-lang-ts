import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// List.sum/min/max/sort/sortBy/minBy/maxBy 对非数值元素必须**响亮失败**，
// 与 truffle `Builtins.toDouble`（`Double.parseDouble` 抛 NumberFormatException）对齐。
//
// ★修复前（issue #193）：这七个 builtin 直接 `Number(x)`，`Number("2o")` 得 NaN 后
//   sum 静默产出 NaN、max/min 因 `NaN > x` 恒假静默返回首元素、sort 顺序未定义——
//   规则跑通了、结果是错的，且与 Java 侧一个响亮失败一个静默错答案。
function run(expr: string, ret = 'Int', rules = '') {
  const c = compile(`Module probe.\n${rules}Rule r given a as Int, produce ${ret}:\n  Return ${expr}.\n`);
  if (!c.core) return { ok: false, value: undefined, error: 'compile failed' };
  const ev = evaluate(c.core, 'r', { a: 1 });
  return { ok: ev.success, value: ev.value, error: String(ev.error ?? '') };
}

const ID_RULE = 'Rule id given x, produce:\n  Return x.\n';

describe('List 数值 builtin 对非数值元素响亮失败（与 truffle toDouble 对齐）', () => {
  const cases: Array<[string, string, string]> = [
    ['List.sum', 'List.sum(["10", "2o"])', 'Int'],
    ['List.min', 'List.min(["x", "y"])', 'Text'],
    ['List.max', 'List.max(["x", "y"])', 'Text'],
    ['List.sort', 'List.get(List.sort(["1", "b"]), 0)', 'Text'],
    ['List.sum 空串', 'List.sum([""])', 'Int'],
    ['List.sum 字符串 NaN', 'List.sum(["NaN"])', 'Int'],
    ['List.sum 字符串 Infinity', 'List.sum(["Infinity"])', 'Int'],
    ['List.sum 十六进制', 'List.sum(["0x10"])', 'Int'],
    ['List.sum 布尔', 'List.sum([true])', 'Int'],
  ];
  for (const [name, expr, ret] of cases) {
    it(`${name} 非数值元素必须报错，而不是静默给答案`, () => {
      const r = run(expr, ret);
      assert.equal(r.ok, false, `★${name} 静默返回了 ${JSON.stringify(r.value)}——静默错答案比报错危险`);
      assert.match(r.error, /expected Number/i);
    });
  }

  const keyed: Array<[string, string, string]> = [
    ['List.sortBy', 'List.get(List.sortBy(["1", "b"], id), 0)', 'Text'],
    ['List.minBy', 'List.minBy(["x", "y"], id)', 'Text'],
    ['List.maxBy', 'List.maxBy(["x", "y"], id)', 'Text'],
  ];
  for (const [name, expr, ret] of keyed) {
    it(`${name} 键函数返回非数值必须报错`, () => {
      const r = run(expr, ret, ID_RULE);
      assert.equal(r.ok, false, `★${name} 静默返回了 ${JSON.stringify(r.value)}`);
      assert.match(r.error, /expected Number/i);
    });
  }

  // 反向保险：合法数值（含可解析的字符串、前后空白）不得被误伤
  it('数值列表照常工作', () => {
    assert.equal(run('List.sum([3, 8, 1, 9])').value, 21);
    assert.equal(run('List.max([3, 8, 1, 9])').value, 9);
    assert.equal(run('List.min([3, 8, 1, 9])').value, 1);
    assert.equal(run('List.get(List.sort([3, 8, 1]), 0)').value, 1);
    assert.equal(run('List.maxBy([3, 8, 1], id)', 'Int', ID_RULE).value, 8);
  });

  it('可解析的数值字符串（含前后空白、小数、科学计数）照常换算', () => {
    assert.equal(run('List.sum(["10", " 2 ", "1.5", "1e1"])', 'Decimal').value, 23.5);
    assert.equal(run('List.max(["10", "9"])', 'Text').value, '10');
  });
});
