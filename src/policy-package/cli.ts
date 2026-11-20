/**
 * 包格式 v1 的 `aster` 子命令：`compile`、`run`、`verify`、`inspect`、`show`、`version`（ADR 0059 §4.1，P1 T4；
 * 包格式 1.1 的显示排版见 ADR 0059 修订 4 与 `display.ts`）。
 *
 * 行为以 aster-lang-test `conformance/package-v1/README.md` 为准：检查顺序、`meta` 的取值时机、`verify` 的检查项与
 * 「第一项失败即停止」、固定 message、stdout 恒为一行值规范 JSON + `\n`、诊断只写 stderr。
 * {@link runCommand} 是纯函数式入口（返回 stdout / stderr / 退出码），`scripts/aster.ts` 与单文件 bundle 都只调它。
 */
import { accessSync, constants as fsConstants, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { MAX_INPUT_BYTES } from './paths.js';
import { Worker } from 'node:worker_threads';
import { anchorKids, builtinTrustAnchor, loadTrustAnchor, type TrustAnchor } from './trust-anchor.js';
import { parseArgs, type ParsedArgs } from './argv.js';
import { cliVersion, ENGINE, toolchainId } from './cli-version.js';
import { ERROR_CODES, PackageError, type ErrorCode, type Stage } from './errors.js';
import { findFunc, parseInput, validateInputTree, type IrView } from './input.js';
import { verifyIntegrity, payload } from './integrity.js';
import { defaultEntry, SUPPORTED_CORE_IR_VERSIONS, SUPPORTED_FORMAT_VERSIONS } from './manifest.js';
import {
  CompileFailure,
  compilePackageSource,
  compileSource,
  decodeSourceText,
  parseAliasSetJson,
  parseVocabularyJson,
  positionFreeSha256,
  readCompiledIr,
  recompileAndCompare,
} from './obtain-ir.js';
import { readPackage, type LoadedPackage } from './read-package.js';
import { verifySignature } from './signature.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';
import { valueJson, type ValueTree } from './value-json.js';
import type { EvalJob, WorkerMessage } from './worker-eval.js';
import { probeMatches, type EvalOutcome } from './probe-match.js';
import { sha256HexSync } from './sha256.js';
import {
  checkDisplayIr,
  checkPackageDisplay,
  deriveProgram,
  displayMember,
  readEditedDisplay,
  structureNotes,
  type EditedDisplay,
} from './display.js';

// 探针比较与 Workers 内的 checkProbes 共用（probe-match.ts），这里原样再导出（既有 import 路径不变）。
export { probeMatches, type EvalOutcome } from './probe-match.js';

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

/** 求值开始前（不计入 `--timeout`）的安全看门狗。 */
export const PRE_EVAL_WATCHDOG_MS = 60_000;

/** Worker 线程栈（修订 1 A4）。 */
export const WORKER_STACK_SIZE_MB = 32;

/** 失败信封里的 `meta`（README「输出」的取值时机表）。 */
interface Meta {
  signed: boolean;
  entry: string | null;
  coreIrSha256: string | null;
  irRecompiled: boolean;
  /** 只在 run --display 且派生程序通过 L8/L9 之后出现（修订 4 D8） */
  display?: { canonicalSha256: string; matchesPackage: boolean };
}

const newMeta = (): Meta => ({ signed: false, entry: null, coreIrSha256: null, irRecompiled: false });

function metaTree(m: Meta): ValueTree {
  const tree: Record<string, ValueTree> = {
    cliVersion: cliVersion(),
    coreIrSha256: m.coreIrSha256,
    engine: ENGINE,
    entry: m.entry,
    irRecompiled: m.irRecompiled,
    signed: m.signed,
  };
  if (m.display) tree['display'] = { canonicalSha256: m.display.canonicalSha256, matchesPackage: m.display.matchesPackage };
  return tree;
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


/** 在 Worker 中求值；Worker 发出 `started` 后开始计时，到点 `terminate()` 并报 TIMEOUT。 */
export function evaluateInWorker(
  job: EvalJob,
  timeoutMs: number,
  workerUrl: URL,
  preEvalWatchdogMs: number = PRE_EVAL_WATCHDOG_MS,
): Promise<EvalOutcome> {
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
    // 未计时阶段（Worker 启动、IR 读入、实参转换）的安全看门狗：输入受包体积上限约束、没有循环，正常远小于此值；
    // 超出按资源类结果报 RESOURCE_EXHAUSTED（不在逐字节一致的承诺内，JVM 同码），进程不挂住；Worker 在 started 前崩溃仍按原码
    timer = setTimeout(
      () => finish({ ok: false, code: 'RESOURCE_EXHAUSTED', message: `求值开始前的准备超过 ${preEvalWatchdogMs} ms` }),
      preEvalWatchdogMs,
    );
    worker.on('message', (m: WorkerMessage) => {
      if (m.type === 'started') {
        clearTimeout(timer);
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
  if (args.values.has('display')) return cmdRunDisplay(ctx, args);
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

/**
 * `run --display <file>`（修订 4 D7–D8）：usage（读文件）→ read → manifest → signature → integrity → display（包排版 L1–L7）
 * → reconstruct → derived → compile → display-ir（L8 / L9）→ entry（派生模块）→ input（派生 IR）→ eval。
 * coreIrSha256 恒为 null；派生程序通过 L8 / L9 之后 meta 才带 entry、irRecompiled 与 display。包自身不重编译。
 */
async function cmdRunDisplay(ctx: Ctx, args: ParsedArgs): Promise<CommandResult> {
  const meta = newMeta();
  try {
    const edited = readEditedDisplay(args.values.get('display')!, '--display');
    const anchor = await anchorOf(args);
    const allowUnsigned = args.flags.has('allow-unsigned');
    const pkg = loadTrusted(args.path!, anchor, allowUnsigned, meta);
    factsWarning(ctx, pkg);
    const layout = checkPackageDisplay(pkg);
    if (layout === null) throw new PackageError('PKG_DISPLAY_INVALID', 'display', '包没有显示排版，没有可对照的排版');
    const derived = deriveProgram(pkg, layout, edited, ctx.stderr);
    const entry = args.values.get('entry') ?? defaultEntry(pkg.manifest);
    Object.assign(meta, {
      entry,
      irRecompiled: true,
      display: { canonicalSha256: sha256HexSync(derived.canonical), matchesPackage: derived.matchesPackage },
    });
    ctx.stderr.push('aster: 正在运行由显示文本派生的程序，不在包签名覆盖之内；派生的规范源码：', derived.canonical);
    if (!meta.signed) ctx.stderr.push('aster: 包未签名（--allow-unsigned），显示排版未经签名核验');
    const ir = JSON.parse(derived.coreJson) as IrView;
    if (!findFunc(ir, entry)) throw new PackageError('ENTRY_NOT_FOUND', 'entry', `入口 ${entry} 不在派生模块中`);
    const input = parseInput(await readInputBytes(ctx, args.values.get('input')!), ir, entry);
    const r = await evaluateInWorker({ coreJson: derived.coreJson, entry, input }, args.timeoutMs, ctx.io.workerUrl ?? defaultWorkerUrl());
    if (!r.ok) return failed(ctx, new PackageError(r.code, r.code === 'ENTRY_NOT_FOUND' ? 'entry' : 'eval', r.message), meta);
    return resultOf(ctx, `{"meta":${valueJson(metaTree(meta))},"ok":true,"value":${r.valueJson}}\n`, 0);
  } catch (e) {
    if (e instanceof PackageError) return failed(ctx, e, meta);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

const utf8Text = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/**
 * `show <pkg> [--canonical | --from-display <file>]`（修订 4 D6）：usage → read → manifest → signature → integrity →
 *（有 display 时）display（L1–L7）。stdout 不是 JSON：有排版为 display.aster + \n，无排版或 --canonical 为
 * policy/policy.aster + \n，--from-display 为还原出的规范源码 + \n（经 L1–L9，不求值）。失败输出 run 同形的错误信封，
 * meta 不取 IR。结构映射、字面量宏、未签名与无排版的说明只写 stderr。
 */
async function cmdShow(ctx: Ctx, args: ParsedArgs): Promise<CommandResult> {
  const meta = newMeta();
  try {
    const from = args.values.get('from-display');
    const edited: EditedDisplay | undefined = from === undefined ? undefined : readEditedDisplay(from, '--from-display');
    const pkg = loadTrusted(args.path!, await anchorOf(args), args.flags.has('allow-unsigned'), meta);
    factsWarning(ctx, pkg);
    const layout = checkPackageDisplay(pkg);
    if (layout === null) {
      if (edited !== undefined) throw new PackageError('PKG_DISPLAY_INVALID', 'display', '包没有显示排版，没有可对照的排版');
      ctx.stderr.push('aster: 本包无显示排版，打印的是规范源码 policy/policy.aster');
      return resultOf(ctx, `${utf8Text(pkg.files.get('policy/policy.aster')!)}\n`, 0);
    }
    ctx.stderr.push(...structureNotes(pkg, layout));
    if (!meta.signed) ctx.stderr.push('aster: 包未签名（--allow-unsigned），显示排版未经签名核验');
    if (edited !== undefined) {
      const derived = deriveProgram(pkg, layout, edited, ctx.stderr);
      ctx.stderr.push(`aster: 由显示文本还原出的规范源码（不在包签名覆盖之内；与包${derived.matchesPackage ? '' : '不'}同一 IR）`);
      return resultOf(ctx, `${derived.canonical}\n`, 0);
    }
    if (args.flags.has('canonical')) return resultOf(ctx, `${utf8Text(pkg.files.get('policy/policy.aster')!)}\n`, 0);
    ctx.stderr.push('aster: 显示文本 policy/display/display.aster 只供阅读，不是编译输入；编译的是 policy/policy.aster（aster show --canonical）');
    return resultOf(ctx, `${utf8Text(pkg.files.get('policy/display/display.aster')!)}\n`, 0);
  } catch (e) {
    if (e instanceof PackageError) {
      // show 不取 IR：失败信封的 meta 恒为 entry / coreIrSha256 null、irRecompiled false
      return failed(ctx, e, { signed: meta.signed, entry: null, coreIrSha256: null, irRecompiled: false });
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/** 阶段 → verify 中报告失败的检查项。 */
function checkNameOf(e: PackageError): string {
  const byStage: Partial<Record<Stage, string>> = {
    manifest: 'schema',
    signature: 'signature',
    integrity: 'integrity',
    ir: 'ir',
    display: 'display',
    'display-ir': 'display-ir',
  };
  if (e.stage === 'read') return e.code === 'PKG_INVALID_MANIFEST' ? 'schema' : 'integrity';
  return byStage[e.stage] ?? 'integrity';
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
    // 1.1 且有 display：display（L1–L7，不编译）；--recompile 时另有 display-ir（L8–L9）紧接 recompile
    const layout = displayMember(pkg) ? checkPackageDisplay(pkg) : null;
    if (layout) checks.push({ name: 'display', ok: true });
    if (args.flags.has('recompile')) {
      current = 'recompile';
      const local = recompileAndCompare(pkg);
      checks.push({ name: 'recompile', ok: true });
      meta.irRecompiled = true;
      coreJson = isA ? coreJson : local;
      if (layout) {
        checkDisplayIr(pkg, layout, local);
        checks.push({ name: 'display-ir', ok: true });
      }
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
    const name = (current === 'recompile' || current === 'probes') && e.stage !== 'display-ir' ? current : checkNameOf(e);
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
    const inspect: Record<string, unknown> = { effects: m.effects, governance: m.governance, policy: m.policy, runtime: m.runtime, schemas, tests: m.tests };
    // 1.1：manifest 的 display 原样带出（修订 4 D6）；不做排版检查
    if (m.display) inspect['display'] = m.display;
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

const usageError = (why: string): PackageError => new PackageError('USAGE', 'usage', why);

/** 读取 compile 的配置 / 源码文件：不存在、不是普通文件或不可读都是 USAGE。 */
function readOptionFile(path: string, opt: string): Uint8Array {
  try {
    if (!statSync(path).isFile()) throw usageError(`${opt} 不是普通文件：${path}`);
    return readFileSync(path);
  } catch (e) {
    if (e instanceof PackageError) throw e;
    throw usageError(`${opt} 不存在或不可读：${path}`);
  }
}

/** compile 的 aliasSet / 词汇文件：必须是严格 JSON，否则 USAGE（形状由编译阶段判，失败为 COMPILE_ERROR）。 */
function readJsonOption(path: string, opt: string): Uint8Array {
  const bytes = readOptionFile(path, opt);
  try {
    parseStrictJson(bytes, { maxDepth: 64 });
  } catch (e) {
    throw usageError(`${opt} 不是严格 JSON：${(e as Error).message}`);
  }
  return bytes;
}

/** `.aster` 源码：严格 UTF-8（去掉至多一个前导 BOM），非法为 USAGE。 */
function decodeSource(bytes: Uint8Array, path: string): string {
  try {
    return decodeSourceText(bytes);
  } catch {
    throw usageError(`源码不是合法 UTF-8：${path}`);
  }
}

/** `--out`：父目录必须存在、是目录且可写；目标本身不能是已存在的目录。在编译之前判定。 */
function checkOutPath(out: string): void {
  const parent = dirname(resolvePath(out));
  try {
    if (!statSync(parent).isDirectory()) throw usageError(`--out 的父目录不是目录：${parent}`);
    accessSync(parent, fsConstants.W_OK);
  } catch (e) {
    if (e instanceof PackageError) throw e;
    throw usageError(`--out 的父目录不存在或不可写：${parent}`);
  }
  let isDir = false;
  try {
    isDir = statSync(out).isDirectory();
  } catch {
    // 目标不存在：正常
  }
  if (isDir) throw usageError(`--out 指向已存在的目录：${out}`);
}

/**
 * 原子写入：同目录临时文件写完再改名；失败时清理临时文件、不动目标。目标文件永远不会处于写了一半的状态；
 * 但若进程在写完临时文件与改名之间被 SIGKILL，同目录会残留 `.<name>.<pid>.<随机>.tmp`（「不留临时文件」只对有序失败成立）。
 */
function writeAtomically(out: string, content: string): void {
  const target = resolvePath(out);
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, content, { flag: 'wx' });
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw usageError(`--out 写入失败：${(e as Error).message}`);
  }
}

/** compile 源码形态支持的词法表（两侧都内置的四个）。 */
export const COMPILE_LOCALES: ReadonlySet<string> = new Set(['en-US', 'zh-CN', 'de-DE', 'hi-IN']);

/**
 * `compile <pkg|file.aster>`（README「compile」）：位置参数以 `.aster` 结尾即源码形态（不存在、是目录或不是普通文件为 USAGE），
 * 否则为包形态（目录或 zip）。只解析与降级，不做类型检查。成功写规范 IR（stdout 加 `\n`，或 `--out` 原子写文件、stdout 为空）。
 */
async function cmdCompile(ctx: Ctx, args: ParsedArgs): Promise<CommandResult> {
  const meta = newMeta();
  const path = args.path!;
  try {
    const out = args.values.get('out');
    if (out !== undefined) checkOutPath(out);
    let coreJson: string;
    if (path.endsWith('.aster')) {
      const source = readOptionFile(path, '源文件');
      for (const o of ['jwks', 'pubkey']) if (args.values.has(o)) throw usageError(`源码形态不接受 --${o}`);
      if (args.flags.has('allow-unsigned')) throw usageError('源码形态不接受 --allow-unsigned');
      const alias = args.values.get('alias-set');
      if (args.flags.has('allow-structural') && alias === undefined) throw usageError('--allow-structural 只能与 --alias-set 同用');
      const locale = args.values.get('locale') ?? 'en-US';
      if (!COMPILE_LOCALES.has(locale)) throw usageError(`--locale 不受支持：${locale}`);
      const aliasBytes = alias === undefined ? undefined : readJsonOption(alias, '--alias-set');
      const vocab = args.values.get('vocabulary');
      const vocabBytes = vocab === undefined ? undefined : readJsonOption(vocab, '--vocabulary');
      const text = decodeSource(source, path);
      try {
        coreJson = compileSource(text, {
          locale,
          aliasSet: aliasBytes === undefined ? null : parseAliasSetJson(aliasBytes),
          allowStructural: args.flags.has('allow-structural'),
          vocabulary: vocabBytes === undefined ? undefined : parseVocabularyJson(vocabBytes),
        });
      } catch (e) {
        if (e instanceof CompileFailure) throw new PackageError('COMPILE_ERROR', 'ir', e.diagnostics.join('\n'));
        throw e;
      }
    } else {
      for (const o of ['locale', 'alias-set', 'vocabulary']) if (args.values.has(o)) throw usageError(`包形态不接受 --${o}（取自 manifest）`);
      if (args.flags.has('allow-structural')) throw usageError('包形态不接受 --allow-structural（取自 manifest）');
      const pkg = loadTrusted(path, await anchorOf(args), args.flags.has('allow-unsigned'), meta);
      try {
        coreJson = compilePackageSource(pkg);
      } catch (e) {
        if (e instanceof CompileFailure) throw new PackageError('COMPILE_ERROR', 'ir', e.diagnostics.join('\n'));
        throw e;
      }
      ctx.stderr.push(`positionFreeSha256 ${positionFreeSha256(coreJson)}（manifest ${pkg.manifest.coreIr.positionFreeSha256}）`);
    }
    if (out === undefined) return resultOf(ctx, `${coreJson}\n`, 0);
    writeAtomically(out, coreJson);
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
    case 'show':
      return cmdShow(ctx, args);
    case 'version':
      return cmdVersion(ctx);
  }
}

/** 包格式子命令名（`scripts/aster.ts` 据此把这些命令绕过 cac 直接交给 {@link runCommand}）。 */
export const PACKAGE_COMMANDS: ReadonlySet<string> = new Set(['compile', 'run', 'verify', 'inspect', 'show', 'version']);
