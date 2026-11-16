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
    case 'TypeApp': return `${t.base}(${t.args.map(show).join(', ')})`;
    case 'FuncType': return `Func(${t.params.map(show).join(', ')} -> ${show(t.ret)})`;
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

/**
 * `X of` 的参数与下一个形参 / 字段的边界（parity 清扫 1.0.48，裁决见 aster-lang-test#174 跟进 PR）：
 * 分隔符（`and` / `,`）之后若是「名字 as」，分隔符属于外层（下一个形参 / 字段），否则在元数允许时属于类型参数。
 * 与 core 文法 ofTypeArgs 一致——core 用 LL 前瞻在「名字 as」处退出循环，ts 此前贪婪吞掉分隔符后报 E056。
 * `result of A, B` 与 `result of A and B` 同义（core 一直接受逗号，保持既有源码含义不变）。
 */
describe('X of 参数与下一个形参的边界（parity 清扫）', () => {
  const cases: Array<[string, string]> = [
    ['x as Pair of Int, y as Text', 'x: Pair(Int); y: Text'],
    ['x as Pair of Int and y as Text', 'x: Pair(Int); y: Text'],
    ['x as Pair of Int, Text', 'x: Pair(Int, Text)'],
    ['x as Pair of Int and Text, y as Text', 'x: Pair(Int, Text); y: Text'],
    ['x as result of Int and y as Text', 'x: Result(Int, Text); y: Text'],
    ['x as result of Int, y as Text', 'x: Result(Int, Text); y: Text'],
    ['x as result of Int, Text', 'x: Result(Int, Text)'],
    ['x as result of Int, list of Text', 'x: Result(Int, List(Text))'],
    ['x as result of Int, Text and y as Text', 'x: Result(Int, Text); y: Text'],
    ['x as Pair of result of Int, Text', 'x: Pair(Result(Int, Text))'],
    ['x as Pair of result of Int and Text, Bool', 'x: Pair(Result(Int, Text), Bool)'],
    ['g as (list of Int, Text) -> Bool', 'g: Func(List(Int), Text -> Bool)'],
    ['g as (result of Int and Text) -> Bool', 'g: Func(Result(Int, Text) -> Bool)'],
    ['g as ((Pair of Int), Text) -> Bool', 'g: Func(Pair(Int), Text -> Bool)'],
  ];
  for (const [params, expected] of cases) {
    it(params, () => assert.equal(paramsOf(params), expected));
  }

  it('返回类型里的 `result of A, B`', () => {
    const r = parse(lex(canonicalize('Module m.\n\nRule f given x as Int, produce result of Int, Text:\n  Return ok of x.\n')));
    assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
    const f = r.ast.decls.find((d) => d.kind === 'Func') as Func;
    assert.equal(show(f.retType), 'Result(Int, Text)');
  });

  it('字段表里的 `Pair of Int, y as Text`', () => {
    const r = parse(lex(canonicalize('Module m.\n\nDefine Box has p as Pair of Int, q as Text.\n')));
    assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
    const box = r.ast.decls.find((d) => d.kind === 'Data');
    assert.ok(box && box.kind === 'Data');
    assert.equal(box.fields.map((f) => `${f.name}: ${show(f.type)}`).join('; '), 'p: Pair(Int); q: Text');
  });

  // 括号类型表里，`X of A, B` 的逗号既可以是 X 的下一个参数，也可以是类型表的下一项：真歧义，两引擎都报 E064
  // （写成 `X of A and B`，或把 X 包进括号 `(X of A), B`）。元数已满的 X（list / option / 已有失败类型的 result）不歧义。
  for (const params of [
    'g as (result of Int, Text) -> Bool',
    'g as (Pair of Int, Text) -> Bool',
    'g as (Map Text to Pair of Int, Text) -> Bool',
    'g as ((Int) -> Pair of Int, Text) -> Bool',
  ]) {
    it(`歧义逗号报 E064：${params}`, () => {
      const source = `Module m.\n\nRule f given ${params}, produce Int:\n  Return 1.\n`;
      const errors = parse(lex(canonicalize(source))).diagnostics.filter((d) => d.severity === 'error');
      assert.equal(errors[0]?.code, 'E064', JSON.stringify(errors));
      assert.equal(errors[0]?.span?.start.line, 3);
    });
  }
});
