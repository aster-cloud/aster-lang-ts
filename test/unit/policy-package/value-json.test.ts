import { test } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { guestToTree, toValueJson, valueJson, ValueJsonError, type ValueTree } from '../../../src/policy-package/value-json.js';
import { evaluate } from '../../../src/core/interpreter.js';
import { compile } from '../../../src/browser.js';
import { PACKAGE_V1, readFixtureJson } from '../../helpers/package-v1.js';

interface Vector {
  readonly name: string;
  readonly treeJson: string;
  readonly expected: string | null;
  readonly error?: boolean;
}
interface RandomSet {
  readonly items: readonly { bits: string; expected: string }[];
}

const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;
/** 向量的树表示（VALUE-FORMS §5）：不含 . e E 的数字 token 是精确整数（bigint），其余为 double；字符串原样（可含孤立代理项）。 */
const tree = (text: string): ValueTree =>
  JSON.parse(text, (_k, v: unknown, ctx?: { source?: string }) =>
    typeof v === 'number' && /^-?(0|[1-9][0-9]*)$/.test(ctx?.source ?? '') ? BigInt(ctx!.source!) : v,
  ) as ValueTree;

if (PACKAGE_V1 !== undefined) {
  const file = readFixtureJson<{ vectors: Vector[]; randomDoubles: RandomSet; randomPlainDoubles: RandomSet }>('vectors/value-json.json');
  for (const v of file.vectors) {
    test(`值规范 JSON 向量：${v.name}`, () => {
      if (v.error) {
        assert.throws(() => valueJson(tree(v.treeJson)), ValueJsonError);
      } else {
        assert.equal(valueJson(tree(v.treeJson)), v.expected);
      }
    });
  }
  for (const key of ['randomDoubles', 'randomPlainDoubles'] as const) {
    test(`值规范 JSON 随机 double：${key}`, () => {
      const set = file[key];
      assert.ok(set.items.length >= 10_000);
      for (const { bits, expected } of set.items) {
        const x = Buffer.from(bits, 'hex').readDoubleBE(0);
        assert.equal(valueJson(x), expected, bits);
      }
    });
  }
} else {
  test('值规范 JSON 向量', { skip }, () => {});
}

test('guestToTree：Decimal 为普通写法、Enum 删去 __type:"?"、Map 键码点序、Long 精确', () => {
  assert.equal(toValueJson(new Decimal('43.30')), '"43.3"');
  assert.equal(toValueJson(new Decimal('1e-9')), '"0.000000001"');
  assert.equal(toValueJson(new Decimal('-0')), '"0"');
  assert.equal(toValueJson(new Decimal('1e+25')), '"10000000000000000000000000"');
  assert.equal(toValueJson({ __type: '?', _enum: 'Tier', value: 'Gold', variant: 'Gold', args: [] }), '{"_enum":"Tier","args":[],"value":"Gold","variant":"Gold"}');
  assert.equal(toValueJson(new Map([['z', 1], ['b', 2]])), '{"b":2,"z":1}');
  assert.equal(toValueJson(9007199254740993n), '9007199254740993');
  assert.equal(toValueJson({ a: undefined, b: null }), '{"b":null}');
  assert.equal(toValueJson(-0), '0');
});

test('guestToTree：非有限数、函数、类实例、孤立代理项与超深嵌套都失败', () => {
  assert.throws(() => guestToTree(Number.NaN), ValueJsonError);
  assert.throws(() => guestToTree(() => 1), ValueJsonError);
  assert.throws(() => guestToTree(new (class X {})()), ValueJsonError);
  assert.throws(() => toValueJson('\uD800'), ValueJsonError);
  let deep: unknown = 1;
  for (let i = 0; i < 65; i++) deep = [deep];
  assert.throws(() => toValueJson(deep), ValueJsonError);
  let ok: unknown = 1;
  for (let i = 0; i < 64; i++) ok = [ok];
  assert.equal(toValueJson(ok), `${'['.repeat(64)}1${']'.repeat(64)}`);
});

test('toValueJson：解释器实际产出的 Enum 值与 Double 结果', () => {
  const src = 'Module m.\n\nDefine Tier as one of Gold, Silver.\n\nRule pick given x as Int, produce Tier:\n  Return Gold.\n\nRule half given x as Int, produce Double:\n  Return x divided by 7.';
  const c = compile(src);
  assert.ok(c.success, JSON.stringify(c));
  const pick = evaluate(c.core!, 'pick', { x: 1 });
  assert.equal(toValueJson(pick.value), '{"_enum":"Tier","args":[],"value":"Gold","variant":"Gold"}');
  const half = evaluate(c.core!, 'half', { x: 100 });
  assert.equal(toValueJson(half.value), '14.285714285714286');
});
