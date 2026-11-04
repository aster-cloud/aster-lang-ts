/**
 * 用户规则调用的静态检查与运行期调用目标（#266 #268）。
 *
 * #266：调用本模块规则或函数值局部名时，按**显式写了类型**的形参比较实参类型，不符报 E001
 *   （与 Java BaseTypeChecker.checkCall 同码）。未写类型的形参（解析器按名字推断出类型，
 *   `typeInferred`）不参与比较——推断类型只是猜测，两引擎当前都接受这类调用。
 * #268：调用目标解析与 Java/truffle 一致——局部名遮蔽同名规则。局部名类型已知且不是函数类型时
 *   报 E001（期望函数）；TS 解释器同样按局部名分派，不再悄悄改调同名规则。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAndTypecheck, evaluate, EN_US } from '../../src/browser.js';
import type { Core } from '../../src/types.js';

const INC = 'Rule inc given x as Int, produce Int:\n  Return x plus 1.\n\n';
const GREET = 'Rule greet given name as Text, produce Text:\n  Return name.\n\n';
const TWICE = 'Rule twice given f as (Int) -> Int, n as Int, produce Int:\n  Return f(f(n)).\n\n';

interface Diag { severity?: string; code: string; message: string; data?: unknown }

function check(body: string): { errors: Diag[]; core: Core.Module | undefined } {
  const r = compileAndTypecheck(`Module demo.\n\n${body}`, { lexicon: EN_US });
  const errors = [...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? []), ...(r.typeErrors ?? [])]
    .filter((d) => (d as Diag).severity === 'error') as Diag[];
  return { errors, core: r.core };
}

function mismatches(errors: readonly Diag[]): unknown[] {
  return errors.filter((d) => d.code === 'E001').map((d) => d.data);
}

describe('#266 用户规则调用的实参类型', () => {
  it('★inc("a")：形参 Int、实参 Text，报 E001', () => {
    const { errors } = check(INC + 'Rule main given n as Int, produce Int:\n  Return inc("a").\n');
    assert.deepEqual(mismatches(errors), [{ expected: 'Int', actual: 'Text' }]);
  });

  it('经函数值局部名调用同样比较：Let g be inc. Return g("a").', () => {
    const { errors } = check(INC + 'Rule main given n as Int, produce Int:\n  Let g be inc.\n  Return g("a").\n');
    assert.deepEqual(mismatches(errors), [{ expected: 'Int', actual: 'Text' }]);
  });

  it('函数值实参与函数类型形参不符：twice(greet, n) 报 E001', () => {
    const { errors } = check(GREET + TWICE + 'Rule main given n as Int, produce Int:\n  Return twice(greet, n).\n');
    assert.deepEqual(mismatches(errors), [{ expected: '(Int) -> Int', actual: '(Text) -> Text' }]);
  });

  it('类型相符不报错：inc(n)、twice(inc, n)', () => {
    const { errors } = check(INC + TWICE + 'Rule main given n as Int, produce Int:\n  Return twice(inc, inc(n)).\n');
    assert.deepEqual(errors, []);
  });

  it('★未写类型的形参不比较：greet given name 推断为 Text，传 Int 不报错', () => {
    const { errors } = check(
      'Rule label given amount, produce Text:\n  Return "x".\n\n' +
      'Rule main given n as Int, produce Text:\n  Return label("a").\n',
    );
    assert.deepEqual(errors, []);
  });

  it('未写类型的形参经函数值传递也不比较：twice(bump, n) 不因推断类型报错', () => {
    const { errors } = check(
      'Rule bump given amount, produce Int:\n  Return 1.\n\n' + TWICE +
      'Rule main given n as Int, produce Int:\n  Return twice(bump, n).\n',
    );
    assert.deepEqual(mismatches(errors), []);
  });

  it('lambda 函数值：显式类型形参比较，未写类型的形参不比较', () => {
    const typed = check('Rule main given n as Int, produce Int:\n  Let f be function with x as Int, produce Int:\n    Return x.\n  Return f("a").\n');
    assert.deepEqual(mismatches(typed.errors), [{ expected: 'Int', actual: 'Text' }]);
    const untyped = check('Rule main given flag as Bool, produce Int:\n  Let f be function with x, produce:\n    Return 1.\n  Return f(flag).\n');
    assert.deepEqual(mismatches(untyped.errors), []);
  });

  it('Int 实参传给 Float 形参按数值提升放行（与字段构造的 isAssignable 一致）', () => {
    const { errors } = check(
      'Rule half given x as Float, produce Float:\n  Return x.\n\n' +
      'Rule main given n as Int, produce Float:\n  Return half(n).\n',
    );
    assert.deepEqual(mismatches(errors), []);
  });

  it('函数类型形参位按逆变比较：期望 (Int) -> Int 时可传 (Float) -> Int', () => {
    const { errors } = check(
      'Rule widen given x as Float, produce Int:\n  Return 1.\n\n' + TWICE +
      'Rule main given n as Int, produce Int:\n  Return twice(widen, n).\n',
    );
    assert.deepEqual(mismatches(errors), []);
  });

  it('实参只类型化一次：实参内部的诊断不重复', () => {
    const { errors } = check(INC + 'Rule main given n as Int, produce Int:\n  Return inc(Verdict.nope()).\n');
    assert.deepEqual(errors.map((d) => d.code), ['E101'], JSON.stringify(errors));
  });

  it('个数不符报 E032，前缀位置照常比较类型（与 Java 一致，按 min 个数比较）', () => {
    const { errors } = check(INC + 'Rule main given n as Int, produce Int:\n  Return inc("a", n).\n');
    assert.deepEqual(errors.map((d) => d.code).sort(), ['E001', 'E032']);
  });
});

describe('#268 非函数局部名与规则同名', () => {
  const SCORE = 'Rule score given a as Int, produce Int:\n  Return a.\n\n';

  it('★Rule main given score as Int … Return score(1, 2).：报 E001（期望函数），不按同名规则校验', () => {
    const { errors } = check(SCORE + 'Rule main given score as Int, produce Int:\n  Return score(1, 2).\n');
    assert.deepEqual(errors.map((d) => d.code), ['E001']);
    assert.deepEqual(errors[0]!.data, { expected: 'a function', actual: "'score' of type Int" });
  });

  it('没有同名规则时调用非函数局部名同样报 E001', () => {
    const { errors } = check('Rule main given n as Int, produce Int:\n  Return n(1).\n');
    assert.deepEqual(errors.map((d) => d.data), [{ expected: 'a function', actual: "'n' of type Int" }]);
  });

  it('★解释器按局部名分派：局部值不可调用时报错，不再静默调用同名规则', () => {
    const { core } = check(SCORE + 'Rule main given score as Int, produce Int:\n  Return score(1, 2).\n');
    assert.ok(core, '应产出 Core IR');
    const r = evaluate(core!, 'main', { score: 7 });
    assert.equal(r.success, false, `不应求值成功：${JSON.stringify(r)}`);
    assert.match(r.error ?? '', /score/);
  });

  it('函数类型局部名遮蔽同名规则的既有行为不变', () => {
    const { errors, core } = check(
      INC + 'Rule main given inc as (Int) -> Int, n as Int, produce Int:\n  Return inc(n).\n\n' +
      'Rule dec given x as Int, produce Int:\n  Return x minus 1.\n\n' +
      'Rule run given n as Int, produce Int:\n  Return main(dec, n).\n',
    );
    assert.deepEqual(errors, []);
    const r = evaluate(core!, 'run', { n: 5 });
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 4);
  });
});
