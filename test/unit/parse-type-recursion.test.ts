import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';

/**
 * 类型递归的深度护栏（issue aster-lang-ts#145）。
 *
 * ★真实缺陷：`MAX_RECURSION_DEPTH=300` 的设计目标就是「病态输入不许打爆原生栈」，
 * 但它此前**只接在 `parseExpr` 上**；而 `parseType → parseTypePrimary → parseType`
 * 的类型递归完全无护栏。
 *
 * 实测（修复前）：`'maybe '.repeat(5000) + 'Int'`（约 30KB）→ 原生 `RangeError`
 * 「Maximum call stack size exceeded」，被 decl-parser 的 catch-all 转成
 * **span 恒为 1:1 的假诊断**——用户既不知道是哪一行，也不知道真正原因是嵌套过深。
 *
 * 对照：400 层**括号**一直正确报「nesting too deep (exceeds limit of 300)」——
 * 同一份护栏，只是没接到类型这条路径上。
 */
function parseErrorOf(src: string): string | null {
  const c = compile(src);
  const errs = (c as { parseErrors?: { message: string }[] }).parseErrors ?? [];
  return errs.length > 0 ? errs[0]!.message : null;
}

function nestedMaybe(depth: number): string {
  return `Module p.\nRule r given x as ${'maybe '.repeat(depth)}Int, produce Int:\n  Return 1.\n`;
}

describe('类型嵌套深度护栏', () => {
  it('★5000 层嵌套类型报可恢复诊断，不是原生 RangeError', () => {
    const msg = parseErrorOf(nestedMaybe(5000));
    assert.ok(msg, '应有解析错误');
    assert.doesNotMatch(msg!, /Maximum call stack size exceeded/,
      `不得渗出原生 RangeError；实际：${msg}`);
    assert.match(msg!, /nesting too deep/, `应报嵌套过深；实际：${msg}`);
  });

  it('★超限即报，且报的是嵌套过深而非别的错', () => {
    const msg = parseErrorOf(nestedMaybe(400));
    assert.ok(msg, '400 层已超 300 上限，应报错');
    assert.match(msg!, /nesting too deep/, `实际：${msg}`);
  });

  it('★护栏不随深度增加而失效（10000 层同样是可恢复诊断）', () => {
    // 若护栏仍在递归之后，更深的输入只会更早栈溢出。
    const msg = parseErrorOf(nestedMaybe(10000));
    assert.ok(msg);
    assert.doesNotMatch(msg!, /Maximum call stack size exceeded/, `实际：${msg}`);
  });
});

describe('正常类型不受影响（反向护栏）', () => {
  // ★没有这一组，把 parseType 写成「一律报嵌套过深」也能让上面全部变绿。
  it('普通类型正常解析', () => {
    assert.equal(parseErrorOf('Module p.\nRule r given x as Int, produce Int:\n  Return 1.\n'), null);
  });

  it('浅层嵌套类型正常解析', () => {
    assert.equal(parseErrorOf(nestedMaybe(10)), null, '10 层远低于上限');
  });

  it('★接近上限但未超（290 层）仍应通过', () => {
    // 锁住「上限是 300 而不是被我改小了」——防护栏顺手收紧了合法输入。
    assert.equal(parseErrorOf(nestedMaybe(290)), null, '290 层未超 300 上限，应通过');
  });
});
