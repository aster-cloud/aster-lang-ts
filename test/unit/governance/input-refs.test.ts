import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSource, resolveAndLowerChecked } from '../../../src/compile-pipeline.js';
import { analyzeInputRefs } from '../../../src/governance/input-refs.js';
import type { Core } from '../../../src/types.js';

// analyzeInputRefs 的单元性质（ADR 0046 §11.6），与 Java InputRefsAnalyzerTest 逐条对应。ADR §11.2 正反例表逐行、
// 补充规则 (a)–(c)、别名、遍历顺序与本地化用例在共享夹具中（input-refs-parity.test.ts）；这里只锁夹具之外的性质。

const HEAD = 'Module guard.unit.\nProfile "governed".\n\n'
  + 'Define Ctx has amount as Decimal, tier as Text, meta as Map Text to Text.\n'
  + 'Define Req has action as Text, context as Ctx.\n\n';

function resolveSrc(src: string): Core.Module {
  return resolveAndLowerChecked(parseSource(src).ast).core;
}

function func(m: Core.Module, name: string): Core.Func {
  const f = m.decls.find((d): d is Core.Func => d.kind === 'Func' && d.name === name);
  assert.ok(f, name);
  return f;
}

function refs(body: string): readonly string[] {
  const m = resolveSrc(`${HEAD}Rule decide given req as Req, produce Verdict:\n${body}`);
  return analyzeInputRefs(m, func(m, 'decide')).inputRefs;
}

test('星号独占且不与具体路径并存', () => {
  assert.deepEqual(refs('  If req.action equals to "x" and Map.get(req.context.meta, req.context.tier) equals to "y":\n'
    + '    Return Verdict.deny("d").\n  Return Verdict.allow().\n'), ['*']);
});

test('路径按 UTF-16 码元字典序去重', () => {
  assert.deepEqual(refs('  If req.context.tier equals to req.action and req.context.amount greater than 0 and req.action equals to "a":\n'
    + '    Return Verdict.deny("d").\n  Return Verdict.allow().\n'), ['action', 'context.amount', 'context.tier']);
});

test('不读输入的规则为空列表而非 undefined', () => {
  const m = resolveSrc(`${HEAD}@id("R")\nRule decide given req as Req, produce Verdict:\n  Return Verdict.allow().\n`);
  assert.deepEqual(func(m, 'decide').inputRefs, []);
});

test('未知档案的模块同样写入 inputRefs', () => {
  const m = resolveSrc('Module m.\nProfile "nope".\n\n'
    + 'Rule decide given amount, produce Verdict:\n  If amount at least 1:\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n');
  assert.deepEqual(func(m, 'decide').inputRefs, ['']);
});

test('未声明档案的模块不写 inputRefs', () => {
  const m = resolveSrc('Module m.\n\n'
    + 'Rule decide given amount, produce Verdict:\n  If amount at least 1:\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n');
  assert.equal('inputRefs' in func(m, 'decide'), false);
});

test('按 Return 推断为 Verdict 的规则也写入', () => {
  const m = resolveSrc(`${HEAD}Rule decide given req as Req, produce:\n`
    + '  If req.action equals to "x":\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n');
  assert.deepEqual(func(m, 'decide').inputRefs, ['action']);
});

test('同模块调用实参不含输入时不展开且不报递归', () => {
  assert.deepEqual(refs('  If loop(1):\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n\n'
    + 'Rule loop given n as Int, produce Bool:\n  Return loop(n).\n'), []);
});

test('自递归为 recursion', () => {
  const m = resolveSrc(`${HEAD}Rule decide given req as Req, produce Verdict:\n`
    + '  If deep(req.context):\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n\n'
    + 'Rule deep given c as Ctx, produce Bool:\n  Return deep(c).\n');
  assert.deepEqual(analyzeInputRefs(m, func(m, 'decide')), { inputRefs: ['*'], construct: 'recursion' });
});

test('被调函数返回值的来源随结果流回调用点', () => {
  assert.deepEqual(refs('  Let t be tierOf(req.context).\n  If t equals to "gold":\n    Return Verdict.allow().\n'
    + '  Return Verdict.deny("t").\n\nRule tierOf given c as Ctx, produce Text:\n  Return c.tier.\n'), ['context.tier']);
});

test('规则之外的形参不追踪但被调函数的全部形参都追踪', () => {
  assert.deepEqual(refs('  If both(1, req.action):\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n\n'
    + 'Rule both given n as Int, a as Text, produce Bool:\n  Return a equals to "x".\n'), ['action']);
});

test('lambda 体内的读取计入', () => {
  assert.deepEqual(refs('  Let f be function with x, produce:\n    Return req.context.amount greater than 0.\n'
    + '  Return Verdict.allow().\n'), ['context.amount']);
});

test('分析是纯函数', () => {
  const m = resolveSrc(`${HEAD}Rule decide given req as Req, produce Verdict:\n`
    + '  If req.action equals to "x":\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n');
  assert.deepEqual(analyzeInputRefs(m, func(m, 'decide')), analyzeInputRefs(m, func(m, 'decide')));
});

/** 评审复现（I1）：64×64 扇出、h3 约 1500 行 Let、150 条 Verdict 规则。修复前 TS 约 22 分钟。与 Java 同构。 */
function fanOutRepro(lets: number, rules: number, fan: number): string {
  let b = 'Module dos.repro.\nProfile "governed".\n\nDefine Ctx has amount as Decimal.\nDefine Req has context as Ctx.\n\n'
    + 'Rule h3 given c as Ctx, produce Bool:\n';
  for (let i = 0; i < lets; i++) b += `  Let x${i} be c.amount plus ${i}.\n`;
  b += '  Return c.amount greater than 0.\n\n';
  for (const [h, callee] of [['h2', 'h3'], ['h1', 'h2']]) {
    b += `Rule ${h} given c as Ctx, produce Bool:\n`;
    for (let i = 0; i < fan; i++) b += `  Let y${i} be ${callee}(c).\n`;
    b += '  Return true.\n\n';
  }
  for (let r = 0; r < rules; r++) {
    b += `@id("R-${r}")\nRule r${r} given req as Req, produce Verdict:\n  If h1(req.context):\n    Return Verdict.deny("x").\n  Return Verdict.allow().\n\n`;
  }
  return b;
}

test('评审复现的扇出调用链分析在一秒内完成', () => {
  const m = resolveSrc(fanOutRepro(1500, 150, 64));
  const start = performance.now();
  let rules = 0;
  for (const d of m.decls) {
    if (d.kind === 'Func' && d.name.startsWith('r')) {
      assert.deepEqual(analyzeInputRefs(m, d).inputRefs, ['context.amount']);
      rules++;
    }
  }
  const ms = performance.now() - start;
  assert.equal(rules, 150);
  assert.ok(ms < 1000, `150 条规则的分析耗时 ${ms} ms`);
});

test('节点预算耗尽为 inline-depth 且在一秒内完成', () => {
  const fx = JSON.parse(readFileSync(resolve(process.cwd(), 'shared', 'governance_input_refs_parity.json'), 'utf8')) as {
    cases: { name: string; source: string }[];
  };
  const src = fx.cases.find((c) => c.name === 'node-visit-budget')!.source;
  const m = resolveSrc(src);
  const start = performance.now();
  const r = analyzeInputRefs(m, func(m, 'decide'));
  const ms = performance.now() - start;
  assert.equal(r.construct, 'inline-depth');
  assert.ok(ms < 1000, `节点预算用例的分析耗时 ${ms} ms`);
});
