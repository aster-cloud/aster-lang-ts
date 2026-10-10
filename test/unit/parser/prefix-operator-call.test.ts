/**
 * 前缀运算符调用 `<op>(a, b)`：与 Java AsterParser.operatorCall 对齐。
 * 降为与中缀写法相同的 Call(Name(规范符号), [a, b])，`=` 与中缀一样规范为 `==`；恰好 2 个参数。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import type { Core } from '../../../src/types.js';

function toCore(source: string): Core.Module {
  const result = parse(lex(canonicalize(source)));
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => `${d.code} ${d.message}`).join('\n'));
  return lowerModule(result.ast);
}

function stripOrigins(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigins);
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k !== 'origin') out[k] = stripOrigins(v);
  }
  return out;
}

function ruleReturning(expr: string, ret: string): string {
  return `Module m.\n\nRule r given x as Int, y as Int, produce ${ret}:\n  Return ${expr}.\n`;
}

// [前缀运算符, 等价中缀写法, 返回类型]
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['<', 'x < y', 'Bool'],
  ['>', 'x > y', 'Bool'],
  ['<=', 'x <= y', 'Bool'],
  ['>=', 'x >= y', 'Bool'],
  ['!=', 'x != y', 'Bool'],
  ['==', 'x == y', 'Bool'],
  ['=', 'x = y', 'Bool'],
  ['+', 'x + y', 'Int'],
  ['-', 'x - y', 'Int'],
  ['*', 'x * y', 'Int'],
  ['/', 'x / y', 'Int'],
];

describe('前缀运算符调用', () => {
  for (const [op, infix, ret] of CASES) {
    test(`${op}(x, y) 与 ${infix} 的 Core IR 相同`, () => {
      const prefix = toCore(ruleReturning(`${op}(x, y)`, ret));
      assert.deepEqual(stripOrigins(prefix), stripOrigins(toCore(ruleReturning(infix, ret))));
      assert.deepEqual(typecheckModule(prefix).filter((d) => d.severity === 'error'), []);
    });
  }

  test('= 规范为 ==', () => {
    const func = toCore(ruleReturning('=(x, y)', 'Bool')).decls[0] as Core.Func;
    const ret = func.body.statements[0] as Core.Return;
    assert.equal(((ret.expr as Core.Call).target as Core.Name).name, '==');
  });

  test('实参可为任意表达式，且前缀调用可作中缀操作数', () => {
    assert.deepEqual(
      stripOrigins(toCore(ruleReturning('>=(x plus 1, y) and =(x, 2)', 'Bool'))),
      stripOrigins(toCore(ruleReturning('x plus 1 at least y and x = 2', 'Bool'))));
  });

  test('参数个数不是 2 时报错（与 Java 同一消息）', () => {
    assert.throws(() => toCore(ruleReturning('+(x, y, x)', 'Int')), /前缀操作符调用需要 2 个参数，但实际为 3/);
    assert.throws(() => toCore(ruleReturning('>=(x)', 'Bool')), /前缀操作符调用需要 2 个参数，但实际为 1/);
  });
});
