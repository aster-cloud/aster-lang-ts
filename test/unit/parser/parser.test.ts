import { describe, test, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse, parseWithLexicon } from '../../../src/parser.js';
import type { Module, Declaration, Statement } from '../../../src/types.js';
import { CapabilityKind } from '../../../src/config/semantic.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';

function parseSource(source: string): Module {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  return parse(tokens);
}

function findDecl<K extends Declaration['kind']>(module: Module, kind: K): Extract<Declaration, { kind: K }> {
  const decl = module.decls.find(
    (candidate): candidate is Extract<Declaration, { kind: K }> => candidate.kind === kind
  );
  assert.ok(decl, `应该找到 ${kind} 声明`);
  return decl;
}

function findFunc(module: Module, name: string): Extract<Declaration, { kind: 'Func' }> {
  const func = module.decls.find(
    (decl): decl is Extract<Declaration, { kind: 'Func' }> => decl.kind === 'Func' && decl.name === name
  );
  assert.ok(func, `应该找到函数 ${name}`);
  return func;
}

describe('语法分析器', () => {
  test('应该解析模块名称', () => {
    const module = parseSource(`
This module is test.parser.module_name.

To ping, produce Text:
  Return "pong".
`);
    assert.equal(module.name, 'test.parser.module_name');
  });

  test('应该解析数据类型字段', () => {
    const module = parseSource(`
This module is test.parser.data_decl.

Define User with id: Text, name: Text, age: Int.
`);
    const data = findDecl(module, 'Data');
    assert.equal(data.fields.length, 3);
    assert.equal(data.fields[0]!.name, 'id');
    assert.equal(data.fields[0]!.type.kind, 'TypeName');
    assert.equal(data.fields[2]!.type.kind, 'TypeName');
  });

  test('应该解析枚举变体列表', () => {
    const module = parseSource(`
This module is test.parser.enum_decl.

Define Status as one of Pending, Success, Failure.
`);
    const en = findDecl(module, 'Enum');
    assert.deepEqual(en.variants, ['Pending', 'Success', 'Failure']);
  });

  test('应该解析函数的参数与返回类型', () => {
    const module = parseSource(`
This module is test.parser.func_signature.

To format with name: Text and times: Int, produce Text:
  Return Text.concat(name, Text.toString(times)).
`);
    const func = findDecl(module, 'Func');
    assert.equal(func.name, 'format');
    assert.equal(func.params.length, 2);
    assert.equal(func.params[0]!.name, 'name');
    assert.equal(func.retType.kind, 'TypeName');
  });

  test('应该解析函数体中的 Return 语句', () => {
    const module = parseSource(`
This module is test.parser.return_stmt.

To identity with value: Text, produce Text:
  Return value.
`);
    const func = findDecl(module, 'Func');
    const statements = func.body?.statements ?? [];
    assert.equal(statements.length, 1);
    assert.equal(statements[0]!.kind, 'Return');
  });

  test('应该解析 Let 语句并构建调用表达式', () => {
    const module = parseSource(`
This module is test.parser.let_stmt.

To greet with name: Text, produce Text:
  Let trimmed be Text.trim(name).
  Return Text.concat("Hi, ", trimmed).
`);
    const func = findDecl(module, 'Func');
    const letStmt = func.body?.statements[0]!;
    assert.equal(letStmt.kind, 'Let');
    assert.equal(letStmt.name, 'trimmed');
    assert.equal(letStmt.expr.kind, 'Call');
  });

  test('应该解析 If 语句并生成 then/else 分支', () => {
    const module = parseSource(`
This module is test.parser.if_stmt.

To classify with score: Int, produce Text:
  If score at least 800:
    Return "Top".
  Otherwise:
    Return "Regular".
`);
    const func = findDecl(module, 'Func');
    const statements = func.body?.statements ?? [];
    const ifStmt = statements.find(
      (statement): statement is Statement & { kind: 'If' } => statement.kind === 'If'
    );
    assert.ok(ifStmt, '应该找到 If 语句');
    assert.equal(ifStmt!.thenBlock.statements[0]!.kind, 'Return');
    assert.equal(ifStmt!.elseBlock?.statements[0]!.kind, 'Return');
  });

  test('应该解析 Match 表达式及其分支', () => {
    const module = parseSource(`
This module is test.parser.match_stmt.

Define User with id: Text, name: Text.

To welcome with user: User?, produce Text:
  Match user:
    When null, Return "Guest".
    When User(id, name), Return Text.concat("Hi ", name).
`);
    const func = findDecl(module, 'Func');
    const matchStmt = func.body?.statements[0]!;
    assert.equal(matchStmt.kind, 'Match');
    const matchExpr = matchStmt as Extract<Statement, { kind: 'Match' }>;
    assert.equal(matchExpr.cases.length, 2);
    assert.equal(matchExpr.cases[1]!.pattern.kind, 'PatternCtor');
  });

  test('应该解析 Start/Wait 异步语句', () => {
    const module = parseSource(`
This module is test.parser.async_stmt.

To runTasks, produce Text. It performs io:
  Start task as async fetch().
  Wait for task.
  Return "done".

To fetch, produce Text:
  Return "ok".
`);
    const func = findDecl(module, 'Func');
    const statements = func.body?.statements ?? [];
    assert.equal(statements[0]!.kind, 'Start');
    assert.equal(statements[1]!.kind, 'Wait');
  });

  test('应该在语法错误时抛出诊断', () => {
    assert.throws(
      () =>
        parseSource(`
This module is test.parser.error.

Define Broken with x: Int
`),
      /expected '.'/i
    );
  });

  describe('边界场景', () => {
    it('应该解析 import 别名并保持调用目标一致', () => {
      const module = parseSource(`
This module is test.parser.import_alias.

Use Http as H.

To call, produce Text:
  Return H.get().
`);
      const importDecl = findDecl(module, 'Import');
      assert.equal(importDecl.name, 'Http');
      assert.equal(importDecl.asName, 'H');

      const func = findFunc(module, 'call');
      assert.ok(func.body, '函数体不能为空');
      if (!func.body) {
        assert.fail('缺少函数体');
      }
      const statement = func.body.statements[0];
      assert.ok(statement, '应该存在函数体语句');
      if (!statement || statement.kind !== 'Return') {
        assert.fail('第一条语句应为 Return');
      }
      const callExpr = statement.expr;
      if (callExpr.kind !== 'Call') {
        assert.fail('Return 表达式应为函数调用');
      }
      assert.equal(callExpr.target.kind, 'Name');
      assert.equal(callExpr.target.name, 'H.get');
    });

    it('应该解析空效果列表与多基础效果组合', () => {
      const module = parseSource(`
This module is test.parser.effects_basic.

To audit, produce Int. It performs [].

To compute with value: Int, produce Int. It performs io and cpu.
`);
      const audit = findFunc(module, 'audit');
      assert.deepEqual(audit.effects, []);
      assert.equal(audit.effectCaps.length, 0);
      assert.equal(audit.effectCapsExplicit, false);

      const compute = findFunc(module, 'compute');
      assert.deepEqual(compute.effects, ['io', 'cpu']);
      assert.deepEqual(compute.effectCaps, [
        CapabilityKind.HTTP,
        CapabilityKind.SQL,
        CapabilityKind.TIME,
        CapabilityKind.FILES,
        CapabilityKind.SECRETS,
        CapabilityKind.AI_MODEL,
        CapabilityKind.CPU,
      ]);
      assert.equal(compute.effectCapsExplicit, false);
    });

    it('应该解析显式 capability 列表并保留效果体', () => {
      const module = parseSource(`
This module is test.parser.effects_explicit.

To fetch, produce Text. It performs io with Http and Sql:
  Return "ok".
`);
      const func = findFunc(module, 'fetch');
      assert.deepEqual(func.effects, ['io']);
      assert.deepEqual(func.effectCaps, [CapabilityKind.HTTP, CapabilityKind.SQL]);
      assert.equal(func.effectCapsExplicit, true);
      assert.ok(func.body, '显式 capability 应允许生成函数体');
    });

    it('应该解析 CNL 约束并保留参数信息', () => {
      const module = parseSource(`
This module is test.parser.constraints.

Define User with
  id: Text required,
  age: Int between 0 and 120 matching "^[0-9]+$".

To validate with input: Text required, produce Bool:
  Return true.
`);
      const data = findDecl(module, 'Data');
      const idField = data.fields[0];
      assert.ok(idField, '应该存在第一个字段');
      if (!idField) {
        assert.fail('缺少第一个字段');
      }
      assert.ok(idField.constraints && idField.constraints.length === 1);
      assert.equal(idField.constraints![0]!.kind, 'Required');

      const ageField = data.fields[1];
      assert.ok(ageField, '应该存在第二个字段');
      if (!ageField) {
        assert.fail('缺少第二个字段');
      }
      assert.ok(ageField.constraints && ageField.constraints.length === 2);
      assert.deepEqual(
        ageField.constraints!.map(c => c.kind),
        ['Range', 'Pattern']
      );
      const rangeConstraint = ageField.constraints![0]!;
      const patternConstraint = ageField.constraints![1]!;
      assert.equal(rangeConstraint.kind, 'Range');
      if (rangeConstraint.kind === 'Range') {
        assert.equal(rangeConstraint.min, 0);
        assert.equal(rangeConstraint.max, 120);
      }
      if (patternConstraint.kind === 'Pattern') {
        assert.equal(patternConstraint.regexp, '^[0-9]+$');
      }

      const func = findFunc(module, 'validate');
      const param = func.params[0];
      assert.ok(param, '函数参数应该存在');
      if (!param) {
        assert.fail('缺少函数参数');
      }
      assert.ok(param.constraints && param.constraints.length === 1);
      assert.equal(param.constraints![0]!.kind, 'Required');
    });

    it('应该解析无类型声明的字段和参数约束', () => {
      const module = parseSource(`
This module is test.parser.inline_constraints.

Define LoanApplication with applicantId required, amount, termMonths between 0 and 600, purpose required.

Define ApplicantProfile with age between 0 and 120, creditScore between 300 and 850, annualIncome.

To determineInterestRateBps with creditScore between 300 and 850, produce:
  Return 350.
`);
      const loanDecl = module.decls.find(
        (decl): decl is Extract<Declaration, { kind: 'Data' }> =>
          decl.kind === 'Data' && decl.name === 'LoanApplication'
      );
      assert.ok(loanDecl, '应该存在 LoanApplication 数据类型');
      if (!loanDecl) assert.fail('缺少 LoanApplication');
      const applicantField = loanDecl.fields.find(f => f.name === 'applicantId');
      assert.ok(applicantField?.constraints?.some(c => c.kind === 'Required'));
      const termMonthsField = loanDecl.fields.find(f => f.name === 'termMonths');
      assert.ok(termMonthsField, '缺少 termMonths 字段');
      if (!termMonthsField) assert.fail('缺少 termMonths 字段');
      const termRange = termMonthsField.constraints?.find(c => c.kind === 'Range');
      assert.ok(termRange, 'termMonths 应有范围约束');
      if (termRange && termRange.kind === 'Range') {
        assert.equal(termRange.min, 0);
        assert.equal(termRange.max, 600);
      }

      const profileDecl = module.decls.find(
        (decl): decl is Extract<Declaration, { kind: 'Data' }> =>
          decl.kind === 'Data' && decl.name === 'ApplicantProfile'
      );
      assert.ok(profileDecl, '应该存在 ApplicantProfile 数据类型');
      if (!profileDecl) assert.fail('缺少 ApplicantProfile');
      const ageField = profileDecl.fields.find(f => f.name === 'age');
      assert.ok(ageField?.constraints?.some(c => c.kind === 'Range'));
      const creditField = profileDecl.fields.find(f => f.name === 'creditScore');
      assert.ok(creditField, '缺少 creditScore 字段');
      if (!creditField) assert.fail('缺少 creditScore 字段');
      const creditRange = creditField.constraints?.find(c => c.kind === 'Range');
      assert.ok(creditRange, 'creditScore 应有范围约束');
      if (creditRange && creditRange.kind === 'Range') {
        assert.equal(creditRange.min, 300);
        assert.equal(creditRange.max, 850);
      }

      const fn = findFunc(module, 'determineInterestRateBps');
      const creditParam = fn.params.find(p => p.name === 'creditScore');
      assert.ok(creditParam, '缺少 creditScore 参数');
      if (!creditParam) assert.fail('缺少 creditScore 参数');
      const paramRange = creditParam.constraints?.find(c => c.kind === 'Range');
      assert.ok(paramRange, 'creditScore 参数应有范围约束');
      if (paramRange && paramRange.kind === 'Range') {
        assert.equal(paramRange.min, 300);
        assert.equal(paramRange.max, 850);
      }
    });

    it('应该在缺失参数分隔符时报告诊断', () => {
      assert.throws(
        () =>
          parseSource(`
This module is test.parser.error.missing_separator.

To broken with first: Int second: Int, produce Int:
  Return first.
`),
        error => {
          assert.match(String(error), /Expected 'produce' and return type/i);
          return true;
        }
      );
    });

    it('应该在括号不匹配时报告诊断', () => {
      assert.throws(
        () =>
          parseSource(`
This module is test.parser.error.parentheses.

To fail with value: Text, produce Text:
  Return (value.
`),
        error => {
          assert.ok(
            String(error).includes("Expected ')' after expression"),
            '诊断信息应该指出括号缺失'
          );
          return true;
        }
      );
    });
  });

  describe('函数类型参数解析', () => {
    test('应该解析单一显式类型参数并绑定到参数类型', () => {
      const module = parseSource(`
This module is test.parser.func_type_params.single.

To wrap of T with value: T, produce List of T:
  Return List.build(value).
`);
      const func = findFunc(module, 'wrap');
      assert.deepEqual(func.typeParams, ['T']);
      const param = func.params[0];
      assert.ok(param, '应该存在第一个参数');
      if (!param) {
        assert.fail('缺少第一个参数');
      }
      assert.equal(param.type.kind, 'TypeVar');
      assert.equal(param.type.name, 'T');
      if (func.retType.kind !== 'List') {
        assert.fail('返回类型应该是 List');
      }
      assert.equal(func.retType.type.kind, 'TypeVar');
      assert.equal(func.retType.type.name, 'T');
    });

    test('应该解析多个显式类型参数并保持顺序', () => {
      const module = parseSource(`
This module is test.parser.func_type_params.multi.

To pair of Left and Right with left: Left and right: Right, produce Result of Left or Right:
  Return Result.ok(left).
`);
      const func = findFunc(module, 'pair');
      assert.deepEqual(func.typeParams, ['Left', 'Right']);
      assert.equal(func.params.length, 2);
      const [leftParam, rightParam] = func.params;
      assert.ok(leftParam, '应该存在第一个参数');
      assert.ok(rightParam, '应该存在第二个参数');
      if (!leftParam || !rightParam) {
        assert.fail('缺少函数参数');
      }
      assert.equal(leftParam.type.kind, 'TypeVar');
      assert.equal(leftParam.type.name, 'Left');
      assert.equal(rightParam.type.kind, 'TypeVar');
      assert.equal(rightParam.type.name, 'Right');
      if (func.retType.kind !== 'Result') {
        assert.fail('返回类型应该是 Result');
      }
      assert.equal(func.retType.ok.kind, 'TypeVar');
      assert.equal(func.retType.ok.name, 'Left');
      assert.equal(func.retType.err.kind, 'TypeVar');
      assert.equal(func.retType.err.name, 'Right');
    });

    test('应该支持逗号与 and 混合的类型参数列表', () => {
      const module = parseSource(`
This module is test.parser.func_type_params.mixed.

To compose of Input, Middle and Output with first: Input, second: Middle, produce Output:
  Return second.
`);
      const func = findFunc(module, 'compose');
      assert.deepEqual(func.typeParams, ['Input', 'Middle', 'Output']);
      const firstParam = func.params[0];
      assert.ok(firstParam, '应该存在第一个参数');
      if (!firstParam) {
        assert.fail('缺少第一个参数');
      }
      assert.equal(firstParam.type.kind, 'TypeVar');
      assert.equal(firstParam.type.name, 'Input');
    });

    test('应该允许类型参数参与复杂返回类型', () => {
      const module = parseSource(`
This module is test.parser.func_type_params.complex.

To pipeline of Source and Target with items: List of Source, produce Result of Map Source to Target or Text:
  Return Result.err("empty").
`);
      const func = findFunc(module, 'pipeline');
      assert.deepEqual(func.typeParams, ['Source', 'Target']);
      const param = func.params[0];
      assert.ok(param, '应该存在 items 参数');
      if (!param) {
        assert.fail('缺少 items 参数');
      }
      if (param.type.kind !== 'List') {
        assert.fail('参数类型应该是 List');
      }
      assert.equal(param.type.type.kind, 'TypeVar');
      assert.equal(param.type.type.name, 'Source');
      if (func.retType.kind !== 'Result') {
        assert.fail('返回类型应该是 Result');
      }
      const okType = func.retType.ok;
      if (okType.kind !== 'Map') {
        assert.fail('Result 成功分支应该是 Map');
      }
      assert.equal(okType.key.kind, 'TypeVar');
      assert.equal(okType.key.name, 'Source');
      assert.equal(okType.val.kind, 'TypeVar');
      assert.equal(okType.val.name, 'Target');
      assert.equal(func.retType.err.kind, 'TypeName');
      assert.equal(func.retType.err.name, 'Text');
    });
  });

  describe('多行参数列表与缩进', () => {
    test('应该解析 with 子句的多行参数', () => {
      const module = parseSource(`
This module is test.parser.params.multiline_with.

To summarize with
  first: Text,
  second: Text,
  third: Text, produce Text:
  Return Text.concat(first, second).
`);
      const func = findFunc(module, 'summarize');
      assert.equal(func.params.length, 3);
      assert.deepEqual(
        func.params.map(param => param.name),
        ['first', 'second', 'third']
      );
    });

    test('应该在多行参数后继续解析效果声明', () => {
      const module = parseSource(`
This module is test.parser.params.multiline_effect.

To compute with
  value: Int,
  factor: Int, produce Int. It performs cpu:
  Return value times factor.
`);
      const func = findFunc(module, 'compute');
      assert.equal(func.params.length, 2);
      assert.deepEqual(
        func.params.map(param => param.name),
        ['value', 'factor']
      );
      assert.deepEqual(func.effects, ['cpu']);
    });

    test('应该在多行参数中保留约束', () => {
      const module = parseSource(`
This module is test.parser.params.multiline_constraints.

To filter with
  query: Text required,
  limit: Int, produce List of Text:
  Return List.empty().
`);
      const func = findFunc(module, 'filter');
      assert.equal(func.params.length, 2);
      const queryParam = func.params[0];
      assert.ok(queryParam, '应该存在 query 参数');
      if (!queryParam) {
        assert.fail('缺少 query 参数');
      }
      assert.ok(queryParam.constraints && queryParam.constraints.length === 1);
      assert.equal(queryParam.constraints![0]!.kind, 'Required');
    });
  });

  describe('Let 内联 lambda 解析', () => {
    test('应该将内联函数解析为 Lambda 节点', () => {
      const module = parseSource(`
This module is test.parser.let.lambda.basic.

To operate with value: Int, produce Int:
  Let increment be function with input: Int, produce Int:
    Return input plus 1.
  Return increment(value).
`);
      const func = findFunc(module, 'operate');
      const statements = func.body?.statements ?? [];
      const letStmt = statements[0];
      assert.ok(letStmt && letStmt.kind === 'Let', '第一条语句应该是 Let');
      if (!letStmt || letStmt.kind !== 'Let') {
        assert.fail('缺少 Let 语句');
      }
      assert.equal(letStmt.expr.kind, 'Lambda');
      const lambda = letStmt.expr;
      assert.equal(lambda.params.length, 1);
      assert.equal(lambda.params[0]!.name, 'input');
    });

    test('应该支持带可选 a function 的写法', () => {
      const module = parseSource(`
This module is test.parser.let.lambda.article.

To demo, produce Int:
  Let noop be a function with value: Int, produce Int:
    Return value.
  Return noop(0).
`);
      const func = findFunc(module, 'demo');
      const statements = func.body?.statements ?? [];
      const letStmt = statements.find(stmt => stmt.kind === 'Let');
      assert.ok(letStmt && letStmt.kind === 'Let', '应该找到 Let 语句');
      if (!letStmt || letStmt.kind !== 'Let') {
        assert.fail('缺少 Let 语句');
      }
      assert.equal(letStmt.expr.kind, 'Lambda');
    });

    test('应该保留 lambda 内部的语句块', () => {
      const module = parseSource(`
This module is test.parser.let.lambda.body.

To compose, produce Int:
  Let combine be function with left: Int and right: Int, produce Int:
    Let sum be left plus right.
    Return sum.
  Return combine(1, 2).
`);
      const func = findFunc(module, 'compose');
      const letStmt = func.body?.statements[0];
      assert.ok(letStmt && letStmt.kind === 'Let', '应该找到内联 lambda');
      if (!letStmt || letStmt.kind !== 'Let') {
        assert.fail('缺少内联 lambda');
      }
      if (letStmt.expr.kind !== 'Lambda') {
        assert.fail('Let 表达式应该是 Lambda');
      }
      assert.equal(letStmt.expr.body.statements.length, 2);
      assert.equal(letStmt.expr.body.statements[0]!.kind, 'Let');
      assert.equal(letStmt.expr.body.statements[1]!.kind, 'Return');
    });
  });

  describe('Set 语句解析', () => {
    test('应该解析基本的赋值语句', () => {
      const module = parseSource(`
This module is test.parser.set.basic.

To update with value: Int, produce Int:
  Let total be 0.
  Set total to total plus value.
  Return total.
`);
      const func = findFunc(module, 'update');
      const statements = func.body?.statements ?? [];
      const setStmt = statements.find(stmt => stmt.kind === 'Set');
      assert.ok(setStmt && setStmt.kind === 'Set', '应该找到 Set 语句');
      if (!setStmt || setStmt.kind !== 'Set') {
        assert.fail('缺少 Set 语句');
      }
      assert.equal(setStmt.name, 'total');
      assert.equal(setStmt.expr.kind, 'Call');
    });

    test('应该在嵌套块中解析 Set 语句', () => {
      const module = parseSource(`
This module is test.parser.set.nested.

To configure, produce Text:
  Within scope:
    Let state be "initial".
    Set state to "ready".
    Return state.
  Return "done".
`);
      const func = findFunc(module, 'configure');
      const statements = func.body?.statements ?? [];
      const blockStmt = statements.find(stmt => stmt.kind === 'Block');
      assert.ok(blockStmt && blockStmt.kind === 'Block', '应该解析 Within scope 块');
      if (!blockStmt || blockStmt.kind !== 'Block') {
        assert.fail('缺少 Within scope 块');
      }
      const innerSet = blockStmt.statements.find(stmt => stmt.kind === 'Set');
      assert.ok(innerSet && innerSet.kind === 'Set', '块内应该包含 Set 语句');
      if (!innerSet || innerSet.kind !== 'Set') {
        assert.fail('缺少块内 Set 语句');
      }
      assert.equal(innerSet.name, 'state');
    });

    test('应该在缺少 to 时抛出诊断', () => {
      assert.throws(
        () =>
          parseSource(`
This module is test.parser.set.error_missing_to.

To broken, produce Int:
  Set total value.
  Return 0.
`),
        error => {
          assert.match(String(error), /Set x to/);
          return true;
        }
      );
    });

    test('应该在缺少结尾句点时抛出诊断', () => {
      assert.throws(
        () =>
          parseSource(`
This module is test.parser.set.error_missing_period.

To broken, produce Int:
  Set total to 1
  Return total.
`),
        error => {
          assert.match(String(error), /Expected '.' at end of statement/);
          return true;
        }
      );
    });
  });

  describe('Return 效果采集', () => {
    test('应该收集 Return 语句后的效果说明', () => {
      const module = parseSource(`
This module is test.parser.return.effects.inline.

To fetch, produce Text:
  Return "ok". It performs io.
`);
      const func = findFunc(module, 'fetch');
      assert.deepEqual(func.effects, ['io']);
      assert.equal(func.effectCapsExplicit, false);
      assert.deepEqual(func.effectCaps, [
        CapabilityKind.HTTP,
        CapabilityKind.SQL,
        CapabilityKind.TIME,
        CapabilityKind.FILES,
        CapabilityKind.SECRETS,
        CapabilityKind.AI_MODEL,
      ]);
    });

    test('应该合并函数体收集的效果', () => {
      const module = parseSource(`
This module is test.parser.return.effects.merge.

To compute, produce Int. It performs cpu:
  Return 1. It performs io.
`);
      const func = findFunc(module, 'compute');
      assert.deepEqual(func.effects, ['cpu', 'io']);
      assert.equal(func.effectCapsExplicit, false);
      assert.deepEqual(func.effectCaps, [
        CapabilityKind.CPU,
        CapabilityKind.HTTP,
        CapabilityKind.SQL,
        CapabilityKind.TIME,
        CapabilityKind.FILES,
        CapabilityKind.SECRETS,
        CapabilityKind.AI_MODEL,
      ]);
    });
  });

  describe('If not 条件', () => {
    test('应该将 If not 条件转换为 not 调用', () => {
      const module = parseSource(`
This module is test.parser.if.not.basic.

To guard with flag: Bool, produce Text:
  If not flag:
    Return "blocked".
  Otherwise:
    Return "ok".
`);
      const func = findFunc(module, 'guard');
      const statements = func.body?.statements ?? [];
      const ifStmt = statements.find(
        (statement): statement is Extract<Statement, { kind: 'If' }> => statement.kind === 'If'
      );
      assert.ok(ifStmt, '应该找到 If 语句');
      if (!ifStmt) {
        assert.fail('缺少 If 语句');
      }
      assert.equal(ifStmt.cond.kind, 'Call');
      if (ifStmt.cond.kind !== 'Call') {
        assert.fail('If 条件应该是调用');
      }
      assert.equal(ifStmt.cond.target.kind, 'Name');
      assert.equal(ifStmt.cond.target.name, 'not');
      assert.equal(ifStmt.cond.args[0]!.kind, 'Name');
      assert.equal((ifStmt.cond.args[0]! as Extract<typeof ifStmt.cond.args[number], { kind: 'Name' }>).name, 'flag');
    });

    test('应该在复合条件中保持原始表达式', () => {
      const module = parseSource(`
This module is test.parser.if.not.complex.

To score with value: Int, produce Text:
  If not (value at least 600):
    Return "retry".
  Otherwise:
    Return "pass".
`);
      const func = findFunc(module, 'score');
      const ifStmt = func.body?.statements.find(
        (statement): statement is Extract<Statement, { kind: 'If' }> => statement.kind === 'If'
      );
      assert.ok(ifStmt, '应该找到 If 语句');
      if (!ifStmt) {
        assert.fail('缺少 If 语句');
      }
      if (ifStmt.cond.kind !== 'Call') {
        assert.fail('条件应该是调用');
      }
      const arg = ifStmt.cond.args[0];
      assert.ok(arg, 'not 调用应该包含参数');
      if (!arg || arg.kind !== 'Call') {
        assert.fail('not 参数应该是调用表达式');
      }
      assert.equal(arg.target.kind, 'Name');
      assert.equal(arg.target.name, '>=');
    });
  });

  describe('List/Map/Result 复杂类型', () => {
    test('应该解析问号表示的 Maybe 类型', () => {
      const module = parseSource(`
This module is test.parser.types.maybe.

To handle with token: Text?, produce Bool:
  Return true.
`);
      const func = findFunc(module, 'handle');
      const param = func.params[0];
      assert.ok(param, '应该存在 token 参数');
      if (!param) {
        assert.fail('缺少 token 参数');
      }
      if (param.type.kind !== 'Maybe') {
        assert.fail('参数类型应该是 Maybe');
      }
      assert.equal(param.type.type.kind, 'TypeName');
      assert.equal(param.type.type.name, 'Text');
    });

    test('应该解析 Option of 与 Maybe 组合', () => {
      const module = parseSource(`
This module is test.parser.types.option.

To parse with payload: Option of Text?, produce Bool:
  Return true.
`);
      const func = findFunc(module, 'parse');
      const param = func.params[0];
      assert.ok(param, '应该存在 payload 参数');
      if (!param) {
        assert.fail('缺少 payload 参数');
      }
      if (param.type.kind !== 'Option') {
        assert.fail('参数类型应该是 Option');
      }
      const inner = param.type.type;
      if (inner.kind !== 'Maybe') {
        assert.fail('Option 内部应该是 Maybe');
      }
      assert.equal(inner.type.kind, 'TypeName');
      assert.equal(inner.type.name, 'Text');
    });

    test('应该解析 Result of 基本组合', () => {
      const module = parseSource(`
This module is test.parser.types.result.

To convert with input: Result of Int or Text, produce Int:
  Return 0.
`);
      const func = findFunc(module, 'convert');
      const param = func.params[0];
      assert.ok(param, '应该存在 input 参数');
      if (!param) {
        assert.fail('缺少 input 参数');
      }
      if (param.type.kind !== 'Result') {
        assert.fail('参数类型应该是 Result');
      }
      assert.equal(param.type.ok.kind, 'TypeName');
      assert.equal(param.type.ok.name, 'Int');
      assert.equal(param.type.err.kind, 'TypeName');
      assert.equal(param.type.err.name, 'Text');
    });

    test('应该解析 List of Map 嵌套类型', () => {
      const module = parseSource(`
This module is test.parser.types.list_map.

To collect with rows: List of Map Text to Int, produce Int:
  Return 0.
`);
      const func = findFunc(module, 'collect');
      const param = func.params[0];
      assert.ok(param, '应该存在 rows 参数');
      if (!param) {
        assert.fail('缺少 rows 参数');
      }
      if (param.type.kind !== 'List') {
        assert.fail('参数类型应该是 List');
      }
      const inner = param.type.type;
      if (inner.kind !== 'Map') {
        assert.fail('List 内部应该是 Map');
      }
      assert.equal(inner.key.kind, 'TypeName');
      assert.equal(inner.key.name, 'Text');
      assert.equal(inner.val.kind, 'TypeName');
      assert.equal(inner.val.name, 'Int');
    });

    test('应该解析自定义类型应用', () => {
      const module = parseSource(`
This module is test.parser.types.type_app_single.

To adapt with response: Text, produce Promise of Text:
  Return Promise.success(response).
`);
      const func = findFunc(module, 'adapt');
      assert.equal(func.retType.kind, 'TypeApp');
      if (func.retType.kind !== 'TypeApp') {
        assert.fail('返回类型应该是 TypeApp');
      }
      assert.equal(func.retType.base, 'Promise');
      assert.equal(func.retType.args.length, 1);
      assert.equal(func.retType.args[0]!.kind, 'TypeName');
      assert.equal(func.retType.args[0]!.name, 'Text');
    });

    test('应该解析多层 List 嵌套', () => {
      const module = parseSource(`
This module is test.parser.types.list_nested.

To flatten with input: List of List of Int, produce List of Int:
  Return input.
`);
      const func = findFunc(module, 'flatten');
      const param = func.params[0];
      assert.ok(param, '应该存在 input 参数');
      if (!param) {
        assert.fail('缺少 input 参数');
      }
      if (param.type.kind !== 'List') {
        assert.fail('参数类型应该是 List');
      }
      const inner = param.type.type;
      if (inner.kind !== 'List') {
        assert.fail('List 内部应该还是 List');
      }
      assert.equal(inner.type.kind, 'TypeName');
      assert.equal(inner.type.name, 'Int');
    });

    test('应该解析带 @pii 注解的类型', () => {
      const module = parseSource(`
This module is test.parser.types.pii.

To secure with field: @pii(L2, email) Text, produce Text:
  Return field.
`);
      const func = findFunc(module, 'secure');
      const param = func.params[0];
      assert.ok(param, '应该存在 field 参数');
      if (!param) {
        assert.fail('缺少 field 参数');
      }
      if (param.type.kind !== 'TypePii') {
        assert.fail('参数类型应该是 TypePii');
      }
      assert.equal(param.type.baseType.kind, 'TypeName');
      assert.equal(param.type.baseType.name, 'Text');
      assert.equal(param.type.sensitivity, 'L2');
      assert.equal(param.type.category, 'email');
    });

    test('应该解析 Map 到 Result 的组合', () => {
      const module = parseSource(`
This module is test.parser.types.map_result.

To inspect with entry: Map Text to Result of Int or Text, produce Bool:
  Return true.
`);
      const func = findFunc(module, 'inspect');
      const param = func.params[0];
      assert.ok(param, '应该存在 entry 参数');
      if (!param) {
        assert.fail('缺少 entry 参数');
      }
      if (param.type.kind !== 'Map') {
        assert.fail('参数类型应该是 Map');
      }
      const valueType = param.type.val;
      if (valueType.kind !== 'Result') {
        assert.fail('Map 值应该是 Result');
      }
      assert.equal(valueType.ok.kind, 'TypeName');
      assert.equal(valueType.ok.name, 'Int');
      assert.equal(valueType.err.kind, 'TypeName');
      assert.equal(valueType.err.name, 'Text');
    });

    test('应该解析 Result of 中嵌套 Option', () => {
      const module = parseSource(`
This module is test.parser.types.result_option.

To decide with payload: Result of Option of Text or List of Text, produce Bool:
  Return true.
`);
      const func = findFunc(module, 'decide');
      const param = func.params[0];
      assert.ok(param, '应该存在 payload 参数');
      if (!param) {
        assert.fail('缺少 payload 参数');
      }
      if (param.type.kind !== 'Result') {
        assert.fail('参数类型应该是 Result');
      }
      const okType = param.type.ok;
      if (okType.kind !== 'Option') {
        assert.fail('Result 成功分支应该是 Option');
      }
      assert.equal(okType.type.kind, 'TypeName');
      assert.equal(okType.type.name, 'Text');
      const errType = param.type.err;
      if (errType.kind !== 'List') {
        assert.fail('Result 失败分支应该是 List');
      }
      assert.equal(errType.type.kind, 'TypeName');
      assert.equal(errType.type.name, 'Text');
    });

    test('应该解析多个参数的类型应用', () => {
      const module = parseSource(`
This module is test.parser.types.type_app_multi.

To choose with picker: Text, produce Either of Text and Int:
  Return Either.left(picker).
`);
      const func = findFunc(module, 'choose');
      assert.equal(func.retType.kind, 'TypeApp');
      if (func.retType.kind !== 'TypeApp') {
        assert.fail('返回类型应该是 TypeApp');
      }
      assert.equal(func.retType.base, 'Either');
      assert.equal(func.retType.args.length, 2);
      assert.equal(func.retType.args[0]!.kind, 'TypeName');
      assert.equal(func.retType.args[0]!.name, 'Text');
      assert.equal(func.retType.args[1]!.kind, 'TypeName');
      assert.equal(func.retType.args[1]!.name, 'Int');
    });
  });

  describe('类型变量作用域', () => {
    test('显式类型参数不会泄漏到后续函数', () => {
      const module = parseSource(`
This module is test.parser.type_scope.explicit.

To first of T with value: T, produce T:
  Return value.

To second with value: T, produce T:
  Return value.
`);
      const firstFunc = findFunc(module, 'first');
      const secondFunc = findFunc(module, 'second');
      assert.deepEqual(firstFunc.typeParams, ['T']);
      assert.deepEqual(Array.from(secondFunc.typeParams).sort(), ['T']);
      const secondParam = secondFunc.params[0];
      assert.ok(secondParam, 'second 应该存在参数');
      if (!secondParam) {
        assert.fail('缺少参数');
      }
      assert.equal(secondParam.type.kind, 'TypeName');
      assert.equal((secondParam.type as Extract<typeof secondParam.type, { kind: 'TypeName' }>).name, 'T');
    });

    test('推断不会误将数据类型视为类型变量', () => {
      const module = parseSource(`
This module is test.parser.type_scope.declared.

Define User with id: Text.

To fetch with id: User, produce User:
  Return User.new(id).
`);
      const func = findFunc(module, 'fetch');
      assert.deepEqual(func.typeParams, []);
      const param = func.params[0];
      assert.ok(param, '应该存在 id 参数');
      if (!param) {
        assert.fail('缺少 id 参数');
      }
      assert.equal(param.type.kind, 'TypeName');
      assert.equal(param.type.name, 'User');
    });

    test('推断的类型变量在不同函数间独立', () => {
      const module = parseSource(`
This module is test.parser.type_scope.independent.

To box with value: Alpha, produce Alpha:
  Return value.

To unwrap with value: Beta, produce Beta:
  Return value.
`);
      const box = findFunc(module, 'box');
      const unwrap = findFunc(module, 'unwrap');
      assert.deepEqual(Array.from(box.typeParams).sort(), ['Alpha']);
      assert.deepEqual(Array.from(unwrap.typeParams).sort(), ['Beta']);
    });
  });

  describe('效果和能力解析', () => {
    test('应该解析带显式能力列表的效果声明', () => {
      const module = parseSource(`
This module is test.parser.effects.explicit_caps.

To fetch, produce Text. It performs io [Http, Sql].
`);
      const func = findFunc(module, 'fetch');
      assert.deepEqual(func.effects, ['io']);
      assert.deepEqual(func.effectCaps, [CapabilityKind.HTTP, CapabilityKind.SQL]);
      assert.equal(func.effectCapsExplicit, true);
    });

    test('应该解析混合效果与显式能力', () => {
      const module = parseSource(`
This module is test.parser.effects.mixed.

To sync, produce Int. It performs io and cpu and Http.
`);
      const func = findFunc(module, 'sync');
      assert.deepEqual(func.effects, ['io', 'cpu']);
      assert.deepEqual(func.effectCaps, [CapabilityKind.HTTP]);
      assert.equal(func.effectCapsExplicit, true);
    });

    test('应该在出现未知能力时抛出诊断', () => {
      assert.throws(
        () =>
          parseSource(`
This module is test.parser.effects.unknown_cap.

To risky, produce Text. It performs io with Blockchain.
`),
        error => {
          assert.match(String(error), /Unknown capability 'Blockchain'/);
          return true;
        }
      );
    });

    test('应该在仅声明 cpu 时推导能力', () => {
      const module = parseSource(`
This module is test.parser.effects.cpu_only.

To crunch, produce Int. It performs cpu.
`);
      const func = findFunc(module, 'crunch');
      assert.deepEqual(func.effects, ['cpu']);
      assert.deepEqual(func.effectCaps, [CapabilityKind.CPU]);
      assert.equal(func.effectCapsExplicit, false);
    });
  });

  describe('其他高优场景', () => {
    test('应该解析 Within scope 块语句', () => {
      const module = parseSource(`
This module is test.parser.misc.within_scope.

To wrap, produce Text:
  Within scope:
    Let temp be "a".
    Return temp.
  Return "done".
`);
      const func = findFunc(module, 'wrap');
      const blockStmt = func.body?.statements?.find(stmt => stmt.kind === 'Block');
      assert.ok(blockStmt && blockStmt.kind === 'Block', '应该找到 Block 语句');
      if (!blockStmt || blockStmt.kind !== 'Block') {
        assert.fail('缺少 Block 语句');
      }
      assert.equal(blockStmt.statements[0]!.kind, 'Let');
      assert.equal(blockStmt.statements[1]!.kind, 'Return');
    });

    test('应该解析 Wait for 多个名称列表', () => {
      const module = parseSource(`
This module is test.parser.misc.wait_many.

To waitAll, produce Text:
  Let taskOne be start().
  Let taskTwo be start().
  Let taskThree be start().
  Wait for taskOne, taskTwo and taskThree.
  Return "ok".
`);
      const func = findFunc(module, 'waitAll');
      const waitStmt = func.body?.statements.find(stmt => stmt.kind === 'Wait');
      assert.ok(waitStmt && waitStmt.kind === 'Wait', '应该找到 Wait 语句');
      if (!waitStmt || waitStmt.kind !== 'Wait') {
        assert.fail('缺少 Wait 语句');
      }
      assert.deepEqual(waitStmt.names, ['taskOne', 'taskTwo', 'taskThree']);
    });

    test('应该解析 await 调用语句', () => {
      const module = parseSource(`
This module is test.parser.misc.await_stmt.

To sync, produce Text:
  Let result be await(fetch()).
  Return result.
`);
      const func = findFunc(module, 'sync');
      const letStmt = func.body?.statements[0];
      assert.ok(letStmt && letStmt.kind === 'Let', '第一条语句应该是 Let');
      if (!letStmt || letStmt.kind !== 'Let') {
        assert.fail('缺少 Let 语句');
      }
      if (letStmt.expr.kind !== 'Call') {
        assert.fail('await 表达式应该解析为 Call');
      }
      assert.equal(letStmt.expr.target.kind, 'Name');
      assert.equal(letStmt.expr.target.name, 'await');
      assert.equal(letStmt.expr.args.length, 1);
    });

    test('应该保留裸调用语句', () => {
      const module = parseSource(`
This module is test.parser.misc.expression_stmt.

To log, produce Text:
  Text.log("started").
  Return "ok".
`);
      const func = findFunc(module, 'log');
      const callStmt = func.body?.statements[0];
      assert.ok(callStmt, '应该存在调用语句');
      if (!callStmt) {
        assert.fail('缺少调用语句');
      }
      assert.equal(callStmt.kind, 'Call');
    });

    test('应该解析 Match 分支中的名称模式', () => {
      const module = parseSource(`
This module is test.parser.misc.match_name.

To unwrap with option: Option of Text, produce Text:
  Match option:
    When value, Return value.
    When null, Return "none".
`);
      const func = findFunc(module, 'unwrap');
      const matchStmt = func.body?.statements.find(stmt => stmt.kind === 'Match');
      assert.ok(matchStmt && matchStmt.kind === 'Match', '应该找到 Match 语句');
      if (!matchStmt || matchStmt.kind !== 'Match') {
        assert.fail('缺少 Match 语句');
      }
      const firstCase = matchStmt.cases[0];
      assert.ok(firstCase, '应该存在首个分支');
      if (!firstCase) {
        assert.fail('缺少首个分支');
      }
      assert.equal(firstCase.pattern.kind, 'PatternName');
      assert.equal(firstCase.pattern.name, 'value');
    });

    test('应该解析 Start 语句的绑定与调用目标', () => {
      const module = parseSource(`
This module is test.parser.misc.start_detail.

To spawn, produce Text:
  Start worker as async Http.fetch().
  Return "done".
`);
      const func = findFunc(module, 'spawn');
      const startStmt = func.body?.statements[0];
      assert.ok(startStmt && startStmt.kind === 'Start', '第一条语句应该是 Start');
      if (!startStmt || startStmt.kind !== 'Start') {
        assert.fail('缺少 Start 语句');
      }
      assert.equal(startStmt.name, 'worker');
      if (startStmt.expr.kind !== 'Call') {
        assert.fail('Start 目标应该是调用');
      }
      assert.equal(startStmt.expr.target.kind, 'Name');
      assert.equal(startStmt.expr.target.name, 'Http.fetch');
    });
  });

  describe('parseWithLexicon 多语言支持', () => {
    test('应该使用 en-US lexicon 直接解析（无翻译）', () => {
      const source = `
This module is test.parser.lexicon.en.

To greet with name: Text, produce Text:
  Return Text.concat("Hello, ", name).
`;
      const canonical = canonicalize(source, EN_US);
      const tokens = lex(canonical, EN_US);
      const module = parseWithLexicon(tokens, EN_US);

      assert.equal(module.name, 'test.parser.lexicon.en');
      const func = findFunc(module, 'greet');
      assert.equal(func.params.length, 1);
      assert.equal(func.params[0]!.name, 'name');
    });

    test('应该使用 zh-CN lexicon 自动翻译并解析', () => {
      const zhSource = `
【模块】测试。

【函数】 identity 包含 value：整数，产出：
  返回 value。
`;
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const module = parseWithLexicon(tokens, ZH_CN);

      assert.ok(module, '应该成功解析中文 CNL');
      assert.equal(module.name, '测试');

      const func = findFunc(module, 'identity');
      assert.equal(func.params.length, 1);
      assert.equal(func.params[0]!.name, 'value');
      assert.equal(func.retType.kind, 'TypeName');
    });

    test('应该解析中文 CNL 的类型定义', () => {
      const zhSource = `
【模块】测试。

【定义】 User 包含 age：整数。
`;
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const module = parseWithLexicon(tokens, ZH_CN);

      const dataDef = module.decls.find(d => d.kind === 'Data');
      assert.ok(dataDef && dataDef.kind === 'Data', '应该找到 Data 定义');
      if (!dataDef || dataDef.kind !== 'Data') {
        assert.fail('缺少 Data 定义');
      }
      assert.equal(dataDef.name, 'User');
      assert.equal(dataDef.fields.length, 1);
      assert.equal(dataDef.fields[0]!.name, 'age');
    });

    test('应该解析中文 CNL 的 If 语句', () => {
      const zhSource = `
【模块】测试。

【函数】 check 包含 x：整数，产出：
  如果 x 大于 0：
    返回 1。
  否则：
    返回 0。
`;
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const module = parseWithLexicon(tokens, ZH_CN);

      const func = findFunc(module, 'check');
      const statements = func.body?.statements ?? [];
      const ifStmt = statements.find(s => s.kind === 'If');
      assert.ok(ifStmt && ifStmt.kind === 'If', '应该找到 If 语句');
      if (!ifStmt || ifStmt.kind !== 'If') {
        assert.fail('缺少 If 语句');
      }
      assert.ok(ifStmt.elseBlock, '应该有 else 分支');
    });

    test('应该解析中文 CNL 的 Match 语句（若...为）', () => {
      const zhSource = `
【模块】测试。

【函数】 describe 包含 status：整数，产出：
  若 status：
    为 1，返回 「成功」。
    为 0，返回 「失败」。
`;
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const module = parseWithLexicon(tokens, ZH_CN);

      const func = findFunc(module, 'describe');
      const statements = func.body?.statements ?? [];
      const matchStmt = statements.find(s => s.kind === 'Match');
      assert.ok(matchStmt && matchStmt.kind === 'Match', '应该找到 Match 语句');
      if (!matchStmt || matchStmt.kind !== 'Match') {
        assert.fail('缺少 Match 语句');
      }
      assert.equal(matchStmt.cases.length, 2, '应该有 2 个 case');
    });

    test('应该解析中文 CNL 的 Let...为 语句', () => {
      const zhSource = `
【模块】测试。

【函数】 calc 包含 x：整数，产出：
  令 result 为 x 加 1。
  返回 result。
`;
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const module = parseWithLexicon(tokens, ZH_CN);

      const func = findFunc(module, 'calc');
      const statements = func.body?.statements ?? [];
      const letStmt = statements.find(s => s.kind === 'Let');
      assert.ok(letStmt && letStmt.kind === 'Let', '应该找到 Let 语句');
      if (!letStmt || letStmt.kind !== 'Let') {
        assert.fail('缺少 Let 语句');
      }
      assert.equal(letStmt.name, 'result');
    });
  });
});
