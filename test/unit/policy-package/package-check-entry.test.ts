import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_EVAL_LIMITS } from '../../../src/policy-package/evaluate-package.js';
import {
  checkProbes,
  CompileFailure,
  compileSourcePositionFreeSha256,
  CoreIrFormatError,
  TS_VERSION,
  type CheckProbesOptions,
} from '../../../src/policy-package/package-check.js';
import { PACKAGE_V1 } from '../../helpers/package-v1.js';

// `./package-check` 子路径（ADR 0059 P2 T23，修订 3 P2-R5 / P2-R7 / P2-R13）：对 package-v1 黄金包的行为。
// Workers 安全（打包后在禁止动态生成代码的 Node 中运行）见 package-check-bundle.test.ts。
const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;
const pkgFile = (pkg: string, p: string): string => readFileSync(join(PACKAGE_V1!, 'packages', pkg, p), 'utf8');
const manifest = (pkg: string): { source: { locale: string; allowStructural: boolean }; coreIr: { positionFreeSha256: string } } =>
  JSON.parse(pkgFile(pkg, 'manifest.json'));
/** 修订 3 P2-R13 的 cloud 取值。 */
const CLOUD: CheckProbesOptions = { maxSteps: 5_000_000, maxCallDepth: 10_000, deadlineMs: 20_000 };

test('TS_VERSION 是构建时盖章的 package.json 版本', () => {
  const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
  assert.equal(TS_VERSION, version);
});

for (const pkg of ['b-vocab-de', 'b-zh', 'b-alias', 'b-credit-limit']) {
  test(`重编译投影哈希等于黄金 manifest：${pkg}`, { skip }, () => {
    const m = manifest(pkg);
    let vocabularyJson: string | undefined;
    try {
      vocabularyJson = pkgFile(pkg, 'policy/compile/vocabulary.json');
    } catch {
      vocabularyJson = undefined;
    }
    const hash = compileSourcePositionFreeSha256(pkgFile(pkg, 'policy/policy.aster'), {
      locale: m.source.locale,
      aliasSetJson: pkgFile(pkg, 'policy/compile/alias-set.json'),
      allowStructural: m.source.allowStructural,
      ...(vocabularyJson === undefined ? {} : { vocabularyJson }),
    });
    assert.equal(hash, m.coreIr.positionFreeSha256);
  });
}

test('编译输入被篡改时投影哈希改变或编译失败（cloud 据此报 E739）', { skip }, () => {
  const m = manifest('b-vocab-de');
  const source = pkgFile('b-vocab-de', 'policy/policy.aster');
  const opts = { aliasSetJson: 'null', allowStructural: false, vocabularyJson: pkgFile('b-vocab-de', 'policy/compile/vocabulary.json') };
  let drifted: boolean;
  try {
    drifted = compileSourcePositionFreeSha256(source, { ...opts, locale: 'en-US' }) !== m.coreIr.positionFreeSha256;
  } catch (e) {
    drifted = e instanceof CompileFailure;
  }
  assert.ok(drifted);
  assert.throws(() => compileSourcePositionFreeSha256('  \n', { locale: 'en-US', aliasSetJson: 'null', allowStructural: false }), CompileFailure);
  assert.throws(() => compileSourcePositionFreeSha256(source, { ...opts, locale: 'de-DE', aliasSetJson: '{"NoSuchKind":["x"]}' }), CompileFailure);
});

for (const pkg of ['a-decimal', 'a-inputs', 'a-multi-entry', 'a-deep-recursion']) {
  test(`探针全部一致：${pkg}`, { skip }, () => {
    const r = checkProbes(pkgFile(pkg, 'compiled/core.json'), pkgFile(pkg, 'tests/probes.json'), CLOUD);
    assert.ok(r.count > 0);
    assert.deepEqual(r, { count: r.count, agreed: r.count, firstMismatch: null });
  });
}

test('a-bad-probe：第 2 条（下标 1）不一致，其余照常统计', { skip }, () => {
  const r = checkProbes(pkgFile('a-bad-probe', 'compiled/core.json'), pkgFile('a-bad-probe', 'tests/probes.json'), CLOUD);
  assert.equal(r.firstMismatch?.index, 1);
  assert.equal(r.agreed, r.count - 1);
  assert.match(r.firstMismatch!.expected, /"99\.99"/);
  assert.match(r.firstMismatch!.actual, /^\{"ok":true,"value":/);
});

test('a-timeout：指数递归的探针在 maxSteps 1000 下计为不一致而不是挂住；墙钟超限同样计为不一致', { skip }, () => {
  const core = pkgFile('a-timeout', 'compiled/core.json');
  // 黄金探针 spin(3) 很小，照常一致；spin(40) 约 2^40 次调用，只有步数上限能让它及时停下
  assert.equal(checkProbes(core, pkgFile('a-timeout', 'tests/probes.json'), { ...CLOUD, maxSteps: 1000 }).agreed, 1);
  const heavy = JSON.stringify({ probes: [{ entry: 'spin', expected: { ok: true, value: 1099511627776 }, input: { n: 41 } }] });
  const steps = checkProbes(core, heavy, { ...CLOUD, maxSteps: 1000 });
  assert.deepEqual(steps, { count: 1, agreed: 0, firstMismatch: { index: 0, expected: '{"ok":true,"value":1099511627776}', actual: '{"code":"RESOURCE_EXHAUSTED","ok":false}' } });
  const late = checkProbes(core, pkgFile('a-timeout', 'tests/probes.json'), { ...CLOUD, deadlineMs: -1 });
  assert.deepEqual(late, { count: 1, agreed: 0, firstMismatch: { index: 0, expected: '{"ok":true,"value":4}', actual: '{"code":"TIMEOUT","ok":false}' } });
});

test('调用深度超限计为不一致；期望 EVAL_ERROR 的探针只与 EVAL_ERROR 一致', { skip }, () => {
  const core = pkgFile('a-deep-recursion', 'compiled/core.json');
  const probes = pkgFile('a-deep-recursion', 'tests/probes.json');
  const shallow = checkProbes(core, probes, { ...CLOUD, maxCallDepth: 3 });
  assert.equal(shallow.firstMismatch?.actual, '{"code":"RESOURCE_EXHAUSTED","ok":false}');
  const multi = JSON.parse(pkgFile('a-multi-entry', 'tests/probes.json')) as { probes: { expected: { ok: boolean } }[] };
  assert.ok(multi.probes.some((p) => p.expected.ok === false), 'a-multi-entry 应含期望 EVAL_ERROR 的探针');
});

test('单条探针形状、入口、输入不合法计为不一致；整体形状不合法与 IR 读入失败抛错', { skip }, () => {
  const core = pkgFile('a-decimal', 'compiled/core.json');
  const doc = JSON.parse(pkgFile('a-decimal', 'tests/probes.json')) as { probes: { entry: string; input: unknown; expected: unknown }[] };
  const first = doc.probes[0]!;
  const bad = JSON.stringify({ probes: [42, { ...first, entry: 'nosuch' }, { ...first, input: { nosuch: 1 } }, first] });
  const r = checkProbes(core, bad, CLOUD);
  assert.equal(r.count, 4);
  assert.equal(r.agreed, 1);
  assert.equal(r.firstMismatch?.actual, '{"code":"ENTRY_NOT_FOUND","ok":false}');
  assert.equal(checkProbes(core, JSON.stringify({ probes: [doc.probes[0], { ...first, input: { nosuch: 1 } }] }), CLOUD).firstMismatch?.actual,
    '{"code":"INPUT_INVALID","ok":false}');
  assert.throws(() => checkProbes(core, '{"probes":{}}', CLOUD), /probes/);
  assert.throws(() => checkProbes(core, '{"probes":[]', CLOUD));
  assert.throws(() => checkProbes('{"schemaVersion":2}', pkgFile('a-decimal', 'tests/probes.json'), CLOUD), CoreIrFormatError);
});

test('墙钟在探针之间推进时，超过 deadlineMs 的那条与其后各条计为 TIMEOUT', { skip }, () => {
  const core = pkgFile('a-multi-entry', 'compiled/core.json');
  const probes = pkgFile('a-multi-entry', 'tests/probes.json');
  // 每读一次时钟前进 10 ms：start=0，第 1 条前后 10/20，第 2 条前后 30/40 —— deadline 25 在第 2 条开始前越过
  let t = -10;
  const r = checkProbes(core, probes, { ...CLOUD, deadlineMs: 25, now: () => (t += 10) });
  assert.deepEqual(r, { count: 3, agreed: 1, firstMismatch: { index: 1, expected: '{"ok":true,"value":"high"}', actual: '{"code":"TIMEOUT","ok":false}' } });
  // 求值期间越过 deadline（开始前未超、结束后已超）同样计为 TIMEOUT
  let u = 0;
  const during = checkProbes(core, probes, { ...CLOUD, deadlineMs: 5, now: () => (u++ === 0 ? 0 : u === 2 ? 1 : 100) });
  assert.equal(during.agreed, 0);
  assert.equal(during.firstMismatch?.actual, '{"code":"TIMEOUT","ok":false}');
});

test('maxTotalSteps：合计步数预算用尽后其余各条计为 RESOURCE_EXHAUSTED', { skip }, () => {
  const core = pkgFile('a-timeout', 'compiled/core.json');
  const probe = { entry: 'spin', expected: { ok: true, value: 4 }, input: { n: 3 } };
  const probes = JSON.stringify({ probes: [probe, probe, probe] });
  assert.equal(checkProbes(core, probes, CLOUD).agreed, 3);
  // 单条 spin(3) 远少于 1000 步；合计预算只够一条多一点
  const one = checkProbes(core, probes, { ...CLOUD, maxTotalSteps: 1 });
  assert.deepEqual(one, { count: 3, agreed: 0, firstMismatch: { index: 0, expected: '{"ok":true,"value":4}', actual: '{"code":"RESOURCE_EXHAUSTED","ok":false}' } });
  const plenty = checkProbes(core, probes, { ...CLOUD, maxTotalSteps: 1_000_000 });
  assert.equal(plenty.agreed, 3);
});

test('entries：与 CLI 一样，入口不在可运行入口集合中计为 ENTRY_NOT_FOUND', { skip }, () => {
  const core = pkgFile('a-multi-entry', 'compiled/core.json');
  const probes = pkgFile('a-multi-entry', 'tests/probes.json');
  assert.equal(checkProbes(core, probes, { ...CLOUD, entries: ['score', 'label', 'ratio', 'answer'] }).agreed, 3);
  const r = checkProbes(core, probes, { ...CLOUD, entries: ['score'] });
  assert.deepEqual(r, { count: 3, agreed: 1, firstMismatch: { index: 1, expected: '{"ok":true,"value":"high"}', actual: '{"code":"ENTRY_NOT_FOUND","ok":false}' } });
});

test('CLI 的求值上限不变（步数不设限，调用深度 10 000）', () => {
  assert.deepEqual(CLI_EVAL_LIMITS, { maxSteps: Number.MAX_SAFE_INTEGER, maxCallDepth: 10_000 });
});
