import type { Core, Span } from '../types.js';
import { CapabilityKind, inferCapabilityFromName } from '../config/semantic.js';
import { ENFORCE_CAPABILITIES } from '../config/runtime.js';
import { DefaultCoreVisitor, createVisitorContext } from '../core/visitor.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { DiagnosticBuilder } from './diagnostics.js';

/**
 * 检查函数声明的能力集是否覆盖实际调用
 */
export function checkCapabilities(func: Core.Func, diagnostics: DiagnosticBuilder): void {
  if (!ENFORCE_CAPABILITIES) return;

  const meta = func as unknown as { effectCaps: readonly CapabilityKind[]; effectCapsExplicit: boolean };
  if (!meta.effectCapsExplicit || meta.effectCaps.length === 0) return;

  const declared = new Set<CapabilityKind>(meta.effectCaps);
  const used = collectCapabilities(func.body);

  for (const [cap, callSites] of used) {
    if (!declared.has(cap)) {
      diagnostics.error(ErrorCode.EFF_CAP_MISSING, func.span, {
        func: func.name,
        cap,
        declared: [...declared].join(', '),
        calls: callSites,
      });
    }
  }

  for (const cap of declared) {
    if (!used.has(cap)) {
      diagnostics.info(ErrorCode.EFF_CAP_SUPERFLUOUS, func.span, { func: func.name, cap });
    }
  }
}

/**
 * 收集块中使用到的能力调用
 */
export function collectCapabilities(block: Core.Block): Map<CapabilityKind, string[]> {
  const caps = new Map<CapabilityKind, string[]>();
  class CapabilityVisitor extends DefaultCoreVisitor {
    override visitExpression(expression: Core.Expression, context: import('../core/visitor.js').VisitorContext): void {
      if (expression.kind === 'Call' && expression.target.kind === 'Name') {
        const name = expression.target.name;
        const inferred = inferCapabilityFromName(name);
        if (inferred) {
          const entries = caps.get(inferred);
          if (entries) {
            entries.push(name);
          } else {
            caps.set(inferred, [name]);
          }
        }
      }
      super.visitExpression(expression, context);
    }
  }
  new CapabilityVisitor().visitBlock(block, createVisitorContext());
  return caps;
}

/**
 * 收集 block 内出现的 workflow 语句
 */
export function collectWorkflows(block: Core.Block): Core.Workflow[] {
  const workflows: Core.Workflow[] = [];
  class WorkflowCollector extends DefaultCoreVisitor {
    override visitStatement(statement: Core.Statement, context: import('../core/visitor.js').VisitorContext): void {
      if (statement.kind === 'workflow') workflows.push(statement);
      super.visitStatement(statement, context);
    }
  }
  new WorkflowCollector().visitBlock(block, createVisitorContext());
  return workflows;
}

/**
 * 校验 workflow 步骤使用的能力是否都已声明
 */
export function reportWorkflowCapabilityViolation(
  diagnostics: DiagnosticBuilder,
  declaredCaps: Set<CapabilityKind>,
  observedCaps: Map<CapabilityKind, string[]>,
  funcName: string,
  stepName: string,
  span: Span | undefined
): void {
  for (const cap of observedCaps.keys()) {
    if (!declaredCaps.has(cap)) {
      diagnostics.error(ErrorCode.WORKFLOW_UNDECLARED_CAPABILITY, span, {
        func: funcName,
        step: stepName,
        capability: cap,
      });
    }
  }
}
