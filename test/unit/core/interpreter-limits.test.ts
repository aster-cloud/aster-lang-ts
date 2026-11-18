import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { compile } from '../../../src/browser.js';
import { evaluate, ResourceExhaustedError } from '../../../src/core/interpreter.js';

// 解释器调用深度上限可配置，超限与 JS 栈溢出归为资源耗尽（ADR 0059 修订 1 A4，P1 T3）。
const SRC = 'Module m.\n\nRule deep given n as Int, produce Int:\n  If n less than 1\n    Return 0.\n  Return 1 plus deep(n minus 1).';
const core = (): NonNullable<ReturnType<typeof compile>['core']> => {
  const c = compile(SRC);
  assert.ok(c.success, JSON.stringify(c));
  return c.core!;
};

test('缺省调用深度仍为 50（浏览器 / cloud 行为不变），超限标为 resource', () => {
  assert.equal(evaluate(core(), 'deep', { n: 40 }).value, 40);
  const r = evaluate(core(), 'deep', { n: 60 });
  assert.equal(r.success, false);
  assert.equal(r.errorKind, 'resource');
  assert.match(r.error!, /Maximum call depth \(50\) exceeded/);
});

test('maxCallDepth 超限报 resource，其余失败不带 errorKind', () => {
  const r = evaluate(core(), 'deep', { n: 200 }, { maxCallDepth: 100 });
  assert.equal(r.errorKind, 'resource');
  const missing = evaluate(core(), 'nosuch', {});
  assert.equal(missing.success, false);
  assert.equal(missing.errorKind, undefined);
  assert.ok(new ResourceExhaustedError('x') instanceof Error);
});

/** 在 stackSizeMb=32 的 Worker 中跑 deep(n)（与 CLI 同一配置）。 */
async function inWorker(n: number, maxCallDepth: number, stackSizeMb?: number): Promise<{ success: boolean; value?: unknown; errorKind?: string }> {
  const url = new URL('../../../src/core/interpreter.js', import.meta.url).href;
  const browser = new URL('../../../src/browser.js', import.meta.url).href;
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    Promise.all([import(${JSON.stringify(browser)}), import(${JSON.stringify(url)})]).then(([b, i]) => {
      const c = b.compile(workerData.src);
      const r = i.evaluate(c.core, 'deep', { n: workerData.n }, { maxSteps: Number.MAX_SAFE_INTEGER, maxCallDepth: workerData.d });
      parentPort.postMessage({ success: r.success, value: r.value, errorKind: r.errorKind });
    });`;
  const w = new Worker(code, { eval: true, workerData: { src: SRC, n, d: maxCallDepth }, ...(stackSizeMb ? { resourceLimits: { stackSizeMb } } : {}) });
  try {
    return await new Promise((res, rej) => {
      w.once('message', res);
      w.once('error', rej);
    });
  } finally {
    await w.terminate();
  }
}

test('stackSizeMb=32 的 Worker 中 maxCallDepth=10000 时 5000 层递归成功、20000 层报 resource', async () => {
  assert.deepEqual(await inWorker(5000, 10_000, 32), { success: true, value: 5000, errorKind: undefined });
  const r = await inWorker(20_000, 10_000, 32);
  assert.equal(r.success, false);
  assert.equal(r.errorKind, 'resource');
});

test('JS 栈溢出归为 resource（缺省栈的 Worker 中放开深度上限）', async () => {
  const r = await inWorker(200_000, 1_000_000, 4);
  assert.equal(r.success, false);
  assert.equal(r.errorKind, 'resource');
});

test('evaluate 报告执行步数；超过 maxSteps 标为 resource（message 不变）', () => {
  const ok = evaluate(core(), 'deep', { n: 5 });
  assert.equal(ok.success, true);
  assert.ok(typeof ok.steps === 'number' && ok.steps > 0);
  const r = evaluate(core(), 'deep', { n: 40 }, { maxSteps: 10 });
  assert.equal(r.success, false);
  assert.equal(r.errorKind, 'resource');
  assert.match(r.error!, /Maximum execution steps \(10\) exceeded/);
  assert.equal(r.steps, 11);
});
