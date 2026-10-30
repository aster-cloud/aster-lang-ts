/**
 * Set 的可赋值目标（ADR 0052，aster-cloud/aster-lang-truffle#151）。
 *
 * 只有 Let 绑定可被 `Set` 赋值，且可跨 case 体 / If 分支写回外层；形参、lambda 形参、模式绑定不可变，
 * 与 Java BaseTypeChecker 同报 E001（TYPE_MISMATCH）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAndTypecheck } from '../../../src/browser.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';

function errors(lines: string[]): { code: string; line: number; message: string }[] {
  const result = compileAndTypecheck(['Module m.', '', ...lines, ''].join('\n'));
  assert.deepEqual(result.parseErrors ?? [], [], JSON.stringify(result.parseErrors));
  return result.typeErrors
    .filter((d) => d.severity === 'error')
    .map((d) => ({ code: d.code, line: d.span?.start.line ?? -1, message: d.message }));
}

describe('Set 赋值目标的可变性', () => {
  it('case 体内 Set 外层 Let：无错误', () => {
    assert.deepEqual(errors([
      'Rule r given n as Int, produce Int:',
      '  Let total be 0.',
      '  Match n:',
      '    When 1,',
      '      Set total to 10.',
      '    When other,',
      '      Set total to total plus other.',
      '  Return total.',
    ]), []);
  });

  it('If / Otherwise 分支内 Set 外层 Let：无错误', () => {
    assert.deepEqual(errors([
      'Rule r given n as Int, produce Int:',
      '  Let sign be 0.',
      '  If n greater than 0',
      '    Set sign to 1.',
      '  Otherwise',
      '    Set sign to 2.',
      '  Return sign.',
    ]), []);
  });

  it('Set 形参：报 E001 且指明是形参', () => {
    const errs = errors([
      'Rule r given n as Int, produce Int:',
      '  Set n to 1.',
      '  Return n.',
    ]);
    assert.deepEqual(errs.map((e) => [e.code, e.line]), [[ErrorCode.TYPE_MISMATCH, 4]]);
    assert.match(errs[0]!.message, /parameter 'n'/);
  });

  it('case 体内 Set 形参：同样拒绝', () => {
    const errs = errors([
      'Rule r given n as Int, produce Int:',
      '  Match n:',
      '    When 1,',
      '      Set n to 2.',
      '  Return n.',
    ]);
    assert.deepEqual(errs.map((e) => [e.code, e.line]), [[ErrorCode.TYPE_MISMATCH, 6]]);
  });

  it('Set 模式绑定：报 E001 且指明是模式绑定', () => {
    const errs = errors([
      'Rule r given n as Int, produce Int:',
      '  Let total be 0.',
      '  Match n:',
      '    When other,',
      '      Set other to 1.',
      '      Set total to other.',
      '  Return total.',
    ]);
    assert.deepEqual(errs.map((e) => [e.code, e.line]), [[ErrorCode.TYPE_MISMATCH, 7]]);
    assert.match(errs[0]!.message, /pattern binding 'other'/);
  });

  it('lambda 体内 Set lambda 形参：同样拒绝', () => {
    const errs = errors([
      'Rule r given n as Int, produce Int:',
      '  Let f be function with k as Int, produce Int:',
      '    Set k to 1.',
      '    Return k.',
      '  Return f(n).',
    ]);
    assert.deepEqual(errs.map((e) => [e.code, e.line]), [[ErrorCode.TYPE_MISMATCH, 5]]);
    assert.match(errs[0]!.message, /parameter 'k'/);
  });

  it('lambda 体内 Set 捕获的外层 Let：报 E001（按值捕获，语义未定义，一律拒绝）', () => {
    const errs = errors([
      'Rule r given n as Int, produce Int:',
      '  Let acc be 0.',
      '  Let f be function with k as Int, produce Int:',
      '    Set acc to acc plus k.',
      '    Return acc.',
      '  Return f(n).',
    ]);
    assert.deepEqual(errs.map((e) => [e.code, e.line]), [[ErrorCode.TYPE_MISMATCH, 6]]);
    assert.match(errs[0]!.message, /captured variable 'acc'/);
  });

  it('lambda 体内 Set 自己的 Let：无错误', () => {
    assert.deepEqual(errors([
      'Rule r given n as Int, produce Int:',
      '  Let f be function with k as Int, produce Int:',
      '    Let local be k.',
      '    Set local to local plus 1.',
      '    Return local.',
      '  Return f(n).',
    ]), []);
  });

  it('Set 函数名：报 E101（与 Java 一致）', () => {
    const errs = errors([
      'Rule g given n as Int, produce Int:',
      '  Return n.',
      '',
      'Rule r given n as Int, produce Int:',
      '  Set g to 1.',
      '  Return n.',
    ]);
    assert.deepEqual(errs.map((e) => [e.code, e.line]), [[ErrorCode.UNDEFINED_VARIABLE, 7]]);
  });

  it('小写 set 同样是 Set 语句', () => {
    assert.deepEqual(errors([
      'Rule r given n as Int, produce Int:',
      '  Let total be 0.',
      '  set total to n.',
      '  Return total.',
    ]), []);
  });

  // 有意的破坏性变更（ADR 0052 §6）：Set 只能赋值给已有的 Let 绑定，首次声明用 Set 报 E101。
  it('Set 未定义的名字：报 E101', () => {
    const errs = errors([
      'Rule r given n as Int, produce Int:',
      '  Set missing to 1.',
      '  Return n.',
    ]);
    assert.deepEqual(errs.map((e) => [e.code, e.line]), [[ErrorCode.UNDEFINED_VARIABLE, 4]]);
  });

  it('Set 外层 Let 类型不符：报 E002', () => {
    const errs = errors([
      'Rule r given n as Int, produce Int:',
      '  Let total be 0.',
      '  Set total to "x".',
      '  Return total.',
    ]);
    assert.ok(errs.some((e) => e.code === ErrorCode.TYPE_MISMATCH_ASSIGN), JSON.stringify(errs));
  });
});
