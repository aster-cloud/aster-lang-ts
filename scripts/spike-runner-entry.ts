/**
 * ADR 0059 P0-T0.2 实测入口（spike，不合并）。
 *
 * 只引入 runner 需要的模块：readCoreIr、evaluate、compile（含内置词法表）、canonicalJson、
 * ajv 2020、fflate 流式解压、node:crypto Ed25519。主线程自启 Worker（同一个文件），
 * Worker 里同步求值，主线程到点 terminate()。
 *
 * 用法：
 *   node aster.mjs eval <core.json> <entry> <ctx-json> [timeoutMs]
 *   node aster.mjs compile <file.aster>
 *   node aster.mjs selfcheck
 */
import { isMainThread, Worker, workerData, parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Unzip, UnzipInflate, zipSync, strToU8 } from 'fflate';
import { readCoreIr } from '../src/core/read-core-ir.js';
import { evaluate, serializeGuestValue } from '../src/core/interpreter.js';
import { canonicalJson } from '../src/core/canonical-json.js';
import { compile } from '../src/browser.js';

interface EvalJob {
  coreJson: string;
  entry: string;
  ctx: Record<string, unknown>;
}

function workerMain(job: EvalJob): void {
  const t0 = performance.now();
  const core = readCoreIr(job.coreJson);
  const parsedMs = performance.now() - t0;
  const r = evaluate(core, job.entry, job.ctx, { maxSteps: Number.MAX_SAFE_INTEGER });
  parentPort!.postMessage({
    ok: r.success,
    valueJson: r.success ? serializeGuestValue(r.value) : null,
    error: r.error ?? null,
    parsedMs,
    evalMs: r.executionTimeMs,
  });
}

async function runEval(args: string[]): Promise<void> {
  const [coreFile, entry, ctxJson, timeoutArg] = args;
  const job: EvalJob = {
    coreJson: readFileSync(coreFile!, 'utf8'),
    entry: entry!,
    ctx: JSON.parse(ctxJson ?? '{}') as Record<string, unknown>,
  };
  const timeoutMs = Number(timeoutArg ?? 5000);
  const started = performance.now();
  // SPIKE_STACK_MB：实测 Worker 线程栈大小对递归深度的影响
  const stackMb = process.env['SPIKE_STACK_MB'];
  const worker = new Worker(new URL(import.meta.url), stackMb
    ? { workerData: job, resourceLimits: { stackSizeMb: Number(stackMb) } }
    : { workerData: job });
  const outcome = await new Promise<Record<string, unknown>>((resolve) => {
    const timer = setTimeout(() => {
      void worker.terminate().then(() => resolve({ ok: false, error: 'TIMEOUT' }));
    }, timeoutMs);
    worker.once('message', (m: Record<string, unknown>) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(m);
    });
    worker.once('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `worker error: ${e.message}` });
    });
  });
  outcome['wallMs'] = Math.round(performance.now() - started);
  process.stdout.write(JSON.stringify(outcome) + "\n");
}

function runCompile(args: string[]): void {
  const r = compile(readFileSync(args[0]!, 'utf8'));
  if (!r.success) {
    process.stderr.write(JSON.stringify(r) + '\n');
    process.exitCode = 4;
    return;
  }
  process.stdout.write(r.coreJson!);
}

/** 让 bundle 真正引用 ajv / fflate / Ed25519，量体积时不被 tree-shake 掉。 */
function runSelfcheck(): void {
  const ajv = new Ajv2020({ strict: true });
  // 覆盖 ajv 生成代码会引用的运行时 helper（ucs2length / equal / uri），确认 bundle 内可用
  const ok = ajv.validate({ type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] }, { a: 1 })
    && ajv.validate({ type: 'string', minLength: 2 }, 'ab') && !ajv.validate({ type: 'string', minLength: 2 }, '\u{1F600}')
    && ajv.validate({ const: { x: [1, 2] } }, { x: [1, 2] })
    && !ajv.validate({ type: 'array', uniqueItems: true }, [{ a: 1 }, { a: 1 }])
    && ajv.validate({ $id: 'https://e/x', type: 'object', properties: { r: { $ref: '#/$defs/i' } }, $defs: { i: { type: 'integer' } } }, { r: 3 });
  const zip = zipSync({ 'a.txt': strToU8('hello') });
  let total = 0;
  const unz = new Unzip((file) => {
    file.ondata = (_err, chunk) => { total += chunk.length; };
    file.start();
  });
  unz.register(UnzipInflate);
  unz.push(zip, true);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const msg = Buffer.from(canonicalJson({ b: 1, a: [true, null] }));
  const sig = sign(null, msg, privateKey);
  process.stdout.write(canonicalJson({ ajv: ok, unzipBytes: total, ed25519: verify(null, msg, publicKey, sig) }) + '\n');
}

if (!isMainThread) {
  workerMain(workerData as EvalJob);
} else {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'eval') await runEval(rest);
  else if (cmd === 'compile') runCompile(rest);
  else if (cmd === 'selfcheck') runSelfcheck();
  else {
    process.stderr.write('usage: aster.mjs eval|compile|selfcheck …\n');
    process.exitCode = 2;
  }
}
