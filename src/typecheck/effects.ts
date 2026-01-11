import type { Core } from '../types.js';
import { CapabilityKind } from '../config/semantic.js';
import { DefaultCoreVisitor, createVisitorContext } from '../core/visitor.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { ModuleContext } from './context.js';
import type { DiagnosticBuilder } from './diagnostics.js';
import {
  CPU_PREFIXES,
  IO_PREFIXES,
  originToSpan,
  resolveAlias,
} from './utils.js';
import {
  collectCapabilities,
  collectWorkflows,
  reportWorkflowCapabilityViolation,
} from './capabilities.js';

/**
 * 收集块中观察到的效应，按 CPU/IO 分类
 */
export function collectEffects(ctx: ModuleContext, block: Core.Block): Set<'io' | 'cpu'> {
  const effects = new Set<'io' | 'cpu'>();
  class EffectsVisitor extends DefaultCoreVisitor {
    override visitStatement(statement: Core.Statement, context: import('../core/visitor.js').VisitorContext): void {
      if (statement.kind === 'workflow') {
        // workflow 自身由运行时驱动，默认需要 IO 效果
        effects.add('io');
        for (const step of statement.steps) {
          this.visitBlock(step.body, context);
          if (step.compensate) this.visitBlock(step.compensate, context);
        }
        return;
      }
      super.visitStatement(statement, context);
    }

    override visitExpression(expression: Core.Expression, context: import('../core/visitor.js').VisitorContext): void {
      if (expression.kind === 'Call' && expression.target.kind === 'Name') {
        const rawName = expression.target.name;
        const resolvedName = resolveAlias(rawName, ctx.imports);
        if (IO_PREFIXES.some(prefix => resolvedName.startsWith(prefix))) effects.add('io');
        if (CPU_PREFIXES.some(prefix => resolvedName.startsWith(prefix))) effects.add('cpu');
      }
      super.visitExpression(expression, context);
    }
  }
  new EffectsVisitor().visitBlock(block, createVisitorContext());
  return effects;
}

/**
 * 检查函数的效应声明是否覆盖实际使用
 */
export function checkEffects(ctx: ModuleContext, func: Core.Func, diagnostics: DiagnosticBuilder): void {
  const observed = collectEffects(ctx, func.body);
  const hasIO = func.effects.some(eff => String(eff).toLowerCase() === 'io');
  const hasCPU = func.effects.some(eff => String(eff).toLowerCase() === 'cpu');

  if (observed.has('io') && !hasIO)
    diagnostics.error(ErrorCode.EFF_MISSING_IO, func.span, { func: func.name });

  if (observed.has('cpu') && !(hasCPU || hasIO))
    diagnostics.error(ErrorCode.EFF_MISSING_CPU, func.span, { func: func.name });

  if (!observed.has('io') && hasIO && observed.has('cpu'))
    diagnostics.info(ErrorCode.EFF_SUPERFLUOUS_IO_CPU_ONLY, func.span, { func: func.name });

  if (!observed.has('cpu') && hasCPU)
    diagnostics.warning(ErrorCode.EFF_SUPERFLUOUS_CPU, func.span, { func: func.name });

  const workflows = collectWorkflows(func.body);
  if (workflows.length === 0) return;

  if (!hasIO) {
    diagnostics.error(ErrorCode.WORKFLOW_MISSING_IO_EFFECT, func.span, { func: func.name });
  }

  const meta = func as unknown as { effectCaps?: readonly CapabilityKind[] };
  const declaredCaps = new Set<CapabilityKind>(meta.effectCaps ?? []);

  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      const stepSpan = originToSpan(step.origin);
      const bodyCaps = collectCapabilities(step.body);
      reportWorkflowCapabilityViolation(diagnostics, declaredCaps, bodyCaps, func.name, step.name, stepSpan);
      if (!step.compensate) continue;

      const compensateCaps = collectCapabilities(step.compensate);
      const compensateSpan = originToSpan(step.compensate.origin ?? step.origin);
      reportWorkflowCapabilityViolation(
        diagnostics,
        declaredCaps,
        compensateCaps,
        func.name,
        step.name,
        compensateSpan
      );

      const bodyCapSet = new Set(bodyCaps.keys());
      for (const cap of compensateCaps.keys()) {
        if (!bodyCapSet.has(cap)) {
          diagnostics.error(ErrorCode.COMPENSATE_NEW_CAPABILITY, compensateSpan, {
            func: func.name,
            step: step.name,
            capability: cap,
          });
        }
      }
    }
  }
}

/**
 * 根据观察到的能力推断效应声明，若缺失则提示
 */
export function checkCapabilityInferredEffects(func: Core.Func, diagnostics: DiagnosticBuilder): void {
  if (!func.body) return;

  const observed = collectCapabilities(func.body);
  if (observed.size === 0) return;

  const hasIO = func.effects.some(eff => String(eff).toLowerCase() === 'io');
  const hasCPU = func.effects.some(eff => String(eff).toLowerCase() === 'cpu');

  const ioCaps: CapabilityKind[] = [];
  for (const cap of observed.keys()) {
    if (cap !== CapabilityKind.CPU) {
      ioCaps.push(cap);
    }
  }

  if (ioCaps.length > 0 && !hasIO) {
    const capNames = ioCaps.join(', ');
    const calls = ioCaps
      .flatMap(cap => observed.get(cap) ?? [])
      .slice(0, 3)
      .join(', ');
    diagnostics.error(ErrorCode.CAPABILITY_INFER_MISSING_IO, func.span, {
      func: func.name,
      capabilities: capNames,
      calls: calls || undefined,
    });
  }

  if (observed.has(CapabilityKind.CPU) && !(hasCPU || hasIO)) {
    const cpuCalls = (observed.get(CapabilityKind.CPU) ?? []).slice(0, 3).join(', ');
    diagnostics.error(ErrorCode.CAPABILITY_INFER_MISSING_CPU, func.span, {
      func: func.name,
      calls: cpuCalls || undefined,
    });
  }
}
