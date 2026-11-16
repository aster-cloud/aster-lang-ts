/**
 * 规则签名与类型别名的双引擎语法边界（aster-lang-ts#328，1.0.48 parity 清扫遗留），与 core SignatureSyntaxParityTest 对应：
 *
 * - 尖括号泛型 `Pair<Int, Text>`：两引擎都在 `<` 上报 E056，正式写法是 `Pair of Int and Text`（core 此前接受）。
 * - 大写形参名 `given Customer as Text`：两引擎都报 E055（core 此前接受；ts 一直拒绝，这里锁住）。
 * - 形参前置注解 `given x as Pair of Int, @pii(L1, email) y as Text`：两引擎都接受，Core IR 的 Param.annotations
 *   与 core 相同（先列前置注解，再列类型最外层的 @pii）。ts 此前报 E056。
 * - `result of A or B`：两引擎都在 `or` 上报 E062（ts 此前接受）；失败类型用 `and` / `,` 引出。
 * - 类型别名关键词大小写不敏感（`Type Amount as Int.`），与 Define / Rule / Use 一致；ts 一直接受，这里锁住。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import type { Core, Func, Module } from '../../../src/types.js';

function parseSrc(source: string): { ast: Module; errors: Array<{ code: string; line: number | undefined; col: number | undefined; params: unknown }> } {
  const r = parse(lex(canonicalize(source)));
  const errors = r.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => ({ code: String(d.code), line: d.span?.start.line, col: d.span?.start.col, params: d.params }));
  return { ast: r.ast, errors };
}

function firstError(source: string): { code: string; line: number | undefined; col: number | undefined; params: unknown } {
  const { errors } = parseSrc(source);
  assert.ok(errors.length > 0, `应报解析错误：${source}`);
  return errors[0]!;
}

describe('尖括号泛型报 E056（aster-lang-ts#328）', () => {
  const cases: Array<[string, number, number]> = [
    ['Rule f given x as Pair<Int, Text>, produce Int:\n  Return 1.', 3, 23],
    ['Rule f given x as Int, produce List<Int>:\n  Return [x].', 3, 36],
    ['Rule f given x as list of Pair<Int>, produce Int:\n  Return 1.', 3, 31],
    ['Rule f given g as (Pair<Int>) -> Bool, produce Int:\n  Return 1.', 3, 24],
    ['Define Box has p as Pair<Int, Text>.', 3, 25],
    ['type Amount as Pair<Int>.', 3, 20],
    ['Rule f given x as pair<Int>, produce Int:\n  Return 1.', 3, 23],
    ['Rule f given x as Int, produce Int:\n  Let g be function given y as Box<Int>, produce Int:\n    Return 1.\n  Return x.', 4, 35],
  ];
  for (const [body, line, col] of cases) {
    it(body.split('\n')[0]!, () => {
      const e = firstError(`Module m.\n\n${body}\n`);
      assert.deepEqual(e, { code: 'E056', line, col, params: { token: "'of'", after: 'token.typeName' } });
    });
  }

  it('`Pair of Int and Text` 是正式写法', () => {
    assert.deepEqual(parseSrc('Module m.\n\nRule f given x as Pair of Int and Text, produce Int:\n  Return 1.\n').errors, []);
  });
});

describe('大写形参名报 E055（aster-lang-ts#328）', () => {
  const cases: Array<[string, number]> = [
    ['given Customer as Text', 14],
    ['given x as Int and Customer as Text', 27],
    ['given x as Int, Customer', 24],
    ['given x as list of Int and Text', 35],
    ['given Text as Int', 14],
  ];
  for (const [params, col] of cases) {
    it(params, () => {
      const e = firstError(`Module m.\n\nRule f ${params}, produce Int:\n  Return 1.\n`);
      assert.deepEqual(e, { code: 'E055', line: 3, col, params: { token: 'token.identifier' } });
    });
  }

  it('lambda 形参同样报 E055', () => {
    const e = firstError('Module m.\n\nRule f given x as Int, produce Int:\n  Let g be function given Y as Int, produce Int:\n    Return 1.\n  Return x.\n');
    assert.equal(e.code, 'E055');
    assert.equal(e.line, 4);
  });

  for (const name of ['customer', 'Ölwert', 'राशि']) {
    it(`非 ASCII 大写开头的形参名照常接受：${name}`, () => {
      assert.deepEqual(parseSrc(`Module m.\n\nRule f given ${name} as Text, produce Text:\n  Return ${name}.\n`).errors, []);
    });
  }
});

describe('形参前置注解（aster-lang-ts#328）', () => {
  const SOURCE = [
    'Module m.',
    '',
    'Define Pair has a as Int.',
    '',
    'Rule f given x as Pair of Int, @pii(L1, email) y as Text, produce Text:',
    '  Return y.',
    '',
    'Rule g given @pii(L2, phone) @audit p as Text and q as @pii(L1, email) Text, produce Text:',
    '  Return p.',
    '',
    'Rule h given @tag(name: "k", 3) z, produce Text:',
    '  Let k be function given @seen n as Int required, produce Int:',
    '    Return n.',
    '  Return z.',
    '',
  ].join('\n');

  function coreParams(name: string): readonly Core.Parameter[] {
    const { ast, errors } = parseSrc(SOURCE);
    assert.deepEqual(errors, []);
    const core = lowerModule(ast);
    const f = core.decls.find((d) => d.kind === 'Func' && d.name === name) as Core.Func;
    return f.params;
  }

  it('`Pair of Int,` 后的注解开始下一个形参，AST 记前置注解', () => {
    const { ast } = parseSrc(SOURCE);
    const f = ast.decls.find((d) => d.kind === 'Func' && d.name === 'f') as Func;
    assert.deepEqual(f.params.map((p) => [p.name, p.type.kind, p.annotations]), [
      ['x', 'TypeApp', undefined],
      ['y', 'TypeName', [{ name: 'pii', args: [{ name: '$0', value: 'L1' }, { name: '$1', value: 'email' }] }]],
    ]);
  });

  it('Core IR：前置注解在前，类型最外层的 @pii 在后（与 core AstBuilder.visitParam 一致）', () => {
    assert.deepEqual(coreParams('g').map((p) => [p.name, p.annotations]), [
      ['p', [
        { name: 'pii', args: [{ name: '$0', value: 'L2' }, { name: '$1', value: 'phone' }] },
        { name: 'audit', args: [] },
      ]],
      ['q', [{ name: 'pii', args: [{ name: '$0', value: 'L1' }, { name: '$1', value: 'email' }] }]],
    ]);
  });

  it('命名与位置参数混用、无类型形参', () => {
    const [z] = coreParams('h');
    assert.deepEqual(z!.annotations, [{ name: 'tag', args: [{ name: 'name', value: 'k' }, { name: '$0', value: 3 }] }]);
    assert.equal(z!.typeInferred, true);
  });

  it('lambda 形参的注解与约束都进入 Core IR（与 core lowerLambda 共用 lowerParam）', () => {
    const { ast } = parseSrc(SOURCE);
    const core = lowerModule(ast);
    const h = core.decls.find((d) => d.kind === 'Func' && d.name === 'h') as Core.Func;
    const let_ = h.body.statements[0] as Core.Let;
    const lambda = let_.expr as Core.Lambda;
    assert.deepEqual(lambda.params[0]!.annotations, [{ name: 'seen', args: [] }]);
    assert.deepEqual(lambda.params[0]!.constraints.map((c) => c.kind), ['Required']);
  });

  it('同一注解内参数名重复报 E900', () => {
    const e = firstError('Module m.\n\nRule f given @id(k: 1, k: 2) x as Int, produce Int:\n  Return x.\n');
    assert.equal(e.code, 'E900');
  });

  it('注解与形参之间不能换行（规则头写在一行，aster-lang-core#266）', () => {
    const e = firstError('Module m.\n\nRule f given @audit\n  x as Int, produce Int:\n  Return x.\n');
    assert.equal(e.line, 3);
  });
});

describe('result of A or B 报 E062（aster-lang-ts#328）', () => {
  it('形参类型', () => {
    const e = firstError('Module m.\n\nRule f given x as result of Int or Text, produce Int:\n  Return 1.\n');
    assert.deepEqual(e, { code: 'E062', line: 3, col: 33, params: { token: 'kw.or', expected: 'kw.and' } });
  });

  it('返回类型与嵌套', () => {
    assert.equal(firstError('Module m.\n\nRule f, produce result of Int or Text:\n  Return ok of 1.\n').code, 'E062');
    assert.equal(firstError('Module m.\n\nRule f given x as Map Text to result of list of Int or Text, produce Int:\n  Return 1.\n').code, 'E062');
  });

  it('`and` / `,` 是失败类型分隔符', () => {
    assert.deepEqual(parseSrc('Module m.\n\nRule f given x as result of Int and Text, y as result of Int, Text, produce Int:\n  Return 1.\n').errors, []);
  });
});

describe('类型别名关键词大小写不敏感（aster-lang-ts#328）', () => {
  for (const kw of ['type', 'Type', 'TYPE']) {
    it(kw, () => {
      const { ast, errors } = parseSrc(`Module m.\n\n${kw} Amount as Int.\n\nRule f given a as Amount, produce Int:\n  Return 1.\n`);
      assert.deepEqual(errors, []);
      assert.deepEqual(ast.typeAliasDecls?.map((a) => a.name), ['Amount']);
    });
  }

  it('`Type` 作类型名照旧可用', () => {
    assert.deepEqual(parseSrc('Module m.\n\nDefine Type has code as Text.\n\nDefine Box has kind as Type.\n\n'
      + 'Rule f given t as Type, produce Text:\n  Return t.code.\n').errors, []);
  });
});

describe('前缀可空 maybe（aster-lang-ts#328）', () => {
  function fieldType(type: string): Core.Type {
    const { ast, errors } = parseSrc(`Module m.\n\nDefine U has n as ${type}.\n`);
    assert.deepEqual(errors, [], type);
    const data = lowerModule(ast).decls[0] as Core.Data;
    return data.fields[0]!.type;
  }

  it('`maybe T` / `Maybe T` 是 Maybe 节点（≡ `T?`），core 现已接受', () => {
    assert.equal(fieldType('maybe Text').kind, 'Maybe');
    assert.equal(fieldType('Maybe Text').kind, 'Maybe');
  });

  it('`Maybe @pii(L1, name) Text`：注解在 Maybe 内层', () => {
    const t = fieldType('Maybe @pii(L1, name) Text') as Core.Maybe;
    assert.equal(t.kind, 'Maybe');
    assert.equal(t.type.kind, 'PiiType');
  });

  it('字段类型最外层的 @pii 同时记入 Field.annotations（与 core AstBuilder.visitField 一致）', () => {
    const { ast } = parseSrc('Module m.\n\nDefine U has n as @pii(L1, name) Text?, m as Maybe @pii(L1, name) Text.\n');
    const data = lowerModule(ast).decls[0] as Core.Data;
    assert.deepEqual(data.fields.map((f) => f.annotations.map((a) => a.name)), [['pii'], []]);
  });

  for (const type of ['maybe of Text', 'Maybe of Text']) {
    it(`${type} 报 E061`, () => {
      const e = firstError(`Module m.\n\nDefine U has n as ${type}.\n`);
      assert.deepEqual(e, { code: 'E061', line: 3, col: 25, params: { token: "'of'" } });
    });
  }
});
