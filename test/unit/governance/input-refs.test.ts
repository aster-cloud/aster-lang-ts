import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSource, resolveAndLowerChecked } from '../../../src/compile-pipeline.js';
import { analyzeInputRefs, inputRefsNodeVisits, MAX_NODE_VISITS } from '../../../src/governance/input-refs.js';
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

test('未声明档案的模块 inputRefs 为 null（未计算）', () => {
  const m = resolveSrc('Module m.\n\n'
    + 'Rule decide given amount, produce Verdict:\n  If amount at least 1:\n    Return Verdict.deny("d").\n  Return Verdict.allow().\n');
  assert.equal(func(m, 'decide').inputRefs, null);
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

// ★守的缺陷（I1 编译期 DoS）：同模块调用若不记忆化，h1→h2→h3 每层扇出都重遍历被调函数体，访问数为 扇出²×函数体；
// 节点预算若不生效，恶意扇出没有上限。原先断言 150 条规则「在一秒内完成」——墙钟受 CI 机器快慢与 c8 下并行测试文件
// 争用影响（本机 ~280 ms，CI 上 1011 / 1093 ms 误报），这里改用分析器自己的节点访问数（与 MAX_NODE_VISITS 同口径）
// 做确定性的守卫：量工作量与它随规模的增长率，而非绝对耗时。

/** 评审复现中某条 Verdict 规则的节点访问数（各规则同构，取第一条）。 */
function reproVisits(lets: number, fan: number): number {
  const m = resolveSrc(fanOutRepro(lets, 1, fan));
  return inputRefsNodeVisits(m, func(m, 'r0'));
}

test('评审复现的扇出调用链分析：访问数与源码同阶且远离预算', () => {
  const m = resolveSrc(fanOutRepro(1500, 150, 64));
  const rules = m.decls.filter((d): d is Core.Func => d.kind === 'Func' && d.name.startsWith('r'));
  assert.equal(rules.length, 150);
  const visits = new Set(rules.map((d) => inputRefsNodeVisits(m, d)));
  // 每条规则独立分析、互不累积：150 条同构规则的访问数相同
  assert.equal(visits.size, 1, `各规则访问数不一致：${[...visits].join(', ')}`);
  const [v] = [...visits] as [number];
  // 记忆化后约为 3×Let 行数 + 4×扇出（~4.8 千）；不记忆化时会撞上预算（20 万）
  assert.ok(v < MAX_NODE_VISITS / 10, `单条规则访问 ${v} 次，接近节点预算 ${MAX_NODE_VISITS}——记忆化失效？`);
  for (const d of rules) assert.deepEqual(analyzeInputRefs(m, d).inputRefs, ['context.amount']);
});

test('评审复现的访问数随函数体与扇出线性增长', () => {
  // 规模取在预算之下（不记忆化时大的一档约 3 万次），否则两档都止于预算、比值失真
  const small = reproVisits(20, 8);
  const large = reproVisits(40, 16);
  // 函数体与扇出同时翻倍：线性时访问数至多翻倍；扇出²×函数体时约为 8 倍
  assert.ok(large <= 2.2 * small, `规模翻倍后访问数 ${small} → ${large}（${(large / small).toFixed(2)} 倍），超出线性`);
});

test('节点预算耗尽为 inline-depth 且访问数止于预算', () => {
  const fx = JSON.parse(readFileSync(resolve(process.cwd(), 'shared', 'governance_input_refs_parity.json'), 'utf8')) as {
    cases: { name: string; source: string }[];
  };
  const src = fx.cases.find((c) => c.name === 'node-visit-budget')!.source;
  const m = resolveSrc(src);
  assert.equal(analyzeInputRefs(m, func(m, 'decide')).construct, 'inline-depth');
  const visits = inputRefsNodeVisits(m, func(m, 'decide'));
  // 预算耗尽后每个表达式只计一次编号即返回，余下的只是各活动帧剩余语句（本例超出约 110 次）
  assert.ok(visits > MAX_NODE_VISITS, `访问 ${visits} 次即结束，用例未触及预算`);
  assert.ok(visits <= MAX_NODE_VISITS * 1.01, `访问 ${visits} 次，预算 ${MAX_NODE_VISITS} 后仍在展开——预算未生效？`);
});

// 第三轮审查 C1：记忆化键必须按结构比较（与 Java 同场景）。用户提交的 Core IR 可以在点路径段里带控制字符，
// 字符串拼接键会把 {"context.meta.a\u0001zone"} 与 {"context.meta.a", "zone"} 当成同一实参。
test('记忆化键按结构比较：路径段含控制字符也不碰撞', () => {
  const src = 'Module guard.memo.\nProfile "governed".\n\n'
    + 'Define Ctx has meta as Map Text to Text.\nDefine Req has context as Ctx, zone as Text.\n\n'
    + 'Rule g given m as Text, produce Bool:\n  Return m equals to "x".\n\n'
    + 'Rule decide given req as Req, produce Verdict:\n'
    + '  Let b be [Maybe.withDefault(Map.get(req.context.meta, "a"), ""), req.zone].\n'
    + '  Let r1 be g(b).\n  Let a be req.context.meta.aXzone.\n  Let r2 be g(a).\n'
    + '  If r1 and r2:\n    Return Verdict.deny("x").\n  Return Verdict.allow().\n';
  const m = JSON.parse(JSON.stringify(resolveSrc(src)).replaceAll('aXzone', 'a\\u0001zone')) as Core.Module;
  assert.deepEqual(analyzeInputRefs(m, func(m, 'decide')).inputRefs, ['context.meta.a', 'context.meta.a\u0001zone', 'zone']);
});
