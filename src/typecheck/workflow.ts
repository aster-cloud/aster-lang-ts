import type { Core, Span } from '../types.js';
import { CapabilityKind } from '../config/semantic.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { TypeSystem } from './type_system.js';
import type { TypecheckWalkerContext } from './context.js';
import type { DiagnosticBuilder } from './diagnostics.js';
import {
  CPU_EFFECT_TYPE,
  IO_EFFECT_TYPE,
  PURE_EFFECT_TYPE,
  UNIT_TYPE,
  formatType,
  isUnknown,
  normalizeType,
  originToSpan,
  unknownType,
} from './utils.js';
import { collectEffects } from './effects.js';
import { typecheckBlock } from './statement.js';

const RETRY_RECOMMENDED_MAX_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_LINEAR_WAIT_LIMIT_MS = 5 * 60_000;
const RETRY_EXPONENTIAL_WAIT_LIMIT_MS = 15 * 60_000;

function estimateRetryWaitMs(retry: Core.RetryPolicy): number {
  const attempts = Math.max(0, Math.floor(retry.maxAttempts));
  if (attempts <= 1) return 0;
  if (retry.backoff === 'linear') {
    const waitUnits = (attempts * (attempts - 1)) / 2;
    return waitUnits * RETRY_BASE_DELAY_MS;
  }
  if (attempts > 30) {
    return Number.POSITIVE_INFINITY;
  }
  const waitUnits = Math.pow(2, attempts - 1) - 1;
  return waitUnits * RETRY_BASE_DELAY_MS;
}

function describeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms === Number.POSITIVE_INFINITY) {
    return '不可估算';
  }
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 600_000) return `${Math.round(ms / 1_000)}秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}分钟`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}小时`;
  return `${Math.round(ms / 86_400_000)}天`;
}

export function checkRetrySemantics(workflow: Core.Workflow, diagnostics: DiagnosticBuilder): void {
  if (!workflow.retry) return;

  const { retry, timeout } = workflow;
  const { maxAttempts, backoff } = retry;

  if (maxAttempts <= 0) return;

  const estimatedWaitMs = estimateRetryWaitMs(retry);
  const timeoutMs = timeout?.milliseconds ?? null;
  const reasonPrefix = `retry(backoff=${backoff}, maxAttempts=${maxAttempts})`;

  if (timeoutMs && timeoutMs > 0 && estimatedWaitMs > timeoutMs) {
    diagnostics.warning(ErrorCode.WORKFLOW_RETRY_INCONSISTENT, originToSpan(workflow.origin), {
      reason: `${reasonPrefix} 预估累计等待 ${describeDuration(estimatedWaitMs)}，超过 timeout=${describeDuration(timeoutMs)}`,
    });
    return;
  }

  if (maxAttempts > RETRY_RECOMMENDED_MAX_ATTEMPTS) {
    diagnostics.warning(ErrorCode.WORKFLOW_RETRY_INCONSISTENT, originToSpan(workflow.origin), {
      reason: `${reasonPrefix} 预计累计等待 ${describeDuration(estimatedWaitMs)}，建议最多 ${RETRY_RECOMMENDED_MAX_ATTEMPTS} 次`,
    });
    return;
  }

  const waitLimit = backoff === 'linear' ? RETRY_LINEAR_WAIT_LIMIT_MS : RETRY_EXPONENTIAL_WAIT_LIMIT_MS;
  if (estimatedWaitMs > waitLimit) {
    diagnostics.warning(ErrorCode.WORKFLOW_RETRY_INCONSISTENT, originToSpan(workflow.origin), {
      reason: `${reasonPrefix} 预计累计等待 ${describeDuration(estimatedWaitMs)}，超过推荐窗口 ${describeDuration(waitLimit)}`,
    });
  }
}

export function checkTimeoutSemantics(workflow: Core.Workflow, diagnostics: DiagnosticBuilder): void {
  if (!workflow.timeout) return;

  const { milliseconds } = workflow.timeout;
  if (milliseconds <= 0) return;

  if (milliseconds <= 1_000) {
    diagnostics.warning(ErrorCode.WORKFLOW_TIMEOUT_UNREASONABLE, originToSpan(workflow.origin), {
      reason: `timeout=${milliseconds}ms (${Math.round(milliseconds / 1_000)}秒) 过短，可能导致正常操作超时`,
    });
  }

  if (milliseconds > 3_600_000) {
    diagnostics.warning(ErrorCode.WORKFLOW_TIMEOUT_UNREASONABLE, originToSpan(workflow.origin), {
      reason: `timeout=${milliseconds}ms (${Math.round(milliseconds / 60_000)}分钟) 过长，建议不超过 1 小时`,
    });
  }
}

export function typecheckWorkflow(context: TypecheckWalkerContext, workflow: Core.Workflow): Core.Type {
  checkRetrySemantics(workflow, context.diagnostics);
  checkTimeoutSemantics(workflow, context.diagnostics);

  let resultType: Core.Type = unknownType();
  const stepEffects = new Map<Core.Step, Set<'io' | 'cpu'>>();
  for (const step of workflow.steps) {
    resultType = typecheckStep(context, step, stepEffects);
  }

  checkWorkflowDependencies(workflow, context.diagnostics);
  validateWorkflowMetadata(workflow, context.diagnostics);
  const effectType = workflowEffectType(context, workflow, stepEffects);

  return {
    kind: 'TypeApp',
    base: 'Workflow',
    args: [normalizeType(resultType), effectType],
  };
}

export function typecheckStep(
  context: TypecheckWalkerContext,
  step: Core.Step,
  effectCache?: Map<Core.Step, Set<'io' | 'cpu'>>
): Core.Type {
  const bodyType = typecheckBlock(context.module, context.symbols, step.body, context.diagnostics);
  const effects = collectEffects(context.module, step.body);

  if (step.compensate) {
    const compensateType = typecheckBlock(context.module, context.symbols, step.compensate, context.diagnostics);
    validateCompensateBlock(context, step, bodyType, compensateType);
    // 合并 compensate 块的效应
    const compensateEffects = collectEffects(context.module, step.compensate);
    for (const eff of compensateEffects) {
      effects.add(eff);
    }
  } else if (stepHasSideEffects(step, effects)) {
    context.diagnostics.warning(ErrorCode.WORKFLOW_COMPENSATE_MISSING, originToSpan(step.origin), {
      step: step.name,
    });
  }

  // 缓存合并后的效应（包含 body 和 compensate）
  if (effectCache) {
    effectCache.set(step, effects);
  }

  return bodyType;
}

function validateCompensateBlock(
  context: TypecheckWalkerContext,
  step: Core.Step,
  bodyType: Core.Type,
  compensateType: Core.Type
): void {
  const expected = normalizeType(bodyType);
  if (expected.kind !== 'Result') return;

  const expectedErr = normalizeType(expected.err as Core.Type);
  const targetSpan = originToSpan(step.compensate?.origin ?? step.origin);

  if (compensateType.kind !== 'Result') {
    context.diagnostics.error(ErrorCode.WORKFLOW_COMPENSATE_TYPE, targetSpan, {
      step: step.name,
      expectedErr: formatType(expectedErr),
      actual: formatType(compensateType),
    });
    return;
  }

  const okMatchesUnit =
    TypeSystem.equals(compensateType.ok as Core.Type, UNIT_TYPE) || isUnknown(compensateType.ok as Core.Type);
  const errMatches =
    TypeSystem.equals(normalizeType(compensateType.err as Core.Type), expectedErr) ||
    TypeSystem.isSubtype(normalizeType(compensateType.err as Core.Type), expectedErr);

  if (!okMatchesUnit || !errMatches) {
    context.diagnostics.error(ErrorCode.WORKFLOW_COMPENSATE_TYPE, targetSpan, {
      step: step.name,
      expectedErr: formatType(expectedErr),
      actual: formatType(compensateType),
    });
  }
}

function workflowEffectType(
  context: TypecheckWalkerContext,
  workflow: Core.Workflow,
  cachedEffects?: Map<Core.Step, Set<'io' | 'cpu'>>
): Core.Type {
  let hasIOCap = workflow.effectCaps.some(cap => cap !== CapabilityKind.CPU);
  let hasCpuCap = workflow.effectCaps.some(cap => cap === CapabilityKind.CPU);

  if (!hasIOCap) {
    for (const step of workflow.steps) {
      // 优先使用缓存（已包含 compensate 效应），否则动态收集
      let effects = cachedEffects?.get(step);
      if (!effects) {
        effects = collectEffects(context.module, step.body);
        if (step.compensate) {
          const compensateEffects = collectEffects(context.module, step.compensate);
          for (const eff of compensateEffects) {
            effects.add(eff);
          }
        }
      }
      if (effects.has('io')) {
        hasIOCap = true;
        break;
      }
      if (effects.has('cpu')) {
        hasCpuCap = true;
      }
    }
  }

  if (hasIOCap) return IO_EFFECT_TYPE;
  if (hasCpuCap) return CPU_EFFECT_TYPE;
  return PURE_EFFECT_TYPE;
}

function checkWorkflowDependencies(workflow: Core.Workflow, diagnostics: DiagnosticBuilder): void {
  if (workflow.steps.length === 0) return;

  const stepMap = new Map<string, Core.Step>();
  const stepSpans = new Map<string, Span | undefined>();
  for (const step of workflow.steps) {
    stepMap.set(step.name, step);
    stepSpans.set(step.name, originToSpan(step.origin));
  }

  for (const step of workflow.steps) {
    for (const dep of step.dependencies ?? []) {
      if (!stepMap.has(dep)) {
        diagnostics.error(ErrorCode.WORKFLOW_UNKNOWN_STEP_DEPENDENCY, originToSpan(step.origin), {
          step: step.name,
          dependency: dep,
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reportedCycles = new Set<string>();

  const dfs = (node: string, path: string[]): void => {
    if (visiting.has(node)) {
      const cycleNodes = [...path, node];
      const cycleString = cycleNodes.join(' -> ');
      if (!reportedCycles.has(cycleString)) {
        diagnostics.error(
          ErrorCode.WORKFLOW_CIRCULAR_DEPENDENCY,
          stepSpans.get(node) ?? originToSpan(workflow.origin),
          { cycle: cycleString }
        );
        reportedCycles.add(cycleString);
      }
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    const deps = stepMap.get(node)?.dependencies ?? [];
    for (const dep of deps) {
      if (!stepMap.has(dep)) continue;
      dfs(dep, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  };

  for (const step of workflow.steps) {
    if (!visited.has(step.name)) {
      dfs(step.name, []);
    }
  }
}

function validateWorkflowMetadata(workflow: Core.Workflow, diagnostics: DiagnosticBuilder): void {
  if (workflow.retry && workflow.retry.maxAttempts <= 0) {
    diagnostics.error(ErrorCode.WORKFLOW_RETRY_INVALID, originToSpan(workflow.origin), {
      maxAttempts: workflow.retry.maxAttempts,
    });
  }
  if (workflow.timeout && workflow.timeout.milliseconds <= 0) {
    diagnostics.error(ErrorCode.WORKFLOW_TIMEOUT_INVALID, originToSpan(workflow.origin), {
      milliseconds: workflow.timeout.milliseconds,
    });
  }
}

function stepHasSideEffects(step: Core.Step, effects: Set<'io' | 'cpu'>): boolean {
  if (effects.has('io')) return true;
  return step.effectCaps.some(cap => cap !== CapabilityKind.CPU);
}
