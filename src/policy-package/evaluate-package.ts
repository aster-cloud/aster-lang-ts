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

export type EvaluatePackageResult =
  | { readonly ok: true; readonly valueJson: string }
  | { readonly ok: false; readonly code: 'EVAL_ERROR' | 'RESOURCE_EXHAUSTED' | 'ENTRY_NOT_FOUND'; readonly message: string };

/** 求值。`input` 是 {@link parseInput} 校验过的树。 */
export function evaluatePackage(coreJson: string, entry: string, input: { [key: string]: JsonValue }): EvaluatePackageResult {
  const ir = JSON.parse(coreJson) as IrView;
  if (!findFunc(ir, entry)) return { ok: false, code: 'ENTRY_NOT_FOUND', message: `入口 ${entry} 不在 IR 中` };
  const ctx = toGuestContext(input, ir, entry);
  const r = evaluate(ir as unknown as Core.Module, entry, ctx, { maxSteps: Number.MAX_SAFE_INTEGER, maxCallDepth: CLI_MAX_CALL_DEPTH });
  if (!r.success) return { ok: false, code: r.errorKind === 'resource' ? 'RESOURCE_EXHAUSTED' : 'EVAL_ERROR', message: r.error ?? '求值失败' };
  try {
    return { ok: true, valueJson: toValueJson(r.value) };
  } catch (e) {
    return { ok: false, code: 'EVAL_ERROR', message: `结果无法按值规范 JSON 写出：${(e as Error).message}` };
  }
}
