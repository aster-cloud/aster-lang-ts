import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { CapabilityKind } from '../../../src/config/semantic.js';
import { Node } from '../../../src/ast/ast.js';
import type { Core } from '../../../src/types.js';
import type {
  Module as AstModule,
  Statement as AstStatement,
  Parameter as AstParameter,
  Type as AstType,
  Field as AstField,
} from '../../../src/types.js';

function lower(source: string): Core.Module {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  const ast = parse(tokens);
  return lowerModule(ast);
}

function lowerAst(module: AstModule): Core.Module {
  return lowerModule(module);
}

function freshSpan() {
  return {
    start: { line: 0, col: 0 },
    end: { line: 0, col: 0 },
  };
}

function makeParam(name: string, type: AstType): AstParameter {
  return { name, type, span: freshSpan() };
}

function makeFunc(options: {
  name: string;
  params?: readonly AstParameter[];
  retType: AstType;
  statements: readonly AstStatement[];
}): AstModule['decls'][number] {
  const body = Node.Block([...options.statements]);
  return Node.Func(
    options.name,
    [],
    options.params ?? [],
    options.retType,
    [],
    [],
    false,
    body
  );
}

describe('降级至 Core IR', () => {
  it('模块降级后应保留名称与声明数量', () => {
    const core = lower(`
Module test.lowering.basic.

Define User has id as Text.

Rule ping, produce Text:
  Return "pong".
`);
    assert.equal(core.kind, 'Module');
    assert.equal(core.name, 'test.lowering.basic');
    assert.equal(core.decls.length, 2);
  });

  it('函数降级后应保留参数与返回类型', () => {
    const core = lower(`
Module test.lowering.func_types.

Rule repeat given text as Text and times as Int, produce Text:
  Return text.
`);
    const func = core.decls.find(d => d.kind === 'Func') as Core.Func | undefined;
    assert.ok(func, '应该存在函数声明');
    assert.equal(func!.params.length, 2);
    assert.equal(func!.params[0]!.name, 'text');
    assert.equal(func!.ret.kind, 'TypeName');
    assert.equal(func!.effects.length, 0);
  });

  it('Return 语句应降级为 Core.Return', () => {
    const core = lower(`
Module test.lowering.return_stmt.

Rule identity given value as Int, produce Int:
  Return value.
`);
    const func = core.decls.find(d => d.kind === 'Func') as Core.Func;
    const body = func.body.statements;
    assert.equal(body.length, 1);
    assert.equal(body[0]!.kind, 'Return');
  });

  it('Match 语句应降级并保留所有分支', () => {
    const core = lower(`
Module test.lowering.match_stmt.

Define Result as one of Ok, Err.

Rule handle given result as Result, produce Int:
  Match result:
    When Ok, Return 1.
    When Err, Return 0.
`);
    const func = core.decls.find(d => d.kind === 'Func') as Core.Func;
    const matchStmt = func.body.statements[0]!;
    assert.equal(matchStmt.kind, 'Match');
    const matchCore = matchStmt as Core.Match;
    assert.equal(matchCore.cases.length, 2);
    assert.equal(matchCore.cases[0]!.pattern.kind, 'PatName');
  });

  it('Maybe 类型应降级为 Core.Maybe 包装类型', () => {
    const core = lower(`
Module test.lowering.maybe_type.

Rule safeHead given items as List of Int, produce Int?:
  Return None.
`);
    const func = core.decls.find(d => d.kind === 'Func') as Core.Func;
    assert.equal(func.ret.kind, 'Maybe');
    assert.equal(func.ret.type.kind, 'TypeName');
    const returnStmt = func.body.statements[0]!;
    assert.equal(returnStmt.kind, 'Return');
  });

  it('Lambda 表达式应降级为 Core.Lambda 并保留参数信息', () => {
    const core = lower(`
Module test.lowering.lambda_arrows.

Rule makeIdentity, produce Fn1:
  Return (value as Text) => value.
`);
    const func = core.decls.find(d => d.kind === 'Func') as Core.Func;
    const lambda = (func.body.statements[0] as Core.Return).expr as Core.Lambda;
    assert.equal(lambda.kind, 'Lambda');
    assert.equal(lambda.params.length, 1);
    assert.equal(lambda.params[0]!.name, 'value');
    assert.equal(lambda.ret.kind, 'TypeName');
  });

  it('Lambda 闭包应记录外部变量捕获列表', () => {
    const paramValue = makeParam('value', Node.TypeName('Int'));
    const funcParam = makeParam('base', Node.TypeName('Int'));
    const lambdaExpr = Node.Lambda(
      [paramValue],
      Node.TypeName('Int'),
      Node.Block([Node.Return(Node.Name('base'))])
    );
    const funcDecl = makeFunc({
      name: 'makeAdder',
      params: [funcParam],
      retType: Node.TypeName('Fn1'),
      statements: [Node.Return(lambdaExpr)],
    });
    const moduleAst = Node.Module('test.lowering.lambda_capture', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls.find(d => d.kind === 'Func') as Core.Func;
    const lambda = (func.body.statements[0] as Core.Return).expr as Core.Lambda;
    const captures = lambda.captures ? [...lambda.captures].sort() : [];
    assert.deepEqual(captures, ['base']);
  });

  it('Await 表达式应降级为 Core.Await', () => {
    const awaitExpr = Node.Await(Node.Name('taskResult'));
    const funcDecl = makeFunc({
      name: 'awaiter',
      retType: Node.TypeName('Text'),
      statements: [Node.Return(awaitExpr)],
    });
    const moduleAst = Node.Module('test.lowering.await_expr', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    const retExpr = (func.body.statements[0] as Core.Return).expr;
    assert.equal(retExpr.kind, 'Await');
    assert.equal((retExpr as Core.Await).expr.kind, 'Name');
  });

  it('Block 语句应降级为 Core.Scope 并保持嵌套顺序', () => {
    const inner = Node.Block([Node.Let('temp', Node.Int(1)), Node.Return(Node.Name('temp'))]);
    const funcDecl = makeFunc({
      name: 'scoped',
      retType: Node.TypeName('Int'),
      statements: [Node.Block([Node.Let('inner', Node.Int(2))]), inner],
    });
    const moduleAst = Node.Module('test.lowering.scope_block', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    assert.equal(func.body.statements[0]!.kind, 'Scope');
    const scope = func.body.statements[1]!;
    assert.equal(scope.kind, 'Scope');
    const scopeBody = scope as Core.Scope;
    assert.equal(scopeBody.statements[1]!.kind, 'Return');
  });

  it('Result/List map 调用应降级并保持 Lambda 参数信息', () => {
    const resultLambda = Node.Lambda(
      [makeParam('value', Node.TypeName('Int'))],
      Node.TypeName('Int'),
      Node.Block([Node.Return(Node.Name('value'))])
    );
    const resultCall = Node.Call(Node.Name('Result.map'), [Node.Name('res'), resultLambda]);
    const listLambda = Node.Lambda(
      [makeParam('item', Node.TypeName('Text'))],
      Node.TypeName('Text'),
      Node.Block([Node.Return(Node.Name('prefix'))])
    );
    const listCall = Node.Call(Node.Name('List.map'), [Node.Name('items'), listLambda]);
    const funcDecl = makeFunc({
      name: 'mapBoth',
      params: [makeParam('prefix', Node.TypeName('Text'))],
      retType: Node.TypeName('List'),
      statements: [Node.Return(resultCall), Node.Return(listCall)],
    });
    const moduleAst = Node.Module('test.lowering.map_calls', [funcDecl]);
    const core = lowerAst(moduleAst);
    const body = (core.decls[0] as Core.Func).body.statements;
    const resultExpr = (body[0] as Core.Return).expr as Core.Call;
    const listExpr = (body[1] as Core.Return).expr as Core.Call;
    assert.equal(resultExpr.kind, 'Call');
    assert.equal(resultExpr.args[1]?.kind, 'Lambda');
    const listLambdaCore = listExpr.args[1] as Core.Lambda;
    assert.deepEqual(listLambdaCore.captures ? [...listLambdaCore.captures] : [], ['prefix']);
  });

  it('effectCaps 显式声明应完整传递', () => {
    const caps = [CapabilityKind.SECRETS];
    const funcDecl = Node.Func(
      'readSecret',
      [],
      [],
      Node.TypeName('Text'),
      [],
      caps,
      true,
      Node.Block([Node.Return(Node.String('ok'))])
    );
    const moduleAst = Node.Module('test.lowering.effectcaps.explicit', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    assert.deepEqual(func.effectCaps, caps);
    assert.notStrictEqual(func.effectCaps, caps);
    assert.equal(func.effectCapsExplicit, true);
  });

  it('effectCaps 推断结果应保持并标记为隐式', () => {
    const caps = [CapabilityKind.FILES, CapabilityKind.TIME];
    const funcDecl = Node.Func(
      'touchFile',
      [],
      [],
      Node.TypeName('Bool'),
      [],
      caps,
      false,
      Node.Block([Node.Return(Node.Bool(true))])
    );
    const moduleAst = Node.Module('test.lowering.effectcaps.implicit', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    assert.deepEqual(func.effectCaps, caps);
    assert.notStrictEqual(func.effectCaps, caps);
    assert.equal(func.effectCapsExplicit, false);
  });

  it('未知 effect 应抛出诊断错误', () => {
    const funcDecl = Node.Func(
      'useUnknownEffect',
      [],
      [],
      Node.TypeName('Int'),
      ['teleport'],
      [],
      false,
      Node.Block([Node.Return(Node.Int(1))])
    );
    const moduleAst = Node.Module('test.lowering.effectcaps.unknown', [funcDecl]);
    assert.throws(
      () => lowerAst(moduleAst),
      /未知的 effect/
    );
  });

  it('Set 语句应降级为 Core.Set 并保留表达式', () => {
    const funcDecl = makeFunc({
      name: 'assign',
      params: [makeParam('value', Node.TypeName('Int'))],
      retType: Node.TypeName('Int'),
      statements: [
        Node.Let('counter', Node.Int(0)),
        Node.Set('counter', Node.Name('value')),
        Node.Return(Node.Name('counter')),
      ],
    });
    const moduleAst = Node.Module('test.lowering.set.basic', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    const body = func.body.statements;
    assert.equal(body[1]?.kind, 'Set');
    const setStmt = body[1] as Core.Set;
    assert.equal(setStmt.name, 'counter');
    assert.equal(setStmt.expr.kind, 'Name');
  });

  it('连续 Set 语句应保持原有顺序', () => {
    const funcDecl = makeFunc({
      name: 'mutate',
      retType: Node.TypeName('Int'),
      statements: [
        Node.Let('a', Node.Int(1)),
        Node.Set('a', Node.Int(2)),
        Node.Set('a', Node.Int(3)),
        Node.Return(Node.Name('a')),
      ],
    });
    const moduleAst = Node.Module('test.lowering.set.sequence', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    const body = func.body.statements;
    assert.equal(body[1]?.kind, 'Set');
    assert.equal(body[2]?.kind, 'Set');
    assert.equal((body[1] as Core.Set).expr.kind, 'Int');
    assert.equal((body[2] as Core.Set).expr.kind, 'Int');
  });

  it('PatternNull 应降级为 Core.PatNull', () => {
    const matchStmt = Node.Match(Node.Name('value'), [
      Node.Case(Node.PatternNull(), Node.Return(Node.Int(0))),
      Node.Case(Node.PatternName('other'), Node.Return(Node.Int(1))),
    ]);
    const funcDecl = makeFunc({
      name: 'checkNull',
      retType: Node.TypeName('Int'),
      statements: [matchStmt],
    });
    const moduleAst = Node.Module('test.lowering.match.null', [funcDecl]);
    const core = lowerAst(moduleAst);
    const matchCore = ((core.decls[0] as Core.Func).body.statements[0]) as Core.Match;
    assert.equal(matchCore.cases[0]?.pattern.kind, 'PatNull');
  });

  it('PatternCtor 应保留类型名与参数', () => {
    const pattern = Node.PatternCtor('Option.Some', ['item'], [Node.PatternName('inner')]);
    const matchStmt = Node.Match(Node.Name('value'), [
      Node.Case(pattern, Node.Return(Node.Int(1))),
    ]);
    const funcDecl = makeFunc({
      name: 'matchCtor',
      retType: Node.TypeName('Int'),
      statements: [matchStmt],
    });
    const moduleAst = Node.Module('test.lowering.match.ctor', [funcDecl]);
    const core = lowerAst(moduleAst);
    const matchCore = ((core.decls[0] as Core.Func).body.statements[0]) as Core.Match;
    const pat = matchCore.cases[0]!.pattern as Core.PatCtor;
    assert.equal(pat.kind, 'PatCtor');
    assert.equal(pat.typeName, 'Option.Some');
    assert.equal(pat.args?.[0]?.kind, 'PatName');
  });

  it('PatternInt 应降级为 Core.PatInt', () => {
    const matchStmt = Node.Match(Node.Name('num'), [
      Node.Case(Node.PatternInt(42), Node.Return(Node.String('answer'))),
    ]);
    const funcDecl = makeFunc({
      name: 'matchInt',
      retType: Node.TypeName('Text'),
      statements: [matchStmt],
    });
    const moduleAst = Node.Module('test.lowering.match.int', [funcDecl]);
    const core = lowerAst(moduleAst);
    const matchCore = ((core.decls[0] as Core.Func).body.statements[0]) as Core.Match;
    const pat = matchCore.cases[0]!.pattern as Core.PatInt;
    assert.equal(pat.kind, 'PatInt');
    assert.equal(pat.value, 42);
  });

  it('Ok 表达式应降级为 Core.Ok', () => {
    const funcDecl = makeFunc({
      name: 'wrapOk',
      retType: Node.TypeName('Result'),
      statements: [Node.Return(Node.Ok(Node.Int(1)))],
    });
    const moduleAst = Node.Module('test.lowering.expr.ok', [funcDecl]);
    const core = lowerAst(moduleAst);
    const retStmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Return;
    const expr = retStmt.expr as Core.Ok;
    assert.equal(expr.kind, 'Ok');
    assert.equal(expr.expr.kind, 'Int');
  });

  it('Err 表达式应降级为 Core.Err', () => {
    const funcDecl = makeFunc({
      name: 'wrapErr',
      retType: Node.TypeName('Result'),
      statements: [Node.Return(Node.Err(Node.String('fail')))],
    });
    const moduleAst = Node.Module('test.lowering.expr.err', [funcDecl]);
    const core = lowerAst(moduleAst);
    const retStmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Return;
    const expr = retStmt.expr as Core.Err;
    assert.equal(expr.kind, 'Err');
    assert.equal((expr.expr as Core.String).value, 'fail');
  });

  it('Some 与 None 应分别降级为 Core.Some 与 Core.None', () => {
    const funcDecl = makeFunc({
      name: 'wrapOption',
      retType: Node.Maybe(Node.TypeName('Int')),
      statements: [Node.Return(Node.Some(Node.Int(7))), Node.Return(Node.None())],
    });
    const moduleAst = Node.Module('test.lowering.expr.option', [funcDecl]);
    const core = lowerAst(moduleAst);
    const firstReturn = (core.decls[0] as Core.Func).body.statements[0] as Core.Return;
    const secondReturn = (core.decls[0] as Core.Func).body.statements[1] as Core.Return;
    const someExpr = firstReturn.expr as Core.Some;
    const noneExpr = secondReturn.expr as Core.None;
    assert.equal(someExpr.kind, 'Some');
    assert.equal(someExpr.expr.kind, 'Int');
    assert.equal(noneExpr.kind, 'None');
  });

  it('Start 语句应降级为 Core.Start', () => {
    const startStmt = Node.Start('job', Node.Call(Node.Name('Async.create'), []));
    const funcDecl = makeFunc({
      name: 'launch',
      retType: Node.TypeName('Int'),
      statements: [startStmt, Node.Return(Node.Int(0))],
    });
    const moduleAst = Node.Module('test.lowering.start', [funcDecl]);
    const core = lowerAst(moduleAst);
    const stmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Start;
    assert.equal(stmt.kind, 'Start');
    assert.equal(stmt.name, 'job');
    assert.equal(stmt.expr.kind, 'Call');
  });

  it('Wait 语句应降级为 Core.Wait 并保留名称列表', () => {
    const waitStmt = Node.Wait(['job', 'other']);
    const funcDecl = makeFunc({
      name: 'awaitAll',
      retType: Node.TypeName('Int'),
      statements: [waitStmt, Node.Return(Node.Int(1))],
    });
    const moduleAst = Node.Module('test.lowering.wait', [funcDecl]);
    const core = lowerAst(moduleAst);
    const stmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Wait;
    assert.equal(stmt.kind, 'Wait');
    assert.deepEqual(stmt.names, ['job', 'other']);
  });

  it('Call 语句应降级为占位 Let', () => {
    const callStmt = Node.Call(Node.Name('Console.log'), [Node.String('hi')]);
    const funcDecl = makeFunc({
      name: 'log',
      retType: Node.TypeName('Null'),
      statements: [callStmt, Node.Return(Node.Null())],
    });
    const moduleAst = Node.Module('test.lowering.callStmt', [funcDecl]);
    const core = lowerAst(moduleAst);
    const stmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Let;
    assert.equal(stmt.kind, 'Let');
    assert.equal(stmt.name, '_');
    const expr = stmt.expr as Core.Call;
    assert.equal(expr.kind, 'Call');
    assert.equal(expr.target.kind, 'Name');
  });

  it('If 无 else 时降级后 elseBlock 应为 null', () => {
    const ifStmt = Node.If(
      Node.Bool(true),
      Node.Block([Node.Return(Node.Int(1))]),
      null
    );
    const funcDecl = makeFunc({
      name: 'onlyThen',
      retType: Node.TypeName('Int'),
      statements: [ifStmt, Node.Return(Node.Int(0))],
    });
    const moduleAst = Node.Module('test.lowering.if.then', [funcDecl]);
    const core = lowerAst(moduleAst);
    const stmt = (core.decls[0] as Core.Func).body.statements[0] as Core.If;
    assert.equal(stmt.kind, 'If');
    assert.ok(stmt.thenBlock);
    assert.equal(stmt.elseBlock, null);
  });

  it('If 带 else 时应保留 elseBlock', () => {
    const ifStmt = Node.If(
      Node.Bool(false),
      Node.Block([Node.Return(Node.Int(1))]),
      Node.Block([Node.Return(Node.Int(2))])
    );
    const funcDecl = makeFunc({
      name: 'withElse',
      retType: Node.TypeName('Int'),
      statements: [ifStmt, Node.Return(Node.Int(0))],
    });
    const moduleAst = Node.Module('test.lowering.if.else', [funcDecl]);
    const core = lowerAst(moduleAst);
    const stmt = (core.decls[0] as Core.Func).body.statements[0] as Core.If;
    assert.equal((stmt.elseBlock as Core.Block).statements[0]?.kind, 'Return');
  });

  it('Within scope 块应降级为 Core.Scope', () => {
    const scopeBlock = Node.Block([
      Node.Let('temp', Node.Int(1)),
      Node.Return(Node.Name('temp')),
    ]);
    const funcDecl = makeFunc({
      name: 'singleScope',
      retType: Node.TypeName('Int'),
      statements: [scopeBlock],
    });
    const moduleAst = Node.Module('test.lowering.scope.single', [funcDecl]);
    const core = lowerAst(moduleAst);
    const stmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Scope;
    assert.equal(stmt.kind, 'Scope');
    assert.equal(stmt.statements[0]?.kind, 'Let');
  });

  it('嵌套 Within scope 应降级为嵌套 Scope', () => {
    const inner = Node.Block([Node.Set('value', Node.Int(2))]);
    const outer = Node.Block([
      Node.Let('value', Node.Int(1)),
      inner,
      Node.Return(Node.Name('value')),
    ]);
    const funcDecl = makeFunc({
      name: 'nestedScope',
      retType: Node.TypeName('Int'),
      statements: [outer],
    });
    const moduleAst = Node.Module('test.lowering.scope.nested', [funcDecl]);
    const core = lowerAst(moduleAst);
    const scope = (core.decls[0] as Core.Func).body.statements[0] as Core.Scope;
    assert.equal(scope.kind, 'Scope');
    const nested = scope.statements[1] as Core.Scope;
    assert.equal(nested.kind, 'Scope');
    assert.equal(nested.statements[0]?.kind, 'Set');
  });

  it('TypePii 应降级为 Core.PiiType', () => {
    const piiParam = makeParam('id', Node.TypePii(Node.TypeName('Text'), 'L2', 'email'));
    const funcDecl = makeFunc({
      name: 'mask',
      params: [piiParam],
      retType: Node.TypeName('Bool'),
      statements: [Node.Return(Node.Bool(true))],
    });
    const moduleAst = Node.Module('test.lowering.type.pii', [funcDecl]);
    const core = lowerAst(moduleAst);
    const paramType = ((core.decls[0] as Core.Func).params[0]!).type as Core.PiiType;
    assert.equal(paramType.kind, 'PiiType');
    assert.equal(paramType.baseType.kind, 'TypeName');
    assert.equal(paramType.sensitivity, 'L2');
    assert.equal(paramType.category, 'email');
  });

  it('函数应聚合参数与返回值的 PII 元数据', () => {
    const funcDecl = Node.Func(
      'shareProfile',
      [],
      [makeParam('userId', Node.TypePii(Node.TypeName('Text'), 'L1', 'name'))],
      Node.Result(
        Node.TypePii(Node.TypeName('Text'), 'L2', 'email'),
        Node.TypeName('Error')
      ),
      [],
      [],
      false,
      Node.Block([
        Node.Return(
          Node.Call(Node.Name('Ok'), [
            Node.String('ok'),
          ])
        ),
      ])
    );
    const moduleAst = Node.Module('test.lowering.func.pii', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    assert.equal(func.piiLevel, 'L2');
    assert.deepEqual(func.piiCategories, ['name', 'email']);
  });

  it('类型参数引用应降级为 Core.TypeVar', () => {
    const funcDecl = Node.Func(
      'identity',
      ['T'],
      [makeParam('value', Node.TypeName('T'))],
      Node.TypeName('T'),
      [],
      [],
      false,
      Node.Block([Node.Return(Node.Name('value'))])
    );
    const moduleAst = Node.Module('test.lowering.type.var', [funcDecl]);
    const core = lowerAst(moduleAst);
    const func = core.decls[0] as Core.Func;
    assert.equal(func.params[0]!.type.kind, 'TypeVar');
    assert.equal(func.ret.kind, 'TypeVar');
  });

  it('TypeApp 应降级并保留参数列表', () => {
    const funcDecl = Node.Func(
      'getFuture',
      [],
      [],
      Node.TypeApp('Future', [Node.TypeName('Text'), Node.TypeName('Int')]),
      [],
      [],
      false,
      Node.Block([Node.Return(Node.Name('pending'))])
    );
    const moduleAst = Node.Module('test.lowering.type.app', [funcDecl]);
    const core = lowerAst(moduleAst);
    const ret = (core.decls[0] as Core.Func).ret as Core.TypeApp;
    assert.equal(ret.kind, 'TypeApp');
    assert.equal(ret.base, 'Future');
    assert.equal(ret.args.length, 2);
    assert.equal(ret.args[0]?.kind, 'TypeName');
    assert.equal(ret.args[1]?.kind, 'TypeName');
  });

  it('Option 类型应降级为 Core.Option', () => {
    const funcDecl = makeFunc({
      name: 'first',
      params: [makeParam('items', Node.Option(Node.TypeName('Text')))],
      retType: Node.Maybe(Node.TypeName('Text')),
      statements: [Node.Return(Node.None())],
    });
    const moduleAst = Node.Module('test.lowering.type.option', [funcDecl]);
    const core = lowerAst(moduleAst);
    const paramType = ((core.decls[0] as Core.Func).params[0]!).type as Core.Option;
    const ret = (core.decls[0] as Core.Func).ret as Core.Maybe;
    assert.equal(paramType.kind, 'Option');
    assert.equal(paramType.type.kind, 'TypeName');
    assert.equal(ret.kind, 'Maybe');
    assert.equal(ret.type.kind, 'TypeName');
  });

  it('Result 类型应降级为 Core.Result', () => {
    const funcDecl = makeFunc({
      name: 'wrapResult',
      retType: Node.Result(Node.TypeName('Text'), Node.TypeName('Error')),
      statements: [Node.Return(Node.Ok(Node.String('ok')))],
    });
    const moduleAst = Node.Module('test.lowering.type.result', [funcDecl]);
    const core = lowerAst(moduleAst);
    const ret = (core.decls[0] as Core.Func).ret as Core.Result;
    assert.equal(ret.kind, 'Result');
    assert.equal(ret.ok.kind, 'TypeName');
    assert.equal(ret.err.kind, 'TypeName');
  });

  it('Import 声明应直接映射为 Core.Import', () => {
    const moduleAst = Node.Module('test.lowering.import', [
      Node.Import('Http.Client', 'HttpClient'),
    ]);
    const core = lowerAst(moduleAst);
    const decl = core.decls[0] as Core.Import;
    assert.equal(decl.kind, 'Import');
    assert.equal(decl.name, 'Http.Client');
    assert.equal(decl.asName, 'HttpClient');
  });

  it('Data 字段 CNL 约束应转换为 Core 约束', () => {
    const constraints: import('../../../src/types.js').Constraint[] = [
      { kind: 'Required', span: freshSpan() },
      { kind: 'Range', min: 0, max: 100, span: freshSpan() },
    ];
    const field: AstField = {
      name: 'age',
      type: Node.TypeName('Int'),
      constraints,
      span: freshSpan(),
    };
    const dataDecl = Node.Data('User', [field]);
    const moduleAst = Node.Module('test.lowering.data.constraints', [dataDecl]);
    const core = lowerAst(moduleAst);
    const data = core.decls[0] as Core.Data;
    assert.ok(data.fields[0]!.constraints, '应该存在 constraints');
    assert.equal(data.fields[0]!.constraints!.length, 2);
    const requiredConstraint = data.fields[0]!.constraints![0]!;
    const rangeConstraint = data.fields[0]!.constraints![1]!;
    assert.equal(requiredConstraint.kind, 'Required');
    assert.equal(rangeConstraint.kind, 'Range');
    if (rangeConstraint.kind === 'Range') {
      assert.equal(rangeConstraint.min, 0);
      assert.equal(rangeConstraint.max, 100);
    }
  });

  it('多约束字段与无约束字段应分别保留', () => {
    const fieldWithConstraints: AstField = {
      name: 'id',
      type: Node.TypeName('Text'),
      constraints: [
        { kind: 'Required', span: freshSpan() },
        { kind: 'Pattern', regexp: '^[A-Z]+$', span: freshSpan() },
      ],
      span: freshSpan(),
    };
    const fieldWithoutConstraints: AstField = {
      name: 'age',
      type: Node.TypeName('Int'),
      span: freshSpan(),
    };
    const dataDecl = Node.Data('Profile', [fieldWithConstraints, fieldWithoutConstraints]);
    const moduleAst = Node.Module('test.lowering.data.multi_constraints', [dataDecl]);
    const core = lowerAst(moduleAst);
    const data = core.decls[0] as Core.Data;
    assert.equal(data.fields[0]!.constraints!.length, 2);
    assert.equal(data.fields[1]!.constraints!.length, 0);
  });

  it('Construct 表达式应降级为 Core.Construct', () => {
    const construct = Node.Construct('User', [
      { name: 'id', expr: Node.Int(1), span: freshSpan() },
      { name: 'name', expr: Node.String('Alice'), span: freshSpan() },
    ]);
    const funcDecl = makeFunc({
      name: 'buildUser',
      retType: Node.TypeName('User'),
      statements: [Node.Return(construct)],
    });
    const moduleAst = Node.Module('test.lowering.construct', [funcDecl]);
    const core = lowerAst(moduleAst);
    const expr = ((core.decls[0] as Core.Func).body.statements[0] as Core.Return)
      .expr as Core.Construct;
    assert.equal(expr.kind, 'Construct');
    assert.equal(expr.fields.length, 2);
    assert.equal(expr.fields[0]?.name, 'id');
    assert.equal(expr.fields[1]?.expr.kind, 'String');
  });

  it('Long 常量应降级为 Core.Long', () => {
    const funcDecl = makeFunc({
      name: 'longValue',
      retType: Node.TypeName('Long'),
      statements: [Node.Return(Node.Long('1234567890123456789'))],
    });
    const moduleAst = Node.Module('test.lowering.long', [funcDecl]);
    const core = lowerAst(moduleAst);
    const retStmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Return;
    const expr = retStmt.expr as Core.Long;
    assert.equal(expr.kind, 'Long');
    assert.equal(expr.value, '1234567890123456789');
  });

  it('Double 常量应降级为 Core.Double', () => {
    const funcDecl = makeFunc({
      name: 'doubleValue',
      retType: Node.TypeName('Double'),
      statements: [Node.Return(Node.Double(3.14))],
    });
    const moduleAst = Node.Module('test.lowering.double', [funcDecl]);
    const core = lowerAst(moduleAst);
    const retStmt = (core.decls[0] as Core.Func).body.statements[0] as Core.Return;
    const expr = retStmt.expr as Core.Double;
    assert.equal(expr.kind, 'Double');
    assert.equal(expr.value, 3.14);
  });
});
