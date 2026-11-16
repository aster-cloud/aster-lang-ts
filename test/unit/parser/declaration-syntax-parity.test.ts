/**
 * aster-lang-ts#334：#328 之后余下的七处双引擎解析分歧（ADR 0056 修订 A3），与 core DeclarationSyntaxParityTest 对应：
 *
 * - 大写字段名 `Define Order with Id as Text.`：两引擎都在字段名上报 E055（core 此前接受；ts 一直拒绝，这里锁住）。
 * - 字段前置注解 `has @pii(L1, email) email as Text`：两引擎都接受，Field.annotations 先列前置注解、再列类型最外层的 @pii
 *   （ts 此前报 E055）。
 * - 大写规则名 `Rule Approve …`：两引擎都报 E055（core 此前接受）。
 * - 导入关键词 `USE` / `uSe`：两引擎都接受（core 此前报 E063；ts 一直接受，这里锁住）。
 * - 下划线开头的标识符 `_x`：两引擎词法都报 E050（core 此前接受）。
 * - lambda 单行体 `function given x as Int, produce Int: Return x.`：两引擎都接受（ts 此前报 E055 Expected newline）。
 * - `given x as Pair of Int, y, produce …`：两引擎都在 `y` 上报 E055（ts 此前把 `y` 读成 Pair 的类型参数）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse, parseWithLexicon } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { DiagnosticError } from '../../../src/diagnostics/diagnostics.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { Core, Module } from '../../../src/types.js';

interface Err { code: string; line: number | undefined; col: number | undefined; params: unknown; message?: string }

function parseSrc(source: string): { ast: Module; errors: Err[] } {
  const r = parse(lex(canonicalize(source)));
  const errors = r.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => ({ code: String(d.code), line: d.span?.start.line, col: d.span?.start.col, params: d.params, message: d.message }));
  return { ast: r.ast, errors };
}

function firstError(source: string): Err {
  const { errors } = parseSrc(source);
  assert.ok(errors.length > 0, `应报解析错误：${source}`);
  return errors[0]!;
}

/** 词法错误（E050）以 DiagnosticError 抛出，不进 diagnostics。 */
function lexError(source: string): Err {
  try {
    parse(lex(canonicalize(source)));
  } catch (e) {
    assert.ok(e instanceof DiagnosticError, String(e));
    const d = e.diagnostic;
    return { code: String(d.code), line: d.span.start.line, col: d.span.start.col, params: d.params };
  }
  assert.fail(`应报词法错误：${source}`);
}

function assertAccepted(source: string): Module {
  const { ast, errors } = parseSrc(source);
  assert.deepEqual(errors, [], source);
  return ast;
}

describe('大写字段名报 E055（aster-lang-ts#334）', () => {
  const cases: Array<[string, number, number]> = [
    ['Define Order with Id as Text.', 3, 19],
    ['Define Order has id as Text, Amount as Int.', 3, 30],
    ['Define Order has id as Text and Amount.', 3, 33],
    ['Define Order has Id.', 3, 18],
    ['Define Order has @pii(L1, email) Email as Text.', 3, 34],
    ['Define Order has\n  id as Text,\n  Amount as Int.', 5, 3],
  ];
  for (const [decl, line, col] of cases) {
    it(decl.split('\n').join(' ⏎ '), () => {
      const e = firstError(`Module m.\n\n${decl}\n`);
      assert.deepEqual(e, { code: 'E055', line, col, params: { token: 'token.fieldName' }, message: 'Expected field name' });
    });
  }

  for (const name of ['customer', 'Ölwert', 'राशि', 'a_b']) {
    it(`非 ASCII 大写开头的字段名照常接受：${name}`, () => {
      assertAccepted(`Module m.\n\nDefine Box has ${name} as Text.\n`);
    });
  }

  it('中文字段名照常接受', () => {
    const r = parseWithLexicon(lex(canonicalize('模块 m。\n\n定义 客户 包含 姓名 作为 文本。\n', ZH_CN), ZH_CN), ZH_CN);
    assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
  });
});

describe('字段前置注解（aster-lang-ts#334）', () => {
  it('Core IR：前置注解在前，类型最外层的 @pii 在后（与 core AstBuilder.visitField 一致）', () => {
    const ast = assertAccepted('Module m.\n\nDefine C has @audit @tag(k: 1) name as @pii(L1, name) Text, plain as Text.\n');
    const data = lowerModule(ast).decls[0] as Core.Data;
    assert.deepEqual(data.fields.map((f) => [f.name, f.annotations]), [
      ['name', [
        { name: 'audit', args: [] },
        { name: 'tag', args: [{ name: 'k', value: 1 }] },
        { name: 'pii', args: [{ name: '$0', value: 'L1' }, { name: '$1', value: 'name' }] },
      ]],
      ['plain', []],
    ]);
  });

  it('字段位置从字段名起，前置注解不计入（与 core 一致）', () => {
    const ast = assertAccepted('Module m.\n\nDefine C has @audit name as Text.\n');
    const data = ast.decls[0] as Extract<Module['decls'][number], { kind: 'Data' }>;
    assert.equal(data.fields[0]!.span.start.col, 21);
  });

  const accepted = [
    'Define B has x as Pair of Int, @pii(L1, email) y as Text.',
    'Define B has x as Pair of Int and @audit y as Text.',
    'Define B has @tag(name: "k", 3, true) note.',
    'Define B has @source(form: "loan") amount as Int between 1 and 100.',
    'Define B has\n  @pii(L1, email) contact as Text,\n  @audit score as Int.',
  ];
  for (const decl of accepted) {
    it(decl.split('\n').join(' ⏎ '), () => {
      assertAccepted(`Module m.\n\nDefine Pair has a as Int.\n\n${decl}\n`);
    });
  }

  it('`Pair of Int, @pii(…) y as Text`：注解开始下一个字段，Pair 只有一个类型参数', () => {
    const ast = assertAccepted('Module m.\n\nDefine Pair has a as Int.\n\nDefine B has x as Pair of Int, @pii(L1, email) y as Text.\n');
    const data = lowerModule(ast).decls[1] as Core.Data;
    assert.deepEqual(data.fields.map((f) => [f.name, f.annotations.map((a) => a.name)]), [['x', []], ['y', ['pii']]]);
  });
});

describe('大写规则名报 E055（aster-lang-ts#334）', () => {
  const cases: Array<[string, number, number]> = [
    ['Rule Approve given x as Int, produce Int:\n  Return x.', 3, 6],
    ['Rule Approve, produce Int:\n  Return 1.', 3, 6],
    ['@entry\nRule Approve, produce Int:\n  Return 1.', 4, 6],
  ];
  for (const [decl, line, col] of cases) {
    it(decl.split('\n').join(' ⏎ '), () => {
      const e = firstError(`Module m.\n\n${decl}\n`);
      assert.deepEqual(e, { code: 'E055', line, col, params: { token: 'token.identifier' }, message: 'Expected identifier' });
    });
  }

  for (const name of ['approve', 'ölwert', 'Ölwert', 'राशि']) {
    it(`小写与无大小写文字的规则名照常接受：${name}`, () => {
      assertAccepted(`Module m.\n\nRule ${name}, produce Int:\n  Return 1.\n`);
    });
  }
});

describe('导入关键词大小写不敏感（aster-lang-ts#334）', () => {
  for (const kw of ['Use', 'use', 'USE', 'uSe', 'USe']) {
    it(kw, () => {
      const ast = assertAccepted(`Module m.\n\n${kw} lib.status as Status.\n`);
      const imp = ast.decls[0] as Extract<Module['decls'][number], { kind: 'Import' }>;
      assert.equal(imp.kind, 'Import');
      assert.equal(imp.name, 'lib.status');
      assert.equal(imp.asName, 'Status');
    });
  }

  it('`USE` 作类型名照旧可用', () => {
    assertAccepted('Module m.\n\nDefine USE has x as Int.\n\nRule pick given u as USE, produce Int:\n  Return u.x.\n');
  });
});

describe('下划线开头的标识符报 E050（aster-lang-ts#334）', () => {
  const cases: Array<[string, number, number]> = [
    ['Rule f given _x as Int, produce Int:\n  Return 1.', 3, 14],
    ['Rule f given x as Int, produce Int:\n  Let _y be x.\n  Return x.', 4, 7],
    ['Rule f given x as Int, produce Int:\n  Let _ be x.\n  Return x.', 4, 7],
    ['Rule f given x as Int, produce Int:\n  Return x plus _.', 4, 17],
    ['Define _Box has a as Int.', 3, 8],
  ];
  for (const [decl, line, col] of cases) {
    it(decl.split('\n').join(' ⏎ '), () => {
      assert.deepEqual(lexError(`Module m.\n\n${decl}\n`), { code: 'E050', line, col, params: { char: "'_'" } });
    });
  }

  it('下划线在首字符之后照常接受；冠词与下划线相邻时是标识符的一段', () => {
    const ast = assertAccepted('Module m.\n\nDefine Box_A has a_b as Int, the_total as Int, x_an as Int, n1a as Int.\n\n'
      + 'Rule f given a_x as Box_A, produce Int:\n  Let the_y be a_x.a_b.\n  Return the_y.\n');
    const data = ast.decls[0] as Extract<Module['decls'][number], { kind: 'Data' }>;
    assert.equal(data.name, 'Box_A');
    assert.deepEqual(data.fields.map((f) => f.name), ['a_b', 'the_total', 'x_an', 'n1a']);
  });
});

describe('lambda 单行体（aster-lang-ts#334）', () => {
  it('单条 Return 包成一个块，块的位置与整个 lambda 相同（与 core AstBuilder.visitLambdaExpr 一致）', () => {
    const ast = assertAccepted('Module m.\n\nRule f given x as Int, produce Int:\n'
      + '  Let g be function given y as Int, produce Int: Return y plus 1.\n  Return g(x).\n');
    const core = lowerModule(ast);
    const f = core.decls[0] as Core.Func;
    const lambda = (f.body.statements[0] as Core.Let).expr as Core.Lambda;
    assert.equal(lambda.kind, 'Lambda');
    assert.deepEqual(lambda.body.statements.map((s) => s.kind), ['Return']);
    const astLambda = ((ast.decls[0] as Extract<Module['decls'][number], { kind: 'Func' }>).body!.statements[0] as { expr: { span: unknown; body: { span: unknown } } }).expr;
    assert.deepEqual(astLambda.body.span, astLambda.span);
  });

  it('与块形的 Core IR 相同（去掉位置）', () => {
    const strip = (o: unknown): unknown => JSON.parse(JSON.stringify(o, (k, v) => (k === 'origin' || k === 'span' ? undefined : v)));
    const inline = lowerModule(assertAccepted('Module m.\n\nRule f given x as Int, produce Int:\n'
      + '  Let g be function given y as Int, produce Int: Return y plus x.\n  Return g(x).\n'));
    const block = lowerModule(assertAccepted('Module m.\n\nRule f given x as Int, produce Int:\n'
      + '  Let g be function given y as Int, produce Int:\n    Return y plus x.\n  Return g(x).\n'));
    assert.deepEqual(strip(inline), strip(block));
  });

  const accepted = [
    'Let g be function with y as Int, produce: Return y.\n  Return g(x).',
    'Let g be function, produce Int: Return 7.\n  Return g().',
    'Return List.length(List.map([x], function given a as Int, produce Int: Return a.)).',
  ];
  for (const body of accepted) {
    it(body.split('\n')[0]!, () => {
      assertAccepted(`Module m.\n\nRule f given x as Int, produce Int:\n  ${body}\n`);
    });
  }

  it('单行体只能是一条 Return：其它语句仍要求换行', () => {
    const e = firstError('Module m.\n\nRule f given x as Int, produce Int:\n  Let g be function given y as Int, produce Int: Let z be y.\n  Return x.\n');
    assert.deepEqual([e.code, e.line], ['E055', 4]);
  });
});

describe('X of A 之后的裸小写名字报 E055（aster-lang-ts#334）', () => {
  const cases: Array<[string, number, number, string]> = [
    ['Rule f given x as Pair of Int, y, produce Int:\n  Return 1.', 3, 32, 'y'],
    ['Rule f given x as Pair of Int and y, produce Int:\n  Return 1.', 3, 35, 'y'],
    ['Rule f given x as Pair of Int, y:\n  Return 1.', 3, 32, 'y'],
    ['Rule f given x as Pair of Int, @audit y, produce Int:\n  Return 1.', 3, 39, 'y'],
    ['Rule f given x as result of Int, y, produce Int:\n  Return 1.', 3, 34, 'y'],
    ['Rule f given x as Pair of Int, y required, produce Int:\n  Return 1.', 3, 32, 'y'],
    ['Define B has x as Pair of Int, y.', 3, 32, 'y'],
    ['Rule f given x as Int, produce Int:\n  Let g be function given a as Pair of Int, b, produce Int:\n    Return 1.\n  Return x.', 4, 45, 'b'],
  ];
  for (const [decl, line, col, name] of cases) {
    it(decl.split('\n')[0]!, () => {
      const e = firstError(`Module m.\n\nDefine Pair has a as Int.\n\n${decl}\n`);
      assert.deepEqual(e, {
        code: 'E055', line: line + 2, col, params: { token: 'token.typeName' },
        message: `Expected type name: '${name}' would be read as another type argument; write '${name} as <Type>' or wrap the generic type in parentheses`,
      });
    });
  }

  const accepted = [
    'given x as (Pair of Int), y, produce Int',
    'given x as Pair of Int, y as Text, produce Int',
    'given x as Pair of Int, @pii(L1, email) y as Text, produce Int',
    'given x as Pair of Int, Text, produce Int',
    'given x as Pair of Int, @pii(L1, email) Text, produce Int',
    'given x as Pair of Int, maybe Int, produce Int',
    'given x as Pair of Int, list of Int, produce Int',
    'given x as list of Int, y, produce Int',
    'given x as option of Int, y, produce Int',
  ];
  for (const params of accepted) {
    it(`不歧义的写法照常接受：${params}`, () => {
      assertAccepted(`Module m.\n\nDefine Pair has a as Int.\n\nRule f ${params}:\n  Return 1.\n`);
    });
  }
});
