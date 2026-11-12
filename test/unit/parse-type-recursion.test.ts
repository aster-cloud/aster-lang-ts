import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { MAX_TYPE_RECURSION_DEPTH } from '../../src/parser/context.js';

/**
 * 类型递归的深度护栏（issue aster-lang-ts#145）。
 *
 * ★真实缺陷：`MAX_RECURSION_DEPTH` 的设计目标就是「病态输入不许打爆原生栈」，
 * 但它此前**只接在 `parseExpr` 上**；而 `parseType → parseTypePrimary → parseType`
 * 的类型递归完全无护栏。
 *
 * 实测（修复前）：`'maybe '.repeat(5000) + 'Int'`（约 30KB）→ 原生 `RangeError`
 * 「Maximum call stack size exceeded」，被 decl-parser 的 catch-all 转成
 * **span 恒为 1:1 的假诊断**——用户既不知道是哪一行，也不知道真正原因是嵌套过深。
 *
 * 对照：400 层**括号**一直正确报「nesting too deep (exceeds limit of N)」——
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
    assert.ok(msg, '400 层已超上限，应报错');
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

  it('★深度恰为上限仍应通过', () => {
    // maybe 链：n 个 maybe + 叶子 Int = n + 1 次 parseType
    assert.equal(parseErrorOf(nestedMaybe(MAX_TYPE_RECURSION_DEPTH - 1)), null);
    assert.match(parseErrorOf(nestedMaybe(MAX_TYPE_RECURSION_DEPTH)) ?? '', /nesting too deep/);
  });
});

/**
 * 计数单位与 aster-lang-core 的词法期类型守卫相同（aster-lang-core#250）：每进入一次 parseType 计 1，
 * 叶子类型名也算一层；Map 的键和值、result of 的每个分量各自都是一次进入。两端在上限放行、上限 + 1 报 E054。
 */
describe('类型嵌套计数单位（与 core 对齐）', () => {
  const L = MAX_TYPE_RECURSION_DEPTH;
  const src = (type: string): string =>
    `Module p.\nRule r given x as ${type}, produce Int:\n  Return 1.\n`;
  const errCode = (type: string): string | null => {
    const errs = (compile(src(type)) as { parseErrors?: { code?: string }[] }).parseErrors ?? [];
    return errs.length > 0 ? (errs[0]!.code ?? 'no-code') : null;
  };
  /** 深度为 depth 的 Map 值链（叶子 Int 占一层）。 */
  const mapChain = (depth: number): string => 'Map Text to '.repeat(depth - 1) + 'Int';

  it('上限与 core 同值 64', () => {
    assert.equal(L, 64);
  });

  const shapes: Record<string, (depth: number) => string> = {
    'list of 链': d => 'list of '.repeat(d - 1) + 'Int',
    'option of 链': d => 'option of '.repeat(d - 1) + 'Int',
    'Map 值链': mapChain,
    'Map 键链': d => 'Map '.repeat(d - 1) + 'Int' + ' to Int'.repeat(d - 1),
    'result of 失败分量链': d => 'result of Int and '.repeat(d - 1) + 'Text',
    'result of 成功分量链': d => 'result of '.repeat(d - 1) + 'Int' + ' and Text'.repeat(d - 1),
    '函数类型返回值链': d => '(Int) -> '.repeat(d - 1) + 'Int',
  };
  for (const [name, shape] of Object.entries(shapes)) {
    it(`${name}：上限放行、上限 + 1 报 E054`, () => {
      assert.equal(errCode(shape(L)), null);
      assert.equal(errCode(shape(L + 1)), 'E054');
    });
  }

  it('Map 的键和值都计入深度', () => {
    assert.equal(errCode(`Map ${mapChain(L - 1)} to Int`), null);
    assert.equal(errCode(`Map Int to ${mapChain(L - 1)}`), null);
    assert.equal(errCode(`Map ${mapChain(L)} to Int`), 'E054');
    assert.equal(errCode(`Map Int to ${mapChain(L)}`), 'E054');
  });

  it('result of 的每个分量都计入深度', () => {
    assert.equal(errCode(`result of ${mapChain(L - 1)} and Text`), null);
    assert.equal(errCode(`result of Int and ${mapChain(L - 1)}`), null);
    assert.equal(errCode(`result of ${mapChain(L)} and Text`), 'E054');
    assert.equal(errCode(`result of Int and ${mapChain(L)}`), 'E054');
  });

  it('并列的类型不累加：键值、分量、多个参数各自从同一层开始', () => {
    assert.equal(errCode(`Map ${mapChain(L - 1)} to ${mapChain(L - 1)}`), null);
    assert.equal(errCode(`result of ${mapChain(L - 1)} and ${mapChain(L - 1)}`), null);
    const full = mapChain(L);
    const multi = `Module p.\nRule r given x as ${full}, y as ${full}, produce ${full}:\n  Return x.\n`;
    assert.deepEqual((compile(multi) as { parseErrors?: unknown[] }).parseErrors ?? [], []);
  });

  it('lambda 里的类型只数类型深度，不叠加外层表达式深度（与 core 一致）', () => {
    const lambda = (type: string): string =>
      `Module p.\nRule r given x as Int, produce Int:\n  Let f be function with y as ${type}, produce Int:\n    Return 1.\n  Return x.\n`;
    const codes = (s: string): string[] =>
      ((compile(s) as { parseErrors?: { code?: string }[] }).parseErrors ?? []).map(e => e.code ?? 'no-code');
    assert.deepEqual(codes(lambda(mapChain(L))), []);
    assert.deepEqual(codes(lambda(mapChain(L + 1))), ['E054']);
  });

  it('一处 E054 之后，同一模块里后续上限内的类型照常通过（深度不泄漏）', () => {
    const two = `Module p.\nRule a given x as ${mapChain(L + 1)}, produce Int:\n  Return 1.\n\n`
      + `Rule b given x as ${mapChain(L)}, produce Int:\n  Return 1.\n`;
    const errs = (compile(two) as { parseErrors?: { code?: string }[] }).parseErrors ?? [];
    assert.deepEqual(errs.map(e => e.code), ['E054']);
  });
});
