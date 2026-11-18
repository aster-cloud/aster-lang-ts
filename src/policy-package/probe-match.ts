/**
 * 探针结果与期望的比较（README「verify --probes」）：CLI 的 `verify --probes` 与 Workers 内的 `checkProbes`
 * （`./package-check`，ADR 0059 §5.3、修订 3 P2-R13）共用，保证两处判定相同。不依赖 Node 内置模块。
 */
import type { EvaluatePackageResult } from './evaluate-package.js';
import { isJsonObject, type JsonValue } from './strict-json.js';
import { valueJson, type ValueTree } from './value-json.js';

/** 一次求值的结果：求值本身的结果，或超时 / 资源耗尽等运行失败。 */
export type EvalOutcome = EvaluatePackageResult | { readonly ok: false; readonly code: 'TIMEOUT' | 'RESOURCE_EXHAUSTED' | 'EVAL_ERROR'; readonly message: string };

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
