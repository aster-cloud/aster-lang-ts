/**
 * eval 阶段：在已校验的 IR 与输入上求值并按值规范 JSON 写出（ADR 0059 §4.3、修订 1 A4）。
 *
 * 在 Worker 线程里调用（`resourceLimits.stackSizeMb = 32`）：`maxSteps = Number.MAX_SAFE_INTEGER`（死循环交给
 * 主线程的超时 `terminate()`），`maxCallDepth = 10 000`；调用深度超限与 JS 栈溢出报 `RESOURCE_EXHAUSTED`，
 * 其余求值失败与值写出失败（嵌套超过 64 层、孤立代理项、非有限数）报 `EVAL_ERROR`。
 */
import { evaluate } from '../core/interpreter.js';
import type { Core } from '../types.js';
import { findFunc, toGuestContext, type IrView } from './input.js';
import type { JsonValue } from './strict-json.js';
import { toValueJson } from './value-json.js';

/** 包格式 CLI 的调用深度上限（修订 1 A4）。 */
export const CLI_MAX_CALL_DEPTH = 10_000;

/** 求值结果。`steps` 为本次执行的解释器步数（Workers 内的 checkProbes 用它扣减合计步数预算）。 */
export type EvaluatePackageResult =
  | { readonly ok: true; readonly valueJson: string; readonly steps?: number }
  | { readonly ok: false; readonly code: 'EVAL_ERROR' | 'RESOURCE_EXHAUSTED' | 'ENTRY_NOT_FOUND'; readonly message: string; readonly steps?: number };

/**
 * 求值。`input` 是 {@link parseInput} 校验过的树。`beforeEvaluate` 在 IR 已读入、实参已转换之后、调用 `evaluate` 之前回调——
 * 超时从这一刻起计（README「命令行」的计时起点），Worker 在这里通知主线程开始计时。
 */
export function evaluatePackage(
  coreJson: string,
  entry: string,
  input: { [key: string]: JsonValue },
  beforeEvaluate: () => void = () => {},
): EvaluatePackageResult {
  // CLI 不用步数：去掉 steps，Worker 消息与既有结果形状不变
  const result = evaluateIr(JSON.parse(coreJson) as IrView, entry, input, CLI_EVAL_LIMITS, beforeEvaluate);
  return result.ok ? { ok: true, valueJson: result.valueJson } : { ok: false, code: result.code, message: result.message };
}

/** 解释器步数与调用深度上限。 */
export interface EvalLimits {
  readonly maxSteps: number;
  readonly maxCallDepth: number;
}

/** CLI 的上限：步数不设限（死循环交给 Worker 超时），调用深度 {@link CLI_MAX_CALL_DEPTH}。 */
export const CLI_EVAL_LIMITS: EvalLimits = { maxSteps: Number.MAX_SAFE_INTEGER, maxCallDepth: CLI_MAX_CALL_DEPTH };

/**
 * 在已解析的 IR 上求值（{@link evaluatePackage} 与 Workers 内的 `checkProbes` 共用同一路径，只有上限不同）。
 * 超步数、调用深度超限与 JS 栈溢出都报 `RESOURCE_EXHAUSTED`。
 */
export function evaluateIr(
  ir: IrView,
  entry: string,
  input: { [key: string]: JsonValue },
  limits: EvalLimits,
  beforeEvaluate: () => void = () => {},
): EvaluatePackageResult {
  if (!findFunc(ir, entry)) return { ok: false, code: 'ENTRY_NOT_FOUND', message: `入口 ${entry} 不在 IR 中` };
  const ctx = toGuestContext(input, ir, entry);
  beforeEvaluate();
  const r = evaluate(ir as unknown as Core.Module, entry, ctx, { maxSteps: limits.maxSteps, maxCallDepth: limits.maxCallDepth });
  const steps = r.steps === undefined ? {} : { steps: r.steps };
  if (!r.success) return { ok: false, code: r.errorKind === 'resource' ? 'RESOURCE_EXHAUSTED' : 'EVAL_ERROR', message: r.error ?? '求值失败', ...steps };
  try {
    return { ok: true, valueJson: toValueJson(r.value), ...steps };
  } catch (e) {
    return { ok: false, code: 'EVAL_ERROR', message: `结果无法按值规范 JSON 写出：${(e as Error).message}`, ...steps };
  }
}
