import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { typecheckModule } from '../../src/typecheck/module.js';
import { ErrorCode } from '../../src/diagnostics/error_codes.js';

/**
 * 用户定义函数的参数个数校验（issue aster-lang-ts#146）。
 *
 * ★真实缺陷：全管线零校验，与 builtin 的严查形成双标——`BUILTIN_ARITY` 表用整页注释
 * 论证「漏参渗出 undefined 是最危险的静默错答案」，而同一解释器对**用户函数**
 * 多传静默丢弃、少传补 `null`，typechecker 也不查。
 *
 * 实测（修复前）：`Rule g given a as Int … Return g(1, 2, 3).`
 * → 诊断为空、求值 `{"success":true,"value":1}`。
 *
 * ★为什么修在 typechecker 而不是解释器：两个引擎的**运行期**都是 `Math.min` 静默截断
 * （truffle `AsterRootNode.bindArgumentsToFrame` 同样如此）。只改一侧运行期会立刻
 * 制造跨引擎分歧；typechecker 是双引擎共用的前置关卡，在这里拦下既能在编译期给出
 * 准确诊断，又不改变任何一侧的运行时语义。运行期收紧需两引擎同步，属独立工作。
 */
function diagnose(body: string): string[] {
  const c = compile(`Module p.\n${body}\n`);
  assert.ok(c.core, 'compile 应成功');
  return typecheckModule(c.core!).map((d) => d.code);
}

const G1 = 'Rule g given a as Int, produce Int:\n  Return a.\n';
const G2 = 'Rule g given a as Int, b as Int, produce Int:\n  Return a.\n';

describe('用户函数调用的参数个数校验', () => {
  it('★多传参数 → CALL_ARITY_MISMATCH（此前静默丢弃）', () => {
    const codes = diagnose(G1 + 'Rule main produce Int:\n  Return g(1, 2, 3).');
    assert.ok(codes.includes(ErrorCode.CALL_ARITY_MISMATCH), `实际诊断：${codes}`);
  });

  it('★少传参数 → CALL_ARITY_MISMATCH（此前补 null 渗出）', () => {
    const codes = diagnose(G2 + 'Rule main produce Int:\n  Return g(1).');
    assert.ok(codes.includes(ErrorCode.CALL_ARITY_MISMATCH), `实际诊断：${codes}`);
  });

  it('★零参数函数被传参同样报错', () => {
    const codes = diagnose('Rule z produce Int:\n  Return 1.\nRule main produce Int:\n  Return z(9).');
    assert.ok(codes.includes(ErrorCode.CALL_ARITY_MISMATCH), `实际诊断：${codes}`);
  });

  it('★诊断须点名函数与期望/实际个数', () => {
    // 只断言「报错了」不够：用户需要知道是哪个函数、差几个参数。
    const c = compile(`Module p.\n${G1}Rule main produce Int:\n  Return g(1, 2, 3).\n`);
    const d = typecheckModule(c.core!).find((x) => x.code === ErrorCode.CALL_ARITY_MISMATCH);
    assert.ok(d, '应有该诊断');
    assert.match(d!.message, /'g'/, `须点名函数；实际：${d!.message}`);
    assert.match(d!.message, /1/, `须给出期望个数；实际：${d!.message}`);
    assert.match(d!.message, /3/, `须给出实际个数；实际：${d!.message}`);
  });
});

describe('合法调用不得误报（反向护栏）', () => {
  // ★没有这一组，把检查写成「恒报错」也能让上面全部变绿。
  it('参数个数正确 → 无 arity 诊断', () => {
    const codes = diagnose(G1 + 'Rule main produce Int:\n  Return g(7).');
    assert.ok(!codes.includes(ErrorCode.CALL_ARITY_MISMATCH), `不应报 arity；实际：${codes}`);
  });

  it('零参数函数零参数调用 → 无 arity 诊断', () => {
    const codes = diagnose('Rule z produce Int:\n  Return 1.\nRule main produce Int:\n  Return z().');
    assert.ok(!codes.includes(ErrorCode.CALL_ARITY_MISMATCH), `实际：${codes}`);
  });

  it('★builtin 调用不走本检查（它们有自己的 BUILTIN_ARITY 路径）', () => {
    // 只查本模块内声明的函数——对 builtin 瞎猜签名会误报。
    const codes = diagnose('Rule main produce Int:\n  Return List.length([1, 2, 3]).');
    assert.ok(!codes.includes(ErrorCode.CALL_ARITY_MISMATCH), `实际：${codes}`);
  });

  it('★未声明的函数不报 arity（那是 UNDEFINED_VARIABLE 的职责）', () => {
    // 签名未知时瞎猜个数只会制造噪声。
    const codes = diagnose('Rule main produce Int:\n  Return notDeclared(1, 2).');
    assert.ok(!codes.includes(ErrorCode.CALL_ARITY_MISMATCH), `实际：${codes}`);
  });
});
