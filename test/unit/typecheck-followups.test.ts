/**
 * 类型检查跟进（aster-lang-core#232 #234、aster-lang-ts#276 #277，两引擎同步）。
 *
 * 原则（用户裁决）：能正确运行的代码不报错；按名字推断出的类型视为未知；数值拓宽在所有赋值类位置
 * （实参、字段、Set、Return）放行，收窄照常报错；TS 不比 Java 严。
 * - core#232：未写类型的 data 字段不按推断类型检查构造值（E012）；按名字推断类型的局部名放进字段、
 *   Set、Return 时不作约束；Return 位置与实参一样按可赋值规则比较（拓宽、T → T?、None → T?）。
 * - core#234：truffle 把 equals / is / over / under / divide 等单词别名（不区分大小写）归一为 builtin，
 *   与这些名字同名的非函数局部名被调用时不报「调用非函数局部名」；未声明时 TS 解释器同样按 builtin 分派。
 * - ts#276：`Decimal` 是内置标量，不再被当作隐式类型参数；Int / Long → Decimal 放行，
 *   Float / Double ↔ Decimal（ADR 0025）、Decimal → Int、Text → Decimal 报错。
 * - ts#277：`T?` 的值可能是裸值 / null（宿主传入，或 T → T? 直接传入）：裸的非 null 值匹配 `When Some(v)`，
 *   null 匹配 `When None`（与 truffle 同步修复）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAndTypecheck, evaluate, EN_US } from '../../src/browser.js';
import type { Core } from '../../src/types.js';

interface Diag { severity?: string; code: string; message: string }

function check(body: string): { codes: string[]; messages: string[]; core: Core.Module | undefined } {
  const r = compileAndTypecheck(`Module demo.\n\n${body}`, { lexicon: EN_US });
  const errors = [...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? []), ...(r.typeErrors ?? [])]
    .filter((d) => (d as Diag).severity === 'error' || (d as Diag).severity === undefined) as Diag[];
  return { codes: errors.map((d) => d.code), messages: errors.map((d) => `${d.code} ${d.message}`), core: r.core };
}

function run(core: Core.Module | undefined, input: Record<string, unknown>): unknown {
  assert.ok(core, '应产出 Core IR');
  const r = evaluate(core!, 'main', input);
  assert.equal(r.success, true, r.error);
  return r.value;
}

describe('core#232 按名字推断的类型视为未知', () => {
  it('★未写类型的 data 字段不按推断类型检查构造值（collateralRequired 推断为 Text，传 Int）', () => {
    const { codes } = check(
      'Define Decision has approved, collateralRequired, bmi.\n\n' +
        'Rule main given n as Int, produce Decision:\n' +
        '  Return Decision with approved set to true, collateralRequired set to 1, bmi set to 22.\n',
    );
    assert.deepEqual(codes, []);
  });

  it('按名字推断类型的局部名放进写了类型的字段不报 E012', () => {
    const { codes } = check('Define P has total as Int.\n\nRule main given amount, produce P:\n  Return P with total set to amount.\n');
    assert.deepEqual(codes, []);
  });

  it('★Return amount（推断为 Float）在 produce Int 规则中不报 E003，经 Let 传递同样', () => {
    assert.deepEqual(check('Rule main given amount, produce Int:\n  Return amount.\n').codes, []);
    assert.deepEqual(check('Rule main given amount, produce Int:\n  Let y be amount.\n  Return y.\n').codes, []);
  });

  it('Set 为按名字推断类型的值不报 E002，之后 Return 也不报 E003', () => {
    const { codes } = check('Rule main given amount, produce Int:\n  Let y be 1.\n  Set y to amount.\n  Return y.\n');
    assert.deepEqual(codes, []);
  });

  it('If 条件为按名字推断类型的局部名不报错', () => {
    const { codes } = check('Rule main given approved_status, produce Int:\n  If approved_status:\n    Return 1.\n  Return 0.\n');
    assert.deepEqual(codes, []);
  });

  it('★Return 位置数值拓宽与可空放行：Int → Float / Long / Decimal、Long → Float、T → T?、None → T?', () => {
    const cases = [
      'Rule main given n as Int, produce Float:\n  Return 1.\n',
      'Rule main given n as Int, produce Long:\n  Return n.\n',
      'Rule main given n as Int, produce Decimal:\n  Return n.\n',
      'Rule main given n as Long, produce Float:\n  Return n.\n',
      'Rule main given n as Int, produce Int?:\n  Return n.\n',
      'Rule main given n as Int, produce Int?:\n  Return None.\n',
      'Rule main given n as Int, produce Long:\n  Let g be function with x as Int, produce Long:\n    Return x.\n  Return g(n).\n',
    ];
    for (const body of cases) assert.deepEqual(check(body).codes, [], body);
  });

  it('收窄仍报错：Return Float → Int、Text → Int、T? → T、Double → Decimal、Decimal → Float；字段 Text → Int；Set Float → Int', () => {
    const cases: [string, string][] = [
      ['Rule main given n as Float, produce Int:\n  Return n.\n', 'E003'],
      ['Rule main given t as Text, produce Int:\n  Return t.\n', 'E003'],
      ['Rule main given n as Int?, produce Int:\n  Return n.\n', 'E003'],
      ['Rule main given d as Double, produce Decimal:\n  Return d.\n', 'E003'],
      ['Rule main given d as Decimal, produce Float:\n  Return d.\n', 'E003'],
      ['Rule main given n as Float, produce Int:\n  Let g be function with x as Float, produce Int:\n    Return x.\n  Return g(n).\n', 'E003'],
      ['Define P has total as Int.\n\nRule main given t as Text, produce P:\n  Return P with total set to t.\n', 'E012'],
      ['Rule main given f as Float, produce Int:\n  Let y be 1.\n  Set y to f.\n  Return 0.\n', 'E002'],
    ];
    for (const [body, code] of cases) assert.ok(check(body).codes.includes(code), `${body} 应报 ${code}`);
  });
});

describe('core#234 truffle 归一化的 builtin 别名', () => {
  it('★与别名同名的非函数局部名被调用不报 E001：over / divide / under / equals / is', () => {
    const cases = [
      'Rule main given over as Int, produce Bool:\n  Return over(3, 2).\n',
      'Rule main given divide as Int, produce Int:\n  Return divide(10, 2).\n',
      'Rule main given under as Int, produce Bool:\n  Return under(1, 2).\n',
      'Rule main given equals as Int, produce Bool:\n  Return equals(2, 2).\n',
      'Rule main given is as Int, produce Bool:\n  Return is(2, 2).\n',
    ];
    for (const body of cases) assert.deepEqual(check(body).codes, [], body);
  });

  it('解释器按 builtin 分派别名（与 truffle Builtins.canonicalName 一致）', () => {
    assert.equal(run(check('Rule main given over as Int, produce Bool:\n  Return over(3, 2).\n').core, { over: 0 }), true);
    assert.equal(run(check('Rule main given n as Int, produce Int:\n  Return divide(10, 2).\n').core, { n: 0 }), 5);
    assert.equal(run(check('Rule main given n as Int, produce Bool:\n  Return equals(n, 2).\n').core, { n: 2 }), true);
  });

  it('不是别名的非函数局部名仍报 E001', () => {
    const { codes } = check('Rule score given a as Int, produce Int:\n  Return a.\n\nRule main given n as Int, produce Int:\n  Let score be 3.\n  Return score(n).\n');
    assert.deepEqual(codes, ['E001']);
  });
});

describe('ts#276 Decimal 是内置标量', () => {
  const MONEY = 'Rule money given x as Decimal, produce Decimal:\n  Return x.\n\n';
  const INC = 'Rule inc given x as Int, produce Int:\n  Return x plus 1.\n\n';

  it('Decimal 形参不再降级为类型参数', () => {
    const { core } = check(MONEY);
    const func = core!.decls.find((d) => d.kind === 'Func') as Core.Func;
    assert.deepEqual((func as unknown as { typeParams: string[] }).typeParams, []);
    assert.equal(func.params[0]!.type.kind, 'TypeName');
  });

  it('★Int / Long / Decimal → Decimal 放行', () => {
    for (const t of ['Int', 'Long', 'Decimal']) {
      assert.deepEqual(check(MONEY + `Rule main given d as ${t}, produce Decimal:\n  Return money(d).\n`).codes, [], t);
    }
  });

  it('★Text / Float / Double → Decimal、Decimal → Int / Double 报 E001（ADR 0025）', () => {
    for (const t of ['Text', 'Float', 'Double']) {
      assert.deepEqual(check(MONEY + `Rule main given d as ${t}, produce Decimal:\n  Return money(d).\n`).codes, ['E001'], t);
    }
    assert.deepEqual(check(MONEY + 'Rule main given n as Int, produce Decimal:\n  Return money(1.5).\n').codes, ['E001']);
    assert.deepEqual(check(INC + 'Rule main given d as Decimal, produce Int:\n  Return inc(d).\n').codes, ['E001']);
    assert.deepEqual(
      check('Rule h given x as Double, produce Double:\n  Return x.\n\nRule main given d as Decimal, produce Double:\n  Return h(d).\n').codes,
      ['E001'],
    );
  });

  it('produce Decimal 返回 Decimal 运算结果不报 E003（此前 TypeVar 与 TypeName 比较误报 expected Decimal, got Decimal）', () => {
    const { codes } = check('Rule main given d as Decimal, produce Decimal:\n  Return Decimal.round(d plus 1, 2, "HALF_UP").\n');
    assert.deepEqual(codes, []);
  });
});

describe('ts#277 T? 的裸值与 Some / None 模式', () => {
  const MATCH = 'Rule f given x as Int?, produce Int:\n  Match x:\n    When None, Return 0.\n    When Some(v), Return v.\n\n';

  it('★裸值实参 f(n) 走 Some 分支，Some(n) 与 None 不变', () => {
    assert.equal(run(check(MATCH + 'Rule main given n as Int, produce Int:\n  Return f(n).\n').core, { n: 3 }), 3);
    assert.equal(run(check(MATCH + 'Rule main given n as Int, produce Int:\n  Return f(Some(n)).\n').core, { n: 3 }), 3);
    assert.equal(run(check(MATCH + 'Rule main given n as Int, produce Int:\n  Return f(None).\n').core, { n: 3 }), 0);
  });

  it('★宿主传入的裸值 3 与 null', () => {
    const body = 'Rule main given x as Int?, produce Int:\n  Match x:\n    When Some(v), Return v.\n    When None, Return 0.\n';
    const { codes, core } = check(body);
    assert.deepEqual(codes, []);
    assert.equal(run(core, { x: 3 }), 3);
    assert.equal(run(core, { x: null }), 0);
  });

  it('Ok 值不匹配 Some(v)', () => {
    const body = 'Rule main given n as Int, produce Int:\n  Let y be Ok(n).\n  Match y:\n    When Some(v), Return 1.\n    When other, Return 2.\n';
    assert.equal(run(check(body).core, { n: 5 }), 2);
  });
});

describe('ts#279 workflow step / compensate 体的作用域（与 truffle#163 一致）', () => {
  it('不同 step 与 compensate 中的同名 Let 不报 E104；Set 写回外层', () => {
    const body =
      'Rule runSteps given n as Int, produce Int. It performs io:\n  Let x be n.\n  workflow:\n' +
      '    step first:\n      Let x be n plus 1.\n      Let y be x times 2.\n      Return ok of y.\n' +
      '    compensate:\n      Let x be n minus 1.\n      Return ok of x.\n\n' +
      '    step second:\n      Let y be n plus 10.\n      Return ok of y.\n\n' +
      '    step third:\n      Set x to n plus 100.\n      Return ok of x.\n  .\n  Return x.\n';
    assert.deepEqual(check(body).codes, []);
  });

  it('跨 step 读取另一 step 的 Let 报未定义', () => {
    const body =
      'Rule runSteps given n as Int, produce Int. It performs io:\n  workflow:\n' +
      '    step first:\n      Let y be n plus 1.\n      Return ok of y.\n\n' +
      '    step second:\n      Return ok of y.\n  .\n  Return n.\n';
    assert.ok(check(body).codes.length > 0);
  });
});
