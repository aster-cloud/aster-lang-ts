/**
 * 规则引用作为函数值（#256）：`twice(inc, n)` 把模块规则 inc 当作函数值传给高阶规则。
 *
 * 语言语义早已允许（ADR 0024：具名规则可作 List.map 的 fn 参数；ADR 0051 §4 名称位置表把
 * 「函数值引用」列为 FUNC_REF），Java 引擎也已支持：
 *   - typecheck：TypeChecker.defineFunctionSignature 把全部函数签名以 FuncType 登记进模块作用域，
 *     值位置的 Name 照常查到；
 *   - 运行期：truffle Loader 把每个函数以 LambdaValue 放进 env，Name 回退到 env 即得到可调用值。
 * TS 只在 List.* 等 stdlib 回调里特判了函数名，typecheck 报 E101、解释器报 Undefined variable。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAndTypecheck, evaluate, EN_US } from '../../src/browser.js';
import { typecheckBrowser } from '../../src/typecheck/browser.js';
import type { Core } from '../../src/types.js';

const INC = 'Rule inc given x as Int, produce Int:\n  Return x plus 1.\n\n';
const TWICE = 'Rule twice given f as (Int) -> Int, n as Int, produce Int:\n  Return f(f(n)).\n\n';

function compileClean(body: string): Core.Module {
  const r = compileAndTypecheck(`Module demo.\n\n${body}`, { lexicon: EN_US });
  const errors = [...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? []), ...(r.typeErrors ?? [])]
    .filter((d) => (d as { severity?: string }).severity === 'error');
  assert.deepEqual(errors, []);
  assert.equal(r.success, true);
  return r.core!;
}

function run(core: Core.Module, func: string, input: Record<string, unknown>): unknown {
  const r = evaluate(core, func, input);
  assert.equal(r.success, true, r.error);
  return r.value;
}

describe('规则引用作为函数值', () => {
  it('★twice(inc, n)：无 E101，求值得 n + 2', () => {
    const core = compileClean(INC + TWICE + 'Rule main given n as Int, produce Int:\n  Return twice(inc, n).\n');
    assert.equal(run(core, 'main', { n: 1 }), 3);
  });

  it('规则声明在使用之后（前向引用）同样可用', () => {
    const core = compileClean(TWICE + 'Rule main given n as Int, produce Int:\n  Return twice(inc, n).\n\n' + INC);
    assert.equal(run(core, 'main', { n: 5 }), 7);
  });

  it('Let g be inc：绑定后按局部名调用', () => {
    const core = compileClean(INC + 'Rule main given n as Int, produce Int:\n  Let g be inc.\n  Return g(n).\n');
    assert.equal(run(core, 'main', { n: 41 }), 42);
  });

  it('函数值的静态类型为规则签名的 FuncType：经局部名调用的结果类型为返回类型（返回类型不符照常报错）', () => {
    const r = compileAndTypecheck(
      `Module demo.\n\n${INC}Rule main given n as Int, produce Text:\n  Let g be inc.\n  Return g(n).\n`,
      { lexicon: EN_US },
    );
    const codes = (r.typeErrors ?? []).filter((d) => d.severity === 'error').map((d) => d.code);
    assert.ok(codes.length > 0, '返回 Int 却声明 Text，应报类型错误');
    assert.ok(!codes.includes('E101' as never), `不应报 E101：${codes}`);
  });

  it('局部名遮蔽同名规则：参数 inc 优先于模块规则 inc', () => {
    const core = compileClean(
      INC + TWICE +
      'Rule dec given x as Int, produce Int:\n  Return x minus 1.\n\n' +
      'Rule viaParam given inc as (Int) -> Int, n as Int, produce Int:\n  Return twice(inc, n).\n\n' +
      'Rule main given n as Int, produce Int:\n  Return viaParam(dec, n).\n',
    );
    assert.equal(run(core, 'main', { n: 10 }), 8);
  });

  it('局部函数值遮蔽同名规则时，调用个数按局部值而非规则签名校验', () => {
    compileClean(
      'Rule pair given a as Int, b as Int, produce Int:\n  Return a plus b.\n\n' +
      'Rule main given pair as (Int) -> Int, n as Int, produce Int:\n  Return pair(n).\n',
    );
  });

  it('★经函数值局部名调用时校验参数个数：`Let g be inc. Return g(n, n).` 报 E032（Java 报 TYPE_MISMATCH 拒绝）', () => {
    const r = compileAndTypecheck(`Module demo.\n\n${INC}Rule main given n as Int, produce Int:\n  Let g be inc.\n  Return g(n, n).\n`, { lexicon: EN_US });
    const arity = (r.typeErrors ?? []).filter((d) => d.code === 'E032');
    assert.equal(arity.length, 1, JSON.stringify(r.typeErrors));
    assert.deepEqual(arity[0]!.data, { func: 'g', expected: 1, actual: 2 });
  });

  it('函数类型参数调用个数不符同样报 E032', () => {
    const r = compileAndTypecheck(`Module demo.\n\nRule apply given f as (Int) -> Int, n as Int, produce Int:\n  Return f().\n`, { lexicon: EN_US });
    assert.deepEqual((r.typeErrors ?? []).filter((d) => d.code === 'E032').map((d) => d.data), [{ func: 'f', expected: 1, actual: 0 }]);
  });

  it('未声明的名字仍被拒绝（名称解析报 E802，不产出 IR）', () => {
    const r = compileAndTypecheck(`Module demo.\n\n${TWICE}Rule main given n as Int, produce Int:\n  Return twice(nope, n).\n`, { lexicon: EN_US });
    assert.equal(r.success, false);
    assert.deepEqual((r.resolutionDiagnostics ?? []).map((d) => d.code), ['E802']);
  });

  it('typecheck 层：Core 中未定义的值名仍报 E101（函数签名回退不吞掉未定义名）', () => {
    const core = compileClean(INC + 'Rule main given n as Int, produce Int:\n  Return inc(n).\n');
    const main = core.decls.find((d): d is Core.Func => d.kind === 'Func' && d.name === 'main')!;
    const ret = main.body.statements[0] as Core.Return;
    const call = ret.expr as Core.Call;
    const broken = { ...core, decls: core.decls.map((d) => (d === main ? { ...main, body: { ...main.body, statements: [{ ...ret, expr: { ...call, args: [{ ...call.args[0]!, name: 'nope' }] } }] } } : d)) };
    const diags = typecheckBrowser(broken as Core.Module);
    assert.ok(diags.some((d) => d.code === 'E101' && d.message.includes('nope')), JSON.stringify(diags));
  });

  it('List.map(xs, inc) 的既有行为不变', () => {
    const core = compileClean(INC + 'Rule main given xs as List of Int, produce List of Int:\n  Return List.map(xs, inc).\n');
    assert.deepEqual(run(core, 'main', { xs: [1, 2] }), [2, 3]);
  });
});
