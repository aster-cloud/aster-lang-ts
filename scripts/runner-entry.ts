/**
 * 单文件 runner `dist/runner/aster.mjs` 的入口（ADR 0059 P1 T5）。
 *
 * 主线程：解析 argv，调 `runCommand`（与 `scripts/aster.ts` 的六个包格式子命令同一入口），写 stdout / stderr 并设置退出码。
 * 非主线程：作为求值 Worker 运行——`runCommand` 以本文件自身（`import.meta.url`）启动 Worker，单文件即可自举。
 */
import { isMainThread } from 'node:worker_threads';
import { readAll, runCommand } from '../src/policy-package/cli.js';
import { runEvalWorker } from '../src/policy-package/worker-eval.js';

async function main(): Promise<void> {
  const r = await runCommand(process.argv.slice(2), { stdin: () => readAll(process.stdin), workerUrl: new URL(import.meta.url) });
  for (const l of r.stderr) process.stderr.write(`${l}\n`);
  process.stdout.write(r.stdoutBytes ?? r.stdout);
  process.exitCode = r.exitCode;
}

if (isMainThread) await main();
else runEvalWorker();
