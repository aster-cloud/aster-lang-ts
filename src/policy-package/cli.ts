/**
 * 包格式 v1 的 `aster` 子命令：`compile`、`run`、`verify`、`inspect`、`version`（ADR 0059 §4.1，P1 T4）。
 *
 * 行为以 aster-lang-test `conformance/package-v1/README.md` 为准：检查顺序、`meta` 的取值时机、`verify` 的检查项与
 * 「第一项失败即停止」、固定 message、stdout 恒为一行值规范 JSON + `\n`、诊断只写 stderr。
 * {@link runCommand} 是纯函数式入口（返回 stdout / stderr / 退出码），`scripts/aster.ts` 与单文件 bundle 都只调它。
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { MAX_INPUT_BYTES } from './paths.js';
import { Worker } from 'node:worker_threads';
import { anchorKids, builtinTrustAnchor, loadTrustAnchor, type TrustAnchor } from './trust-anchor.js';
import { parseArgs, type ParsedArgs } from './argv.js';
import { cliVersion, ENGINE, toolchainId } from './cli-version.js';
import { ERROR_CODES, PackageError, type ErrorCode, type Stage } from './errors.js';
import type { EvaluatePackageResult } from './evaluate-package.js';
import { findFunc, parseInput, validateInputTree, type IrView } from './input.js';
import { verifyIntegrity, payload } from './integrity.js';
import { defaultEntry, SUPPORTED_CORE_IR_VERSIONS, SUPPORTED_FORMAT_VERSIONS } from './manifest.js';
import {
  CompileFailure,
  compilePackageSource,
  compileSource,
  parseAliasSetJson,
  parseVocabularyJson,
  positionFreeSha256,
  readCompiledIr,
  recompileAndCompare,
} from './obtain-ir.js';
import { readPackage, type LoadedPackage } from './read-package.js';
import { verifySignature } from './signature.js';
import { decodeUtf8Strict, isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';
import { valueJson, type ValueTree } from './value-json.js';
import type { EvalJob, WorkerMessage } from './worker-eval.js';

/** 子命令的执行结果。 */
export interface CommandResult {
  readonly stdout: string;
  readonly exitCode: number;
  readonly stderr: string[];
}

export interface CommandIo {
  /** 读取全部 stdin（只在 `--input -` 时调用） */
  readonly stdin: () => Promise<Uint8Array>;
  /** 求值 Worker 的入口模块；缺省为 dist 中的 `worker-entry.js`，单文件 bundle 传自身 */
  readonly workerUrl?: URL;
}

/** Worker 线程栈（修订 1 A4）。 */
export const WORKER_STACK_SIZE_MB = 32;

/** 失败信封里的 `meta`（README「输出」的取值时机表）。 */
interface Meta {
  signed: boolean;
  entry: string | null;
  coreIrSha256: string | null;
  irRecompiled: boolean;
}

const newMeta = (): Meta => ({ signed: false, entry: null, coreIrSha256: null, irRecompiled: false });

function metaTree(m: Meta): ValueTree {
  return { cliVersion: cliVersion(), coreIrSha256: m.coreIrSha256, engine: ENGINE, entry: m.entry, irRecompiled: m.irRecompiled, signed: m.signed };
}

const line = (tree: ValueTree): string => `${valueJson(tree)}\n`;

function errorEnvelope(code: ErrorCode, meta: Meta): string {
  return line({ error: { code, message: ERROR_CODES[code].message }, meta: metaTree(meta), ok: false });
}

/** 运行时上下文：收集 stderr。 */
class Ctx {
  readonly stderr: string[] = [];
  constructor(readonly io: CommandIo) {}
  diag(e: PackageError): void {
    this.stderr.push(`aster: ${e.code}（${e.stage}）：${e.detail}`);
  }
}

const resultOf = (ctx: Ctx, stdout: string, exitCode: number): CommandResult => ({ stdout, exitCode, stderr: ctx.stderr });

/** 失败信封结果。 */
function failed(ctx: Ctx, e: PackageError, meta: Meta): CommandResult {
  ctx.diag(e);
  return resultOf(ctx, errorEnvelope(e.code, meta), e.exitCode);
}

/**
 * 读取流的全部字节，至多 `maxBytes` 字节（缺省为 `--input` 上限 + 1）：超出上限时停止读取并返回已读部分，
 * 调用方按长度判定 `INPUT_INVALID`，不把超大输入整个读进内存。
 */
export async function readAll(stream: NodeJS.ReadableStream, maxBytes: number = MAX_INPUT_BYTES + 1): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of stream) {
    const b = typeof c === 'string' ? Buffer.from(c) : (c as Buffer);
    // 按剩余额度复制，不保留超大单块的原缓冲
    const take = Math.min(b.length, maxBytes - total);
    chunks.push(Buffer.from(b.subarray(0, take)));
    total += take;
    if (total >= maxBytes) break;
  }
  return Buffer.concat(chunks, total);
}

async function anchorOf(args: ParsedArgs): Promise<TrustAnchor> {
  return loadTrustAnchor({ jwks: args.values.get('jwks'), pubkey: args.values.get('pubkey') });
}

/** read → manifest → signature → integrity，逐步更新 meta.signed。 */
function loadTrusted(path: string, anchor: TrustAnchor, allowUnsigned: boolean, meta: Meta): LoadedPackage {
  const pkg = readPackage(path);
  meta.signed = verifySignature(pkg, anchor, { allowUnsigned }).signed;
  verifyIntegrity(pkg);
  return pkg;
}

function factsWarning(ctx: Ctx, pkg: LoadedPackage): void {
  const sources = pkg.manifest.governance.factSources;
  if (sources.length > 0) ctx.stderr.push(`facts unverified: ${sources.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 求值（Worker + 超时）
// ---------------------------------------------------------------------------

export type EvalOutcome = EvaluatePackageResult | { readonly ok: false; readonly code: 'TIMEOUT' | 'RESOURCE_EXHAUSTED' | 'EVAL_ERROR'; readonly message: string };

/** 在 Worker 中求值；Worker 发出 `started` 后开始计时，到点 `terminate()` 并报 TIMEOUT。 */
export function evaluateInWorker(job: EvalJob, timeoutMs: number, workerUrl: URL): Promise<EvalOutcome> {
  return new Promise((resolve) => {
    const worker = new Worker(workerUrl, { workerData: job, resourceLimits: { stackSizeMb: WORKER_STACK_SIZE_MB } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (o: EvalOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void worker.terminate();
      resolve(o);
    };
    worker.on('message', (m: WorkerMessage) => {
      if (m.type === 'started') {
        timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT', message: `求值超过 ${timeoutMs} ms` }), timeoutMs);
        return;
      }
      finish(m.result);
    });
    worker.on('error', (e: Error & { code?: string }) => {
      const resource = e.code === 'ERR_WORKER_OUT_OF_MEMORY' || (e instanceof RangeError && /call stack/.test(e.message));
      finish({ ok: false, code: resource ? 'RESOURCE_EXHAUSTED' : 'EVAL_ERROR', message: `求值 Worker 异常：${e.message}` });
    });
    worker.on('exit', (code) => finish({ ok: false, code: 'EVAL_ERROR', message: `求值 Worker 意外退出（${code}）` }));
  });
}

const defaultWorkerUrl = (): URL => new URL('./worker-entry.js', import.meta.url);

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function readInputBytes(ctx: Ctx, where: string): Promise<Uint8Array> {
  if (where === '-') return ctx.io.stdin();
  try {
    // 先按 stat 判上限，不把超大文件读进内存
    if (statSync(where).size > MAX_INPUT_BYTES) throw new PackageError('INPUT_INVALID', 'input', `--input 文件超过 16 MiB：${where}`);
    return readFileSync(where);
  } catch (e) {
    if (e instanceof PackageError) throw e;
    throw new PackageError('INPUT_INVALID', 'input', `--input 文件不可读：${where}`);
  }
}

/** 入口检查：必须在 `policy.entries` 中，且 IR 中有同名函数。 */
function checkEntry(pkg: LoadedPackage, ir: IrView, entry: string): void {
  if (!pkg.manifest.policy.entries.some((e) => e.function === entry)) {
    throw new PackageError('ENTRY_NOT_FOUND', 'entry', `入口 ${entry} 不在 policy.entries 中`);
  }
  if (!findFunc(ir, entry)) throw new PackageError('ENTRY_NOT_FOUND', 'entry', `入口 ${entry} 不在 Core IR 中`);
}

async function cmdRun(ctx: Ctx, args: ParsedArgs): Promise<CommandResult> {
  const meta = newMeta();
  try {
    const anchor = await anchorOf(args);
    const pkg = loadTrusted(args.path!, anchor, args.flags.has('allow-unsigned'), meta);
    factsWarning(ctx, pkg);
    const isA = pkg.manifest.mode === 'a';
    const coreJson = isA ? readCompiledIr(pkg) : recompileAndCompare(pkg);
    const entry = args.values.get('entry') ?? defaultEntry(pkg.manifest);
    Object.assign(meta, { entry, coreIrSha256: pkg.manifest.coreIr.sha256, irRecompiled: !isA });
    const ir = JSON.parse(coreJson) as IrView;
    checkEntry(pkg, ir, entry);
    const input = parseInput(await readInputBytes(ctx, args.values.get('input')!), ir, entry);
    const r = await evaluateInWorker({ coreJson, entry, input }, args.timeoutMs, ctx.io.workerUrl ?? defaultWorkerUrl());
    if (!r.ok) return failed(ctx, new PackageError(r.code, r.code === 'ENTRY_NOT_FOUND' ? 'entry' : 'eval', r.message), meta);
    return resultOf(ctx, `{"meta":${valueJson(metaTree(meta))},"ok":true,"value":${r.valueJson}}\n`, 0);
  } catch (e) {
    if (e instanceof PackageError) return failed(ctx, e, meta);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/** 阶段 → verify 中报告失败的检查项。 */
function checkNameOf(e: PackageError): string {
  const byStage: Partial<Record<Stage, string>> = { manifest: 'schema', signature: 'signature', integrity: 'integrity', ir: 'ir' };
  if (e.stage === 'read') return e.code === 'PKG_INVALID_MANIFEST' ? 'schema' : 'integrity';
  return byStage[e.stage] ?? 'integrity';
}

/** probes 结果是否与期望相符（期望无损读取后按值规范 JSON 写出比较）。 */
export function probeMatches(expected: JsonValue, r: EvalOutcome): boolean {
  if (!isJsonObject(expected)) return false;
  if (expected['ok'] === true) {
    if (!('value' in expected) || !r.ok) return false;
    try {
      return valueJson(expected['value'] as ValueTree) === r.valueJson;
    } catch {
      return false;
    }
  }
  return expected['ok'] === false && expected['code'] === 'EVAL_ERROR' && !r.ok && r.code === 'EVAL_ERROR';
}

/** 逐条跑 probes；任一不符（含入口 / 输入不合法、超时）即 PROBE_MISMATCH。 */
async function runProbes(ctx: Ctx, pkg: LoadedPackage, coreJson: string, timeoutMs: number): Promise<void> {
  const mismatch = (why: string): PackageError => new PackageError('PROBE_MISMATCH', 'eval', why);
  const doc = parseStrictJson(payload(pkg, 'tests/probes.json'), { lossless: true, maxDepth: 64 });
  const probes = isJsonObject(doc) && Array.isArray(doc['probes']) ? doc['probes'] : [];
  const ir = JSON.parse(coreJson) as IrView;
  for (const [i, p] of probes.entries()) {
    if (!isJsonObject(p) || typeof p['entry'] !== 'string') throw mismatch(`probes[${i}] 形状不合法`);
    const entry = p['entry'];
    let input: { [key: string]: JsonValue };
    try {
      checkEntry(pkg, ir, entry);
      input = validateInputTree(p['input'] ?? null, ir, entry);
    } catch (e) {
      if (e instanceof PackageError) throw mismatch(`probes[${i}]：${e.code} ${e.detail}`);
      throw e;
    }
    const r = await evaluateInWorker({ coreJson, entry, input }, timeoutMs, ctx.io.workerUrl ?? defaultWorkerUrl());
    if (!probeMatches(p['expected'] ?? null, r)) throw mismatch(`probes[${i}]（${entry}）结果与期望不符：${r.ok ? r.valueJson : `${r.code} ${r.message}`}`);
  }
}

async function cmdVerify(ctx: Ctx, args: ParsedArgs): Promise<CommandResult> {
  const meta = newMeta();
  const checks: { name: string; ok: boolean; code?: string }[] = [];
  const out = (ok: boolean, exitCode: number): CommandResult =>
    resultOf(ctx, line({ checks: checks as unknown as ValueTree, meta: metaTree(meta), ok }), exitCode);
  let anchor: TrustAnchor;
  try {
    anchor = await anchorOf(args);
  } catch (e) {
    if (e instanceof PackageError) return failed(ctx, e, meta);
    throw e;
  }
  let current = 'schema';
  try {
    current = 'integrity';
    const pkg = readPackage(args.path!);
    checks.push({ name: 'schema', ok: true });
    current = 'signature';
    meta.signed = verifySignature(pkg, anchor, { allowUnsigned: args.flags.has('allow-unsigned') }).signed;
    checks.push({ name: 'signature', ok: true });
    current = 'integrity';
    verifyIntegrity(pkg);
    checks.push({ name: 'integrity', ok: true });
    Object.assign(meta, { entry: defaultEntry(pkg.manifest), coreIrSha256: pkg.manifest.coreIr.sha256 });
    const isA = pkg.manifest.mode === 'a';
    let coreJson: string | undefined;
    if (isA) {
      current = 'ir';
      coreJson = readCompiledIr(pkg);
      checks.push({ name: 'ir', ok: true });
    }
    if (args.flags.has('recompile')) {
      current = 'recompile';
      const local = recompileAndCompare(pkg);
      checks.push({ name: 'recompile', ok: true });
      meta.irRecompiled = true;
      coreJson = isA ? coreJson : local;
    }
    if (args.flags.has('probes')) {
      current = 'probes';
      coreJson ??= recompileAndCompare(pkg);
      await runProbes(ctx, pkg, coreJson, args.timeoutMs);
      checks.push({ name: 'probes', ok: true });
    }
    return out(true, 0);
  } catch (e) {
    if (!(e instanceof PackageError)) throw e;
    ctx.diag(e);
    const name = current === 'recompile' || current === 'probes' ? current : checkNameOf(e);
    checks.push({ code: e.code, name, ok: false });
    return out(false, e.exitCode);
  }
}

// ---------------------------------------------------------------------------
// inspect / version / compile
// ---------------------------------------------------------------------------

function schemaFile(pkg: LoadedPackage, path: string): ValueTree {
  try {
    return parseStrictJson(payload(pkg, path), { lossless: true, maxDepth: 256 }) as ValueTree;
  } catch (e) {
    if (e instanceof PackageError) throw e;
    throw new PackageError('PKG_INTEGRITY', 'integrity', `${path} 不是严格 JSON：${(e as Error).message}`);
  }
}

async function cmdInspect(ctx: Ctx, args: ParsedArgs): Promise<CommandResult> {
  const meta = newMeta();
  try {
    const pkg = loadTrusted(args.path!, await anchorOf(args), args.flags.has('allow-unsigned'), meta);
    factsWarning(ctx, pkg);
    const m = pkg.manifest;
    const schemas = { input: schemaFile(pkg, 'schema/input.json'), output: schemaFile(pkg, 'schema/output.json') };
    Object.assign(meta, { entry: defaultEntry(m), coreIrSha256: m.coreIr.sha256 });
    const inspect = { effects: m.effects, governance: m.governance, policy: m.policy, runtime: m.runtime, schemas, tests: m.tests };
    return resultOf(ctx, line({ inspect: inspect as unknown as ValueTree, meta: metaTree(meta), ok: true }), 0);
  } catch (e) {
    if (e instanceof PackageError) return failed(ctx, e, meta);
    throw e;
  }
}

function cmdVersion(ctx: Ctx): CommandResult {
  return resultOf(
    ctx,
    line({
      cliVersion: cliVersion(),
      coreIrVersions: [...SUPPORTED_CORE_IR_VERSIONS],
      engine: ENGINE,
      formatVersions: [...SUPPORTED_FORMAT_VERSIONS],
      toolchainId: toolchainId(),
      trustAnchorKids: anchorKids(builtinTrustAnchor()),
    }),
    0,
  );
}

function readOptionFile(path: string, opt: string): Uint8Array {
  try {
    return readFileSync(path);
  } catch {
    throw new PackageError('USAGE', 'usage', `${opt} 文件不可读：${path}`);
  }
}

/** `compile <pkg>`：按 manifest 编译包内源码；`compile <file.aster>`：按 --locale / --alias-set / --vocabulary 编译。 */
async function cmdCompile(ctx: Ctx, args: ParsedArgs): Promise<CommandResult> {
  const meta = newMeta();
  const path = args.path!;
  let isPackage: boolean;
  try {
    isPackage = statSync(path).isDirectory() || !path.endsWith('.aster');
  } catch {
    isPackage = !path.endsWith('.aster');
  }
  try {
    const sourceOnly = ['locale', 'alias-set', 'vocabulary'].filter((o) => args.values.has(o));
    if (isPackage && (sourceOnly.length > 0 || args.flags.has('allow-structural'))) {
      throw new PackageError('USAGE', 'usage', '编译包时 locale / aliasSet / 词汇取自 manifest，不接受 --locale / --alias-set / --vocabulary / --allow-structural');
    }
    if (!isPackage && (args.values.has('jwks') || args.values.has('pubkey') || args.flags.has('allow-unsigned'))) {
      throw new PackageError('USAGE', 'usage', '编译 .aster 源文件不接受 --jwks / --pubkey / --allow-unsigned');
    }
    let coreJson: string;
    try {
      if (isPackage) {
        const pkg = loadTrusted(path, await anchorOf(args), args.flags.has('allow-unsigned'), meta);
        coreJson = compilePackageSource(pkg);
        ctx.stderr.push(`positionFreeSha256 ${positionFreeSha256(coreJson)}（manifest ${pkg.manifest.coreIr.positionFreeSha256}）`);
      } else {
        const source = readOptionFile(path, '源文件');
        const alias = args.values.get('alias-set');
        const vocab = args.values.get('vocabulary');
        let text: string;
        try {
          text = decodeUtf8Strict(source);
        } catch {
          throw new CompileFailure([`${path} 不是合法 UTF-8`]);
        }
        coreJson = compileSource(text, {
          locale: args.values.get('locale') ?? 'en-US',
          aliasSet: alias === undefined ? null : parseAliasSetJson(readOptionFile(alias, '--alias-set')),
          allowStructural: args.flags.has('allow-structural'),
          vocabulary: vocab === undefined ? undefined : parseVocabularyJson(readOptionFile(vocab, '--vocabulary')),
        });
      }
    } catch (e) {
      if (e instanceof CompileFailure) throw new PackageError('COMPILE_ERROR', 'ir', e.diagnostics.join('\n'));
      throw e;
    }
    const outPath = args.values.get('out');
    if (outPath === undefined) return resultOf(ctx, `${coreJson}\n`, 0);
    try {
      writeFileSync(outPath, coreJson);
    } catch (e) {
      throw new PackageError('USAGE', 'usage', `--out 不可写：${(e as Error).message}`);
    }
    return resultOf(ctx, '', 0);
  } catch (e) {
    if (e instanceof PackageError) return failed(ctx, e, meta);
    throw e;
  }
}

/** 包格式子命令的唯一入口。argv 不含 node 与脚本路径。 */
export async function runCommand(argv: readonly string[], io: CommandIo): Promise<CommandResult> {
  const ctx = new Ctx(io);
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof PackageError) return failed(ctx, e, newMeta());
    throw e;
  }
  switch (args.command) {
    case 'run':
      return cmdRun(ctx, args);
    case 'verify':
      return cmdVerify(ctx, args);
    case 'inspect':
      return cmdInspect(ctx, args);
    case 'compile':
      return cmdCompile(ctx, args);
    case 'version':
      return cmdVersion(ctx);
  }
}

/** 包格式子命令名（`scripts/aster.ts` 据此把这些命令绕过 cac 直接交给 {@link runCommand}）。 */
export const PACKAGE_COMMANDS: ReadonlySet<string> = new Set(['compile', 'run', 'verify', 'inspect', 'version']);
