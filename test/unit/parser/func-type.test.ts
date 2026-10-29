/**
 * 函数类型语法 `(T1, T2) -> R` 与括号类型 `(T)`（aster-lang-ts#247）。
 *
 * 与 aster-lang-core 文法对齐（AsterParser.g4 `type`）：
 *   LPAREN typeList RPAREN ARROW type   # FuncType —— 至少一个参数，`?` 作用于返回类型
 *   LPAREN type RPAREN                  # ParenType —— 直接返回内部类型
 * Java 的 Core IR 为 `{kind:'FuncType', params, ret}`（不带 effects），这里逐字段对齐。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { compile, compileAndTypecheck } from '../../../src/browser.js';
import { formatCNL } from '../../../src/formatter.js';
import { Node } from '../../../src/ast/ast.js';
import { Core as CoreCtor } from '../../../src/core/core_ir.js';
import type { Core, Func, Module, Type } from '../../../src/types.js';

function parseModule(source: string): { ast: Module; errors: string[] } {
  const r = parse(lex(canonicalize(source)));
  return { ast: r.ast, errors: r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message) };
}

/** 去掉 span，只看类型结构 */
function shape(t: Type | Core.Type): unknown {
  return JSON.parse(JSON.stringify(t, (k, v) => (k === 'span' || k === 'origin' ? undefined : v)));
}

function paramType(source: string, index = 0): Type {
  const { ast, errors } = parseModule(source);
  assert.deepEqual(errors, [], source);
  return (ast.decls.find((d) => d.kind === 'Func') as Func).params[index]!.type;
}

const ruleWith = (type: string) => `Module m.\n\nRule apply given f as ${type}, produce Int:\n  Return 1.\n`;
const T = (name: string) => ({ kind: 'TypeName', name });

describe('FuncType 解析', () => {
  it('单参数与多参数', () => {
    assert.deepEqual(shape(paramType(ruleWith('(Int) -> Int'))), { kind: 'FuncType', params: [T('Int')], ret: T('Int') });
    assert.deepEqual(shape(paramType(ruleWith('(Int, Text) -> Bool'))),
      { kind: 'FuncType', params: [T('Int'), T('Text')], ret: T('Bool') });
  });

  it('Java 用例：given f as (Int, Int) -> Int and x as Int', () => {
    const src = 'Module m.\n\nRule apply given f as (Int, Int) -> Int and x as Int:\n  Return f(x, x).\n';
    assert.equal(paramType(src, 0).kind, 'FuncType');
    assert.deepEqual(shape(paramType(src, 1)), T('Int'));
  });

  it('`?` 作用于返回类型；括号包住整个函数类型时作用于函数类型', () => {
    assert.deepEqual(shape(paramType(ruleWith('(Int) -> Int?'))),
      { kind: 'FuncType', params: [T('Int')], ret: { kind: 'Maybe', type: T('Int') } });
    assert.deepEqual(shape(paramType(ruleWith('((Int) -> Int)?'))),
      { kind: 'Maybe', type: { kind: 'FuncType', params: [T('Int')], ret: T('Int') } });
  });

  it('嵌套：返回函数类型、参数是函数类型、作为 list 元素', () => {
    assert.deepEqual(shape(paramType(ruleWith('(Int) -> (Int) -> Int'))), {
      kind: 'FuncType', params: [T('Int')], ret: { kind: 'FuncType', params: [T('Int')], ret: T('Int') },
    });
    assert.deepEqual(shape(paramType(ruleWith('((Int) -> Int, Int) -> Int'))), {
      kind: 'FuncType', params: [{ kind: 'FuncType', params: [T('Int')], ret: T('Int') }, T('Int')], ret: T('Int'),
    });
    assert.deepEqual(shape(paramType(ruleWith('list of (Int) -> Int'))), {
      kind: 'List', type: { kind: 'FuncType', params: [T('Int')], ret: T('Int') },
    });
  });

  it('参数可带 @pii 注解', () => {
    assert.deepEqual(shape(paramType(ruleWith('(@pii(L2, email) Text) -> Bool'))), {
      kind: 'FuncType',
      params: [{ kind: 'TypePii', baseType: T('Text'), sensitivity: 'L2', category: 'email' }],
      ret: T('Bool'),
    });
  });

  it('返回位置与别名目标', () => {
    const { ast, errors } = parseModule('Module m.\n\nType Fn as (Int) -> Int.\n\nRule mk, produce (Int) -> Int:\n  Return 1.\n');
    assert.deepEqual(errors, []);
    assert.equal(ast.typeAliasDecls?.[0]?.type.kind, 'FuncType');
    assert.equal((ast.decls[0] as Func).retType.kind, 'FuncType');
  });

  it('函数类型的 span 从 `(` 到返回类型', () => {
    const t = paramType('Module m.\n\nRule apply given f as (Int) -> Text, produce Int:\n  Return 1.\n');
    assert.deepEqual(t.span, { start: { line: 3, col: 23 }, end: { line: 3, col: 36 } });
  });

  it('括号类型 `(Int)` 即内部类型（Java ParenType）', () => {
    assert.deepEqual(shape(paramType(ruleWith('(Int)'))), T('Int'));
    assert.deepEqual(shape(paramType(ruleWith('(list of Text)'))), { kind: 'List', type: T('Text') });
  });
});

describe('FuncType 解析错误', () => {
  const errorsOf = (type: string) => parseModule(ruleWith(type)).errors;

  it('零参数 `() -> Int` 报错（Java typeList 非空）', () => {
    assert.notDeepEqual(errorsOf('() -> Int'), []);
  });

  it('`-` 与 `>` 不相邻时不是箭头', () => {
    assert.notDeepEqual(errorsOf('(Int) - > Int'), []);
  });

  it('多个类型却没有箭头、缺 `)`、缺返回类型都报错', () => {
    for (const bad of ['(Int, Text)', '(Int -> Int', '(Int) ->', '(Int) -> , ']) {
      assert.notDeepEqual(errorsOf(bad), [], bad);
    }
  });

  it('带注解的括号类型不是合法写法（Java ParenType 内部是 type，不含注解）', () => {
    assert.notDeepEqual(errorsOf('(@pii(L2, email) Text)'), []);
  });

  it('超深嵌套走递归护栏，报可读诊断而不是栈溢出', () => {
    const deep = '('.repeat(2000) + 'Int' + ')'.repeat(2000);
    const errs = errorsOf(deep);
    assert.ok(errs.some((m) => /nesting too deep/i.test(m)), JSON.stringify(errs.slice(0, 2)));
  });
});

describe('FuncType 降级到 Core IR', () => {
  it('Node.FuncType 构造器', () => {
    const t = Node.FuncType([Node.TypeName('Int')], Node.TypeName('Bool'));
    assert.deepEqual(shape(t), { kind: 'FuncType', params: [T('Int')], ret: T('Bool') });
    assert.deepEqual(CoreCtor.FuncType([CoreCtor.TypeName('Int')], CoreCtor.TypeName('Bool')),
      { kind: 'FuncType', params: [T('Int')], ret: T('Bool') });
  });

  it('签名中的 FuncType：{kind, params, ret}，不带 effects', () => {
    const { ast } = parseModule('Module m.\n\nRule apply given f as (Int, Text) -> Bool, produce (Int) -> Int?:\n  Return 1.\n');
    const fn = lowerModule(ast).decls[0] as Core.Func;
    assert.deepEqual(shape(fn.params[0]!.type), { kind: 'FuncType', params: [T('Int'), T('Text')], ret: T('Bool') });
    assert.deepEqual(shape(fn.ret), { kind: 'FuncType', params: [T('Int')], ret: { kind: 'Maybe', type: T('Int') } });
    assert.deepEqual(Object.keys(fn.params[0]!.type).sort(), ['kind', 'params', 'ret']);
  });

  it('类型参数在 FuncType 内仍降为 TypeVar', () => {
    const { ast } = parseModule('Module m.\n\nRule apply of T given f as (T) -> T and x as T, produce T:\n  Return f(x).\n');
    const fn = lowerModule(ast).decls[0] as Core.Func;
    assert.deepEqual(shape(fn.params[0]!.type),
      { kind: 'FuncType', params: [{ kind: 'TypeVar', name: 'T' }], ret: { kind: 'TypeVar', name: 'T' } });
  });

  it('函数体中的 FuncType（lambda 参数 / Let 标注）经 lowerType 降级并带 origin', () => {
    const src = 'Module m.\n\nRule mk, produce Int:\n  Let g be function with h as (Int) -> Int, produce Int:\n    Return h(1).\n  Return 1.\n';
    const r = compile(src);
    assert.equal(r.success, true, JSON.stringify(r.parseErrors ?? r.loweringErrors));
    const json = JSON.stringify(r.core);
    assert.match(json, /"kind":"FuncType","params":\[\{"kind":"TypeName","name":"Int"/);
  });

  it('★compile() 端到端：参数、返回、别名三种位置都能编译', () => {
    for (const src of [
      'Module m.\n\nRule apply given f as (Int) -> Int and x as Int, produce Int:\n  Return f(x).\n',
      'Module m.\n\nRule pick given n as Int, produce (Int) -> Int:\n  Let g be function with x as Int, produce Int:\n    Return x plus n.\n  Return g.\n',
      'Module m.\n\nType Op as (Int, Int) -> Int.\n\nRule run given op as Op, produce Int:\n  Return op(1, 2).\n',
    ]) {
      const r = compile(src);
      assert.equal(r.success, true, `${src}\n${JSON.stringify(r.parseErrors ?? r.loweringErrors ?? r.resolutionDiagnostics)}`);
    }
  });

  it('作为参数在函数体内调用可通过类型检查', () => {
    const r = compileAndTypecheck('Module m.\n\nRule apply given f as (Int) -> Int and x as Int, produce Int:\n  Return f(x).\n');
    assert.equal(r.success, true);
    assert.deepEqual(r.typeErrors.filter((d) => d.severity === 'error').map((d) => d.message), []);
  });
});

describe('FuncType 格式化往返', () => {
  it('参数、返回与别名位置的函数类型原样保留且幂等', () => {
    const src = 'Module m.\n\nType Op as (Int, Int) -> Int.\n\nRule apply given f as (Int) -> Int?, g as ((Int) -> Int, Text) -> Bool, produce (Int) -> Int:\n  Return f.\n';
    const formatted = formatCNL(src);
    assert.match(formatted, /^Type Op as \(Int, Int\) -> Int\.$/m);
    assert.match(formatted, /given f as \(Int\) -> Int\?, g as \(\(Int\) -> Int, Text\) -> Bool, produce \(Int\) -> Int:/);
    assert.equal(formatCNL(formatted), formatted);
    const strip = (s: string) => shape(parseModule(s).ast as unknown as Type);
    assert.deepEqual(JSON.parse(JSON.stringify(strip(formatted), (k, v) => (/Spans?$/.test(k) ? undefined : v))),
      JSON.parse(JSON.stringify(strip(src), (k, v) => (/Spans?$/.test(k) ? undefined : v))));
  });

  it('Maybe 包住的函数类型打印时加括号', () => {
    const src = ruleWith('((Int) -> Int)?');
    const formatted = formatCNL(src);
    assert.match(formatted, /given f as \(\(Int\) -> Int\)\?/);
    assert.deepEqual(shape(paramType(formatted)), shape(paramType(src)));
  });
});
