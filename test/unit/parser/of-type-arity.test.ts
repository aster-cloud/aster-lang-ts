/**
 * `X of` 的元数按名字确定（aster-lang-core#256）：list / option 恰一个参数，result 一个成功类型加可选的失败类型
 * （缺省 Text），其余泛型不限；`and` 归最内层还能接参数的那个。
 *
 * ts 一直是这个语义；core 此前一律按可变参数贪婪匹配，`result of list of Int and Text` 的 Text 被内层 list
 * 吞掉后丢弃。core 已改成同一语义，这里把 ts 侧的行为锁住，两端由 aster-lang-test 的 tier1 样本
 * `tier1-parity/types/of-type-arity*.aster` 在 Core IR 上逐字节比对。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import type { Func, Type } from '../../../src/types.js';

/** 形参表渲染为 `x: Result(List(Int), Text); y: Text`，与 core OfTypeArityTest 的写法一致。 */
function paramsOf(params: string): string {
  const source = `Module m.\n\nRule f given ${params}, produce Int:\n  Return 1.\n`;
  const r = parse(lex(canonicalize(source)));
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), [], params);
  const f = r.ast.decls.find((d) => d.kind === 'Func') as Func;
  return f.params.map((p) => `${p.name}: ${show(p.type!)}`).join('; ');
}

function show(t: Type): string {
  switch (t.kind) {
    case 'TypeName': return t.name;
    case 'List': return `List(${show(t.type)})`;
    case 'Option': return `Option(${show(t.type)})`;
    case 'Maybe': return `Maybe(${show(t.type)})`;
    case 'Result': return `Result(${show(t.ok)}, ${show(t.err)})`;
    case 'Map': return `Map(${show(t.key)}, ${show(t.val)})`;
    default: return t.kind;
  }
}

describe('X of 的元数（core#256）', () => {
  const cases: Array<[string, string]> = [
    ['x as result of list of Int and Text', 'x: Result(List(Int), Text)'],
    ['x as result of option of Int and Text', 'x: Result(Option(Int), Text)'],
    ['x as result of Int and list of Text', 'x: Result(Int, List(Text))'],
    ['x as result of result of Int and Text and Bool', 'x: Result(Result(Int, Text), Bool)'],
    ['x as Result of Int and Text', 'x: Result(Int, Text)'],
    ['x as result of Int', 'x: Result(Int, Text)'],
    ['x as option of Int', 'x: Option(Int)'],
    ['x as List of Int', 'x: List(Int)'],
    ['x as list of Int?', 'x: List(Maybe(Int))'],
    ['x as Map Text to list of Int', 'x: Map(Text, List(Int))'],
    ['x as Map list of Int to Text', 'x: Map(List(Int), Text)'],
    ['x as list of Int and y as Text', 'x: List(Int); y: Text'],
    ['x as option of Int and y as Text', 'x: Option(Int); y: Text'],
  ];
  for (const [params, expected] of cases) {
    it(params, () => assert.equal(paramsOf(params), expected));
  }
});
