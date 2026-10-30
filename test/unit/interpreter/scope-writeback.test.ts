/**
 * 块作用域写回语义（aster-cloud/aster-lang-truffle#151，ADR 0052）。
 *
 * `Set x` 写到 `x` 最近的那层绑定：在 case 体、Scope、If 分支里给外层 Let 赋值，离开该块后仍可见；
 * 块内 `Let` 只在块内可见，可遮蔽外层，离开后外层绑定不受影响。与 aster-lang-truffle 的 Env 写冒泡一致。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../../src/core/interpreter.js';
import { compile } from '../../../src/browser.js';
import type { Core } from '../../../src/types.js';

const INT: Core.Type = { kind: 'TypeName', name: 'Int' };

function mkFunc(name: string, params: string[], body: Core.Statement[]): Core.Func {
  return {
    kind: 'Func',
    name,
    typeParams: [],
    params: params.map((p) => ({ name: p, type: INT })),
    ret: INT,
    effects: [],
    effectCaps: [],
    effectCapsExplicit: false,
    body: { kind: 'Block', statements: body },
  };
}

function run(body: Core.Statement[], params: string[] = [], input: Record<string, unknown> = {}): unknown {
  const mod: Core.Module = { kind: 'Module', name: 'test', decls: [mkFunc('f', params, body)] };
  const result = evaluate(mod, 'f', input);
  assert.ok(result.success, result.error);
  return result.value;
}

const int = (value: number): Core.Int => ({ kind: 'Int', value });
const name = (n: string): Core.Name => ({ kind: 'Name', name: n });
const plus = (a: Core.Expression, b: Core.Expression): Core.Call => ({ kind: 'Call', target: name('+'), args: [a, b] });
const letS = (n: string, expr: Core.Expression): Core.Let => ({ kind: 'Let', name: n, expr });
const setS = (n: string, expr: Core.Expression): Core.Set => ({ kind: 'Set', name: n, expr });
const ret = (expr: Core.Expression): Core.Return => ({ kind: 'Return', expr });
const scope = (statements: Core.Statement[]): Core.Scope => ({ kind: 'Scope', statements });
const block = (statements: Core.Statement[]): Core.Block => ({ kind: 'Block', statements });
const caseOf = (pattern: Core.Pattern, body: Core.Statement[]): Core.Case => ({ kind: 'Case', pattern, body: block(body) });
const match = (expr: Core.Expression, cases: Core.Case[]): Core.Match => ({ kind: 'Match', expr, cases });

describe('块作用域写回（Core IR）', () => {
  it('Scope 内 Set 外层 Let：离开 Scope 后可见', () => {
    assert.equal(run([letS('x', int(1)), scope([setS('x', int(2))]), ret(name('x'))]), 2);
  });

  it('嵌套 Scope 内 Set 外层 Let：写到定义层', () => {
    assert.equal(
      run([letS('x', int(1)), scope([letS('y', int(10)), scope([setS('x', plus(name('x'), name('y')))])]), ret(name('x'))]),
      11,
    );
  });

  it('嵌套 Scope 内 Set 中间层 Let：中间层可见，外层同名不受影响', () => {
    assert.equal(
      run([
        letS('x', int(1)),
        scope([letS('x', int(100)), scope([setS('x', int(200))]), setS('x', plus(name('x'), int(1)))]),
        ret(name('x')),
      ]),
      1,
    );
  });

  it('Scope 内 Let 遮蔽外层后 Set：只改块内绑定，外层恢复', () => {
    assert.equal(run([letS('x', int(1)), scope([letS('x', int(5)), setS('x', int(6))]), ret(name('x'))]), 1);
  });

  it('Scope 内 Let 新名字：离开后不可见', () => {
    const mod: Core.Module = {
      kind: 'Module',
      name: 'test',
      decls: [mkFunc('f', [], [scope([letS('z', int(1))]), ret(name('z'))])],
    };
    const result = evaluate(mod, 'f', {});
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Undefined variable 'z'/);
  });

  it('case 体内 Set 外层 Let：离开 match 后可见', () => {
    const body = [
      letS('total', int(0)),
      match(name('n'), [
        caseOf({ kind: 'PatInt', value: 1 }, [setS('total', int(10))]),
        caseOf({ kind: 'PatName', name: 'other' }, [setS('total', plus(name('total'), name('other')))]),
      ]),
      ret(name('total')),
    ];
    assert.equal(run(body, ['n'], { n: 1 }), 10);
    assert.equal(run(body, ['n'], { n: 7 }), 7);
  });

  it('case 体内的模式绑定与 Let 不泄漏到 match 之后', () => {
    const mod: Core.Module = {
      kind: 'Module',
      name: 'test',
      decls: [mkFunc('f', ['n'], [
        match(name('n'), [caseOf({ kind: 'PatName', name: 'other' }, [letS('t', name('other'))])]),
        ret(name('other')),
      ])],
    };
    const result = evaluate(mod, 'f', { n: 3 });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Undefined variable 'other'/);
  });

  it('If / else 分支内 Set 外层 Let：两条分支都写回', () => {
    const body: Core.Statement[] = [
      letS('r', int(0)),
      {
        kind: 'If',
        cond: { kind: 'Call', target: name('>'), args: [name('n'), int(0)] },
        thenBlock: block([setS('r', int(1))]),
        elseBlock: block([setS('r', int(-1))]),
      },
      ret(name('r')),
    ];
    assert.equal(run(body, ['n'], { n: 5 }), 1);
    assert.equal(run(body, ['n'], { n: -5 }), -1);
  });

  it('Scope 内的 case 体 Set 外层 Let：跨两层块写回', () => {
    const body = [
      letS('acc', int(1)),
      scope([match(name('n'), [caseOf({ kind: 'PatInt', value: 2 }, [setS('acc', plus(name('acc'), int(41)))])])]),
      ret(name('acc')),
    ];
    assert.equal(run(body, ['n'], { n: 2 }), 42);
  });

  it('闭包捕获的是定义时的快照：之后的 Set 不影响已创建的闭包', () => {
    const lambda: Core.Lambda = {
      kind: 'Lambda',
      params: [],
      ret: INT,
      body: block([ret(name('x'))]),
      captures: ['x'],
    } as unknown as Core.Lambda;
    const body: Core.Statement[] = [
      letS('x', int(1)),
      letS('g', lambda),
      scope([setS('x', int(2))]),
      ret(plus({ kind: 'Call', target: name('g'), args: [] }, name('x'))),
    ];
    assert.equal(run(body), 3);
  });
});

describe('块作用域写回（源码端到端）', () => {
  it('case 体内 Set 外层 Let 后返回写回值', () => {
    const source = [
      'Module m.',
      '',
      'Rule r given n as Int, produce Int:',
      '  Let total be 0.',
      '  Match n:',
      '    When 1,',
      '      Set total to 10.',
      '    When 2,',
      '      Set total to total plus 20.',
      '  Return total.',
      '',
    ].join('\n');
    const compiled = compile(source);
    assert.ok(compiled.success && compiled.core, JSON.stringify(compiled.parseErrors ?? compiled.resolutionDiagnostics));
    assert.equal(evaluate(compiled.core, 'r', { n: 1 }).value, 10);
    assert.equal(evaluate(compiled.core, 'r', { n: 2 }).value, 20);
    assert.equal(evaluate(compiled.core, 'r', { n: 3 }).value, 0);
  });
});
