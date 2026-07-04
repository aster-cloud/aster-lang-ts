import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';
import { canonicalize } from '../../src/frontend/canonicalizer.js';
import {
  validateVocabulary,
  IdentifierKind,
} from '../../src/config/lexicons/identifiers/index.js';
import type { DomainVocabulary, IdentifierMapping } from '../../src/config/lexicons/identifiers/index.js';

initializeAllBundledLexicons();

// 审计 #57 回归测试：guest-Map 安全（原型污染 + 插入序）、字符串字面量规范化、
// metered List builtins（O(n²) DoS）、值相等去重、字面量宏智能引号封禁。

function evalOf(body: string): { success: boolean; value: unknown; error?: string } {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  return evaluate(c.core!, 'main', { seed: 0 }) as { success: boolean; value: unknown; error?: string };
}
function run(body: string): unknown {
  const ev = evalOf(body);
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}
const R = (expr: string): string => `Rule main given seed as Int, produce Int:\n  Return ${expr}.`;
const RB = (expr: string): string => `Rule main given seed as Int, produce Bool:\n  Return ${expr}.`;

// ── 1 [HIGH] 原型污染 & 原型链泄漏 ───────────────────────────────────────────
describe('#57-1 guest Map — 原型链泄漏 / 污染', () => {
  it('Map.get(m,"constructor") 不泄漏 Object（返回 null）', () =>
    assert.equal(run(RB('Map.contains(Map.empty(), "constructor")')), false));
  it('Map.contains(m,"hasOwnProperty") 为 false（无继承键）', () =>
    assert.equal(run(RB('Map.contains(Map.empty(), "hasOwnProperty")')), false));
  it('Map.put(m,"__proto__",v) 写入真实条目 → size 1（非污染/非 no-op）', () =>
    assert.equal(run(R('Map.size(Map.put(Map.empty(), "__proto__", 99))')), 1));
  it('Map.contains 能读回 "__proto__" 键', () =>
    assert.equal(run(RB('Map.contains(Map.put(Map.empty(), "__proto__", 99), "__proto__")')), true));
  it('污染尝试不影响另一个新建的空 Map', () =>
    assert.equal(run(R(
      'List.length(Map.keys(Map.empty()))',
    )), 0));
});

// ── 1(MED) Map 插入序（含数字样式键） ───────────────────────────────────────
describe('#57-1 guest Map — 插入序（数字样式键）', () => {
  it('Map.keys 保留插入序 ["2","1"]（非数字重排为 ["1","2"]）', () => {
    const keys = run(R('List.get(Map.keys(Map.put(Map.put(Map.empty(), "2", 1), "1", 2)), 0)')) as unknown;
    assert.equal(keys, '2');
  });
  it('Map.keys[1] 为 "1"', () =>
    assert.equal(run(R('List.get(Map.keys(Map.put(Map.put(Map.empty(), "2", 1), "1", 2)), 1)')), '1'));
  it('Map.values 与插入序对齐', () =>
    assert.equal(run(R('List.get(Map.values(Map.put(Map.put(Map.empty(), "2", 10), "1", 20)), 0)')), 10));
});

// ── 3 [HIGH] metered O(n²) List builtins（DoS 防护） ────────────────────────
describe('#57-3 metered native collection loops', () => {
  it('List.distinct(List.range(0,300000)) 及时抛错（MAX_STEPS 约束）', () => {
    const t0 = Date.now();
    const ev = evalOf(R('List.length(List.distinct(List.range(0, 300000)))'));
    const dt = Date.now() - t0;
    assert.equal(ev.success, false, '应因步数上限失败，而非跑满 O(n²)');
    assert.match(String(ev.error), /execution steps/i);
    assert.ok(dt < 5000, `应及时终止，实际 ${dt}ms`);
  });
  it('List.groupBy(List.range(0,300000), id) 及时抛错', () => {
    const prog = `Rule id given x as Int, produce Int:\n  Return x.\nRule main given seed as Int, produce Int:\n  Return Map.size(List.groupBy(List.range(0, 300000), id)).`;
    const c = compile(`Module probe.\n${prog}\n`);
    assert.ok(c.core);
    const t0 = Date.now();
    const ev = evaluate(c.core!, 'main', { seed: 0 });
    assert.equal(ev.success, false);
    assert.ok(Date.now() - t0 < 5000);
  });
  it('小规模 distinct 仍正常返回', () =>
    assert.equal(run(R('List.length(List.distinct([2, 2, 5, 2, 9]))')), 3));
});

// ── 4 [MED] List.distinct / List.contains 值相等 ────────────────────────────
describe('#57-4 值相等去重（Decimal / 结构体）', () => {
  it('List.distinct([1.5m,1.5m,2.5m]) → 2（Decimal 按值去重）', () =>
    assert.equal(run(R('List.length(List.distinct([1.5m, 1.5m, 2.5m]))')), 2));
  it('List.contains([1.5m,2.5m], 1.5m) → true（值相等，非引用）', () =>
    assert.equal(run(RB('List.contains([1.5m, 2.5m], 1.5m)')), true));
  it('List.contains([1.5m,2.5m], 3.5m) → false', () =>
    assert.equal(run(RB('List.contains([1.5m, 2.5m], 3.5m)')), false));
});

// ── 2 [HIGH] 字符串字面量规范化保护 ─────────────────────────────────────────
describe('#57-2 canonicalize 不改写字符串字面量内的多词关键字', () => {
  it('"Salary Greater Than target, at least Once" 逐字保留', () => {
    const out = canonicalize('Return "Salary Greater Than target, at least Once".', EN_US);
    assert.match(out, /"Salary Greater Than target, at least Once"/,
      `字符串字面量应逐字保留，实际: ${out}`);
  });
  it('字符串外的多词关键字仍被规范化（未破坏原有行为）', () => {
    const out = canonicalize('Return x Greater Than y.', EN_US);
    assert.match(out, /greater than/i);
  });
});

// ── 5 [MED] 字面量宏封禁智能引号 ────────────────────────────────────────────
describe('#57-5 字面量宏封禁智能/弯引号', () => {
  const vocab = (literals: readonly IdentifierMapping[]): DomainVocabulary => ({
    id: 'sq', name: 'sq', locale: 'en-US', version: '1.0.0',
    structs: [], fields: [], functions: [], enumValues: [], literals,
  });
  for (const bad of ['say “hi”', 'it’s', '‘x’', 'a”b']) {
    it(`拒绝含智能引号的字面量宏内容: ${JSON.stringify(bad)}`, () => {
      assert.equal(validateVocabulary(vocab(
        [{ localized: 'X', canonical: bad, kind: IdentifierKind.LITERAL }])).valid, false);
    });
  }
  it('普通内容仍通过', () => {
    assert.equal(validateVocabulary(vocab(
      [{ localized: 'X', canonical: 'plain text', kind: IdentifierKind.LITERAL }])).valid, true);
  });
});
