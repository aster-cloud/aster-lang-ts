/**
 * 用户规则调用的静态检查与运行期调用目标（#266 #268）。
 *
 * #266：调用本模块规则或函数值局部名时，按**显式写了类型**的形参比较实参类型，不符报 E001
 *   （与 Java BaseTypeChecker.checkCall 同码）。未写类型的形参（解析器按名字推断出类型，
 *   `typeInferred`）不参与比较——推断类型只是按名字猜的。Java 目前仍按推断类型比较并拒绝这类调用，
 *   TS 放行（向 TS 对齐见 aster-lang-core#229）。原则：能正常运行的程序不新增 E001，拿不准时放行。
 * #268：调用目标解析与 Java/truffle 一致——局部名遮蔽同名规则。局部名类型已知且不是函数类型时
 *   报 E001（期望函数）；TS 解释器同样按局部名分派，不再悄悄改调同名规则。
 */
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { compileAndTypecheck, evaluate, EN_US } from '../../src/browser.js';
import type { Core } from '../../src/types.js';
import { CALL_TARGET_BUILTIN_ALIASES, NAMED_BUILTIN_OPS } from '../../src/config/semantic.js';

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

  it('Int 实参传给 Float 形参按数值拓宽放行', () => {
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

/** 运行 main 并断言成功：放行的用例须是真能跑通的程序 */
function runsOk(core: Core.Module | undefined, input: Record<string, unknown>): unknown {
  assert.ok(core, '应产出 Core IR');
  const r = evaluate(core!, 'main', input);
  assert.equal(r.success, true, r.error);
  return r.value;
}

describe('#266 审查跟进：能正常运行的调用不新增 E001', () => {
  it('M1 实参为推断失败的返回类型（produce:）：inc(mk(n)) 放行', () => {
    const { errors, core } = check(INC + 'Rule mk given x as Int, produce:\n  Return x.\n\nRule main given n as Int, produce Int:\n  Return inc(mk(n)).\n');
    assert.deepEqual(mismatches(errors), []);
    assert.equal(runsOk(core, { n: 1 }), 2);
  });

  it('M1 函数值的返回类型为推断占位：twice(inc2, n)（inc2 写 produce:）放行', () => {
    const { errors, core } = check('Rule inc2 given x as Int, produce:\n  Return x plus 1.\n\n' + TWICE + 'Rule main given n as Int, produce Int:\n  Return twice(inc2, n).\n');
    assert.deepEqual(mismatches(errors), []);
    assert.equal(runsOk(core, { n: 1 }), 3);
  });

  it('M1 未写类型且 produce: 推断不出返回类型的规则作函数值：twice(bump, n) 放行', () => {
    // `amount plus 1` 推断不出返回类型，签名 ret 为 TypeVar 'Unknown' 占位，函数值类型为 (Unknown) -> Unknown
    const { errors, core } = check('Rule bump given amount, produce:\n  Return amount plus 1.\n\n' + TWICE + 'Rule main given n as Int, produce Int:\n  Return twice(bump, n).\n');
    assert.deepEqual(mismatches(errors), []);
    assert.equal(runsOk(core, { n: 1 }), 3);
  });

  it('M1 泛型规则 id of T 作函数值传给 (Int) -> Int 放行', () => {
    const { errors, core } = check('Rule id of T given x as T, produce T:\n  Return x.\n\n' + TWICE + 'Rule main given n as Int, produce Int:\n  Return twice(id, n).\n');
    assert.deepEqual(mismatches(errors), []);
    assert.equal(runsOk(core, { n: 4 }), 4);
  });

  it('M2 T → T?、None → T?、T? ↔ Option of T、Some(n) → Option of Int 都放行', () => {
    const OPT = 'Rule pick given x as Text?, produce Text:\n  Return "k".\n\nRule pickO given x as Option of Text, produce Text:\n  Return "o".\n\nRule pickI given x as Option of Int, produce Text:\n  Return "i".\n\n';
    for (const call of ['pick(t)', 'pick(None)', 'pickO(m)', 'pick(o)', 'pickI(Some(n))']) {
      const { errors, core } = check(OPT + `Rule main given t as Text, m as Text?, o as Option of Text, n as Int, produce Text:\n  Return ${call}.\n`);
      assert.deepEqual(mismatches(errors), [], call);
      runsOk(core, { t: 'a', m: 'b', o: 'c', n: 1 });
    }
  });

  it('M2 内层类型不符仍报：Text? 形参传 Int', () => {
    const { errors } = check('Rule pick given x as Text?, produce Text:\n  Return "k".\n\nRule main given n as Int, produce Text:\n  Return pick(n).\n');
    assert.deepEqual(mismatches(errors), [{ expected: 'Text?', actual: 'Int' }]);
  });

  it('M3 实参类型只来自名字推断（given amount）时放行：inc(amount)', () => {
    const { errors, core } = check(INC + 'Rule main given amount, produce Int:\n  Return inc(amount).\n');
    assert.deepEqual(mismatches(errors), []);
    assert.equal(runsOk(core, { amount: 1 }), 2);
  });

  it('M3 调用未写类型的形参（given f … f(n)）不报「期望函数」', () => {
    const { errors, core } = check(INC + 'Rule ap given f, n as Int, produce Int:\n  Return f(n).\n\nRule main given n as Int, produce Int:\n  Return ap(inc, n).\n');
    assert.deepEqual(errors, []);
    assert.equal(runsOk(core, { n: 1 }), 2);
  });

  it('数值拓宽统一放行：Int → Long / Float、Long → Float，含字面量与容器元素', () => {
    const DECLS = 'Rule toL given x as Long, produce Int:\n  Return 1.\n\nRule toF given x as Float, produce Int:\n  Return 1.\n\n' +
      'Rule toLF given xs as List of Float, produce Int:\n  Return 1.\n\nRule toOF given x as Option of Float, produce Int:\n  Return 1.\n\n';
    for (const call of ['toL(n)', 'toL(5)', 'toF(5)', 'toF(l)', 'toLF(xs)', 'toLF([1, 2])', 'toOF(Some(n))']) {
      const { errors } = check(DECLS + `Rule main given n as Int, l as Long, xs as List of Int, produce Int:\n  Return ${call}.\n`);
      assert.deepEqual(mismatches(errors), [], call);
    }
  });

  it('数值拓宽：Int / Long 实参传给 Decimal 形参放行，Double 传 Decimal 报错（ADR 0025）', () => {
    const DECLS = 'Rule toD given x as Decimal, produce Int:\n  Return 1.\n\n';
    for (const call of ['toD(n)', 'toD(l)', 'toD(5)']) {
      const { errors } = check(DECLS + `Rule main given n as Int, l as Long, produce Int:\n  Return ${call}.\n`);
      assert.deepEqual(mismatches(errors), [], call);
    }
    const { errors } = check(DECLS + 'Rule main given x as Float, produce Int:\n  Return toD(x).\n');
    assert.equal(mismatches(errors).length, 1);
  });

  it('收窄仍报：Float 实参传给 Int 形参', () => {
    const { errors } = check(INC + 'Rule main given x as Float, produce Int:\n  Return inc(x).\n');
    // `as Float` 的类型名就是 Float（与 Java 一致，X1 裁决），不再改写为 Double
    assert.deepEqual(mismatches(errors), [{ expected: 'Int', actual: 'Float' }]);
  });
});

describe('core#231 审查跟进：TS 不比 Java 严', () => {
  const codes = (errors: readonly Diag[]) => errors.map((d) => d.code);

  it('F2 字段构造（E012）复用实参兼容规则：T? ← T、T? ← None、Long ← Int、List of Float ← List of Int 放行', () => {
    const DATA = 'Define Box has t as Text?, l as Long, fs as List of Float.\n\n';
    for (const [t, l, fs] of [['s', 'n', 'xs'], ['None', '5', '[1, 2]']]) {
      const { errors, core } = check(DATA + `Rule main given s as Text, n as Int, xs as List of Int, produce Int:\n  Let b be Box with t set to ${t}, l set to ${l}, fs set to ${fs}.\n  Return 1.\n`);
      assert.deepEqual(codes(errors), [], `${t} ${l} ${fs}`);
      runsOk(core, { s: 'a', n: 1, xs: [1] });
    }
  });

  it('F2 字段构造：推断不出返回类型的实参（produce:）放行，不再报 expects Float, got Unknown', () => {
    const { errors } = check(
      'Define Q has cost as Float.\n\nRule est given x as Int, produce:\n  Return x plus 1.\n\n' +
      'Rule main given n as Int, produce Int:\n  Let q be Q with cost set to est(n).\n  Return 1.\n',
    );
    assert.deepEqual(codes(errors), []);
  });

  it('F2 字段构造的收窄仍报 E012：Int 字段 ← Float', () => {
    const { errors } = check('Define Box has i as Int.\n\nRule main given x as Float, produce Int:\n  Let b be Box with i set to x.\n  Return 1.\n');
    assert.deepEqual(codes(errors), ['E012']);
  });

  it('F2 Set（E002）复用实参兼容规则：Float 变量 ← Int、Text? 变量 ← Text 放行', () => {
    const { errors, core } = check(
      'Rule main given n as Int, f as Float, m as Text?, t as Text, produce Int:\n  Let x be f.\n  Set x to n.\n  Let y be m.\n  Set y to t.\n  Return 1.\n',
    );
    assert.deepEqual(codes(errors), []);
    runsOk(core, { n: 1, f: 1.5, m: 'a', t: 'b' });
  });

  it('F2 Set 的收窄仍报 E002：Int 变量 ← Float', () => {
    const { errors } = check('Rule main given n as Int, f as Float, produce Int:\n  Let x be n.\n  Set x to f.\n  Return 1.\n');
    assert.deepEqual(codes(errors), ['E002']);
  });

  it('按名字推断的标记随 Let 传播：given amount 后 Let y be amount. inc(y) 放行', () => {
    const { errors, core } = check(INC + 'Rule main given amount, produce Int:\n  Let y be amount.\n  Return inc(y).\n');
    assert.deepEqual(codes(errors), []);
    assert.equal(runsOk(core, { amount: 1 }), 2);
  });

  it('F1 局部名与单段 builtin 同名、调用的正是 builtin：不报「期望函数」，解释器先调 builtin（与 truffle 一致）', () => {
    const cases: [string, Record<string, unknown>, unknown][] = [
      ['Rule main given add as Int, produce Int:\n  Return add(1, 2).\n', { add: 7 }, 3],
      ['Rule main given n as Int, produce Int:\n  Let sub be 3.\n  Return sub(5, n).\n', { n: 2 }, 3],
      ['Rule main given gt as Int, produce Bool:\n  Return gt(2, 1).\n', { gt: 0 }, true],
    ];
    for (const [body, input, expected] of cases) {
      const { errors, core } = check(body);
      assert.deepEqual(codes(errors), [], body);
      assert.equal(runsOk(core, input), expected, body);
    }
  });

  it('F1 builtin 名一律不做调用目标检查（与 core CallTargetBuiltins 一致）；有同名规则时运行期按局部值分派，与 truffle 一致失败', () => {
    const { errors, core } = check('Rule add given a as Int, b as Int, produce Int:\n  Return a.\n\nRule main given add as Int, produce Int:\n  Return add(1, 2).\n');
    assert.deepEqual(codes(errors), []);
    const r = evaluate(core!, 'main', { add: 7 });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /'add' is not a function/);
  });

  it('R1 局部函数值优先于同名 builtin：函数类型形参 gt、闭包 add、单参闭包 add 都调用局部值', () => {
    const cases: [string, Record<string, unknown>, unknown][] = [
      [
        'Rule lessThan given a as Int, b as Int, produce Bool:\n  Return a less than b.\n\n' +
          'Rule ap given gt as (Int, Int) -> Bool, produce Bool:\n  Return gt(1, 2).\n\n' +
          'Rule main given n as Int, produce Bool:\n  Return ap(lessThan).\n',
        { n: 0 },
        true,
      ],
      ['Rule main given n as Int, produce Int:\n  Let add be function with a as Int, b as Int, produce Int:\n    Return a times b.\n  Return add(2, 3).\n', { n: 0 }, 6],
      ['Rule main given n as Int, produce Int:\n  Let add be function with a as Int, produce Int:\n    Return a.\n  Return add(n).\n', { n: 1 }, 1],
    ];
    for (const [body, input, expected] of cases) {
      const { errors, core } = check(body);
      assert.deepEqual(codes(errors), [], body);
      assert.equal(runsOk(core, input), expected, body);
    }
  });

  it('R1 与 builtin 同名的局部函数值按局部函数类型检查：add 闭包为 (Int) -> Int 时 add(1, 2) 报 E032', () => {
    const { errors } = check('Rule main given n as Int, produce Int:\n  Let add be function with a as Int, produce Int:\n    Return a.\n  Return add(1, 2).\n');
    assert.deepEqual(codes(errors), ['E032']);
  });

  it('F1 交叉核对：单段 builtin 名单与别名表与 aster-lang-core CallTargetBuiltins.NAMES / ALIASES 一致（找不到 core 即失败）', () => {
    // CI 的 test job 把 core 检出到工作区内 ./aster-lang-core；本地可用 ASTER_CORE_DIR 指定，或放在兄弟目录 ../aster-lang-core
    const RELATIVE = 'src/main/java/aster/core/typecheck/CallTargetBuiltins.java';
    const roots = [process.env['ASTER_CORE_DIR'], resolve(process.cwd(), 'aster-lang-core'), resolve(process.cwd(), '..', 'aster-lang-core')];
    const file = roots.filter((r): r is string => !!r).map((r) => join(r, RELATIVE)).find((f) => existsSync(f));
    assert.ok(file, `找不到 aster-lang-core 的 ${RELATIVE}（CI 检出 ./aster-lang-core；本地用 ASTER_CORE_DIR 指定）`);
    const source = readFileSync(file, 'utf8');
    const block = /Set\.of\(([^)]*)\)/.exec(source);
    assert.ok(block, 'CallTargetBuiltins.NAMES 的 Set.of(...) 未找到');
    const names = [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    assert.deepEqual([...new Set(names)].sort(), Object.keys(NAMED_BUILTIN_OPS).sort());
    // core#234：单词别名表（ALIASES = Map.of("plus", "add", …)）同样逐项一致
    const aliasBlock = /ALIASES\s*=\s*Map\.of\(([^)]*)\)/.exec(source);
    assert.ok(aliasBlock, 'CallTargetBuiltins.ALIASES 的 Map.of(...) 未找到');
    const flat = [...aliasBlock[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    const aliases = Object.fromEntries(flat.flatMap((v, i) => (i % 2 === 0 ? [[v, flat[i + 1]!]] : [])));
    assert.deepEqual(aliases, { ...CALL_TARGET_BUILTIN_ALIASES });
  });
});
