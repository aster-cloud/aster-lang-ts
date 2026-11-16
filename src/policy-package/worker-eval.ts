/**
 * 求值 Worker（ADR 0059 §4.3、修订 1 A4）：主线程以 `resourceLimits.stackSizeMb = 32` 启动 Worker，
 * Worker 先发 `started`（主线程从此刻起计时），再同步求值并发回结果；到点未返回由主线程 `terminate()`。
 * dist 形态由 `worker-entry.ts` 启动本函数，单文件 bundle 由 `scripts/runner-entry.ts` 在非主线程时启动。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { evaluatePackage, type EvaluatePackageResult } from './evaluate-package.js';
import type { JsonValue } from './strict-json.js';

/** 主线程交给 Worker 的任务。 */
export interface EvalJob {
  readonly coreJson: string;
  readonly entry: string;
  readonly input: { [key: string]: JsonValue };
}

/** Worker 发回的消息。 */
export type WorkerMessage = { readonly type: 'started' } | { readonly type: 'result'; readonly result: EvaluatePackageResult };

/** Worker 侧入口。 */
export function runEvalWorker(): void {
  const port = parentPort;
  if (!port) throw new Error('runEvalWorker 只能在 Worker 线程中调用');
  const job = workerData as EvalJob;
  port.postMessage({ type: 'started' } satisfies WorkerMessage);
  port.postMessage({ type: 'result', result: evaluatePackage(job.coreJson, job.entry, job.input) } satisfies WorkerMessage);
}
