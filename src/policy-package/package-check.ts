/**
 * `@aster-cloud/aster-lang-ts/package-check`：cloud 在 Cloudflare Workers 内复核 Node 策略包（ADR 0059 §5.3、
 * 修订 3 P2-R5 / P2-R7 / P2-R13）。
 *
 *   - {@link compileSourcePositionFreeSha256}：按导出时的编译输入重编译源码，得到修订 1 A2 的投影哈希；
 *     与平台 `positionFreeSha256` 不等即 E739（由 cloud 判定）。与 CLI 对 B 包的本地编译同一路径（`compileSource`）。
 *   - {@link checkProbes}：在平台 Core IR 上逐条跑 `tests/probes.json`，与 CLI `verify --probes` 同一读入、
 *     输入转换、求值与比较路径；有不一致即 E735（由 cloud 判定）。
 *   - {@link TS_VERSION}：本包版本，cloud 与锁文件 `node.cliVersion` 比较（不等即 503 `export_runtime_skew`）。
 *
 * Workers 约束：本入口的依赖闭包不得引用 Node 内置模块（`node:*`、`Buffer`），也不得在运行时生成代码（`new Function`）。
 * 所以 Core IR 用预编译的 schema 校验函数严格读入（`readCoreIrPrecompiled`），SHA-256 用纯 JS 实现。
 * `scripts/verify-package-check-entry.mjs` 打包本入口并在禁止动态生成代码的 Node 中运行，守住这两条。
 */
import { readCoreIrPrecompiled } from '../core/read-core-ir-precompiled.js';
import { compileSource, parseAliasSetJson, parseVocabularyJson, positionFreeSha256 } from './compile-source.js';
import { PackageError } from './errors.js';
import { evaluateIr } from './evaluate-package.js';
import exportBuiltins from './export-builtins.json' with { type: 'json' };
import { findFunc, validateInputTree, type IrView } from './input.js';
import { probeMatches, type EvalOutcome } from './probe-match.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';
import { valueJson, type ValueTree } from './value-json.js';

export { CompileFailure } from './compile-source.js';
export { CoreIrFormatError } from '../core/read-core-ir-precompiled.js';
export { TS_VERSION } from './ts-version.js';

/**
 * 本引擎的导出 builtin 白名单（`export-builtins.json`，P1 T10 的 ts 一半）：`{aliases, engine, names}`。
 * aster-api 导出检查（E732，target=node）用其副本；这里随包发布，便于对照。
 */
export const EXPORT_BUILTINS: { readonly aliases: Readonly<Record<string, string>>; readonly engine: string; readonly names: readonly string[] } = exportBuiltins;

/** {@link compileSourcePositionFreeSha256} 的编译输入（与 manifest `source.*` 及包内 `policy/compile/*` 一一对应）。 */
export interface CompileSourceHashOptions {
  /** manifest `source.locale`。 */
  readonly locale: string;
  /** `policy/compile/alias-set.json` 的文本：`"null"` 或规范 JSON。 */
  readonly aliasSetJson: string;
  /** manifest `source.allowStructural`。 */
  readonly allowStructural: boolean;
  /** `policy/compile/vocabulary.json` 的文本；包内没有该文件时省略。 */
  readonly vocabularyJson?: string;
}

/**
 * 重编译源码并返回投影哈希（小写 hex）。aliasSet 先按与 CLI 相同的规则解析、校验再叠加。
 * 编译失败（含 aliasSet / 词汇不合法、源码为空白）抛 {@link CompileFailure}，诊断在 `diagnostics` 中。
 */
export function compileSourcePositionFreeSha256(source: string, opts: CompileSourceHashOptions): string {
  const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
  const coreJson = compileSource(source, {
    locale: opts.locale,
    aliasSet: parseAliasSetJson(utf8(opts.aliasSetJson)),
    allowStructural: opts.allowStructural,
    vocabulary: opts.vocabularyJson === undefined ? undefined : parseVocabularyJson(utf8(opts.vocabularyJson)),
  });
  return positionFreeSha256(coreJson);
}

/** {@link checkProbes} 的上限与入口集合（修订 3 P2-R13：cloud 取 5 000 000 步、调用深度 10 000、合计 20 000 ms）。 */
export interface CheckProbesOptions {
  /** 每条探针的解释器步数上限；超出计为不一致。 */
  readonly maxSteps: number;
  /** 调用深度上限；超出或 JS 栈溢出计为不一致。 */
  readonly maxCallDepth: number;
  /** 全部探针合计的墙钟上限（毫秒）；超出后该条与其余各条计为不一致（TIMEOUT）。 */
  readonly deadlineMs: number;
  /**
   * 全部探针合计的解释器步数上限（必填；不设限时显式传 `Number.POSITIVE_INFINITY`）。用尽后其余各条计为不一致
   * （RESOURCE_EXHAUSTED），每条的实际上限取 `maxSteps` 与剩余预算的较小者。Workers 里墙钟在同步执行期间不推进
   * （见 {@link checkProbes}），这是能在那里真正约束总耗时的上限，所以不给缺省值，调用方必须按目标 Worker 的 CPU 限额决定。
   */
  readonly maxTotalSteps: number;
  /**
   * 可运行的入口（必填：manifest `policy.entries[].function`）。与 CLI `verify --probes` 一样，探针的入口必须在其中，
   * 且 Core IR 中有同名函数，否则计为不一致（ENTRY_NOT_FOUND）。
   */
  readonly entries: readonly string[];
  /** 墙钟（毫秒），缺省 `Date.now`；测试注入。 */
  readonly now?: () => number;
}

/** 第一条不一致的探针：下标从 0 起；`expected` / `actual` 都是值规范 JSON 的结果信封文本。 */
export interface ProbeMismatch {
  readonly index: number;
  readonly expected: string;
  readonly actual: string;
}

/** {@link checkProbes} 的结果：`agreed === count` 即全部一致。 */
export interface CheckProbesResult {
  readonly count: number;
  readonly agreed: number;
  readonly firstMismatch: ProbeMismatch | null;
}

/** 一条探针的结果：求值结果、超时，或未求值即判为不一致（输入不合法）。 */
type ProbeOutcome = EvalOutcome | { readonly ok: false; readonly code: 'INPUT_INVALID'; readonly message: string };

const TIMED_OUT: ProbeOutcome = { ok: false, code: 'TIMEOUT', message: '超过 deadlineMs' };
const BUDGET_SPENT: ProbeOutcome = { ok: false, code: 'RESOURCE_EXHAUSTED', message: '合计步数预算已用尽' };

/** 与 CLI 同一比较规则；输入不合法永远不一致。 */
const agrees = (expected: JsonValue, r: ProbeOutcome): boolean => (r.ok || r.code !== 'INPUT_INVALID') && probeMatches(expected, r as EvalOutcome);

/** 求值结果 → 与 `tests/probes.json` 期望同形的信封文本。 */
function outcomeJson(r: ProbeOutcome): string {
  return r.ok ? `{"ok":true,"value":${r.valueJson}}` : `{"code":${JSON.stringify(r.code)},"ok":false}`;
}

/** 期望值的文本（无法按值规范 JSON 写出时退回普通 JSON）。 */
function expectedJson(expected: JsonValue): string {
  try {
    return valueJson(expected as ValueTree);
  } catch {
    return JSON.stringify(expected, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  }
}

/**
 * 在 Core IR 上逐条跑探针并与期望比较（README「verify --probes」的比较规则，见 `probe-match.ts`）。
 *
 * `coreJson` 先严格读入（失败抛 {@link CoreIrFormatError}）；`probesJson` 必须是严格 JSON 的 `{"probes":[…]}`（否则抛错）。
 * 单条探针形状不合法、入口不在 IR 中、输入不符合入口 schema、超步数、调用深度超限、JS 栈溢出、超过 `deadlineMs`，
 * 都计为不一致而不抛错。与 CLI 不同，遇到不一致不停止，`agreed` 统计全部探针。
 *
 * 墙钟检查在每条探针前后各做一次：求值是同步的，无法在一条探针中途打断，单条的上限由 `maxSteps` 保证。
 * 注意 Cloudflare Workers 在一次同步执行期间不推进 `Date.now()`，在那里 `deadlineMs` 实际不会触发；要约束总耗时，
 * 调用方应同时给出 `maxTotalSteps`（确定性的合计预算，与时钟无关）。
 */
export function checkProbes(coreJson: string, probesJson: string, opts: CheckProbesOptions): CheckProbesResult {
  const ir = readCoreIrPrecompiled(coreJson) as unknown as IrView;
  const doc = parseStrictJson(probesJson, { lossless: true, maxDepth: 64 });
  const probes = isJsonObject(doc) ? doc['probes'] : undefined;
  if (!Array.isArray(probes)) throw new Error('probes 文件必须是 {"probes":[…]} 形状的严格 JSON');
  const now = opts.now ?? Date.now;
  const start = now();
  const late = (): boolean => now() - start > opts.deadlineMs;
  const entries = new Set(opts.entries);
  let budget = opts.maxTotalSteps;
  let agreed = 0;
  let firstMismatch: ProbeMismatch | null = null;
  for (const [index, p] of probes.entries()) {
    const expected = isJsonObject(p) ? (p['expected'] ?? null) : null;
    const limits = { maxSteps: Math.min(opts.maxSteps, budget), maxCallDepth: opts.maxCallDepth };
    // 开始前与结束后各查一次墙钟：超时的那条与其后各条都记为 TIMEOUT
    const result = late() ? TIMED_OUT : budget <= 0 ? BUDGET_SPENT : runProbe(ir, p, entries, limits);
    budget -= 'steps' in result && typeof result.steps === 'number' ? result.steps : 0;
    const final = late() ? TIMED_OUT : result;
    if (agrees(expected, final)) {
      agreed++;
    } else if (firstMismatch === null) {
      firstMismatch = { index, expected: expectedJson(expected), actual: outcomeJson(final) };
    }
  }
  return { count: probes.length, agreed, firstMismatch };
}

/** 跑一条探针：形状、入口与输入不合法时返回未求值的结果码。 */
function runProbe(ir: IrView, p: JsonValue, entries: ReadonlySet<string>, limits: { maxSteps: number; maxCallDepth: number }): ProbeOutcome {
  // 与 CLI checkEntry 同一判定：入口在可运行入口集合中，且 IR 中有同名函数
  if (!isJsonObject(p) || typeof p['entry'] !== 'string' || !entries.has(p['entry']) || !findFunc(ir, p['entry'])) {
    return { ok: false, code: 'ENTRY_NOT_FOUND', message: '探针形状不合法或入口不可运行' };
  }
  const entry = p['entry'];
  let input: { [key: string]: JsonValue };
  try {
    input = validateInputTree(p['input'] ?? null, ir, entry);
  } catch (e) {
    if (e instanceof PackageError) return { ok: false, code: 'INPUT_INVALID', message: e.detail };
    throw e;
  }
  return evaluateIr(ir, entry, input, limits);
}
