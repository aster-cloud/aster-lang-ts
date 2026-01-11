/**
 * @module lower_to_core
 *
 * AST 到 Core IR 的降级器：将高级 AST 转换为小型、严格的 Core IR。
 *
 * **功能**：
 * - 将 AST 节点转换为 Core IR 节点
 * - 展开语法糖（如 `User?` → `Maybe of User`）
 * - 规范化表达式和语句结构
 * - 保留源代码位置信息（origin）
 * - 为后续的类型检查和代码生成准备简化的 IR
 *
 * **Core IR 设计**：
 * - 更小的节点集合（相比 AST）
 * - 显式的作用域节点（Scope）
 * - 规范化的模式匹配
 * - 简化的效果标注
 */

import { Core } from './core/core_ir.js';
import { parseEffect, getAllEffects, inferCapabilityFromName } from './config/semantic.js';
import type { Effect } from './config/semantic.js';
import { Diagnostics } from './diagnostics/diagnostics.js';
import type { Span, Origin } from './types.js';
import type {
  Module,
  Declaration,
  Func,
  Block,
  Statement,
  Expression,
  Pattern,
  Type,
  WorkflowStmt,
  StepStmt,
} from './types.js';
import { DefaultAstVisitor } from './ast/ast_visitor.js';
import { DefaultCoreVisitor, createVisitorContext } from './core/visitor.js';
import type { CapabilityKind } from './config/semantic.js';

// ==================== 类型安全的元数据辅助函数 ====================

/**
 * 从 AST 节点中提取 Span 和文件路径信息。
 *
 * 由于 AST 节点的 span 和 file 字段是可选的，且未在所有类型定义中显式声明，
 * 这里需要使用类型断言来访问这些字段。这是安全的，因为这些字段在运行时确实存在。
 */
interface WithMetadata {
  readonly span?: Span;
  readonly file?: string | null;
}

/**
 * 从 AST 节点提取元数据（span 和 file）。
 */
function extractMetadata(node: unknown): { span: Span | undefined; file: string | null } {
  const n = node as WithMetadata;
  return {
    span: n.span,
    file: n.file ?? null,
  };
}

/**
 * 将 AST 节点的元数据（origin）附加到 Core IR 节点。
 *
 * @param coreNode - Core IR 节点（可变对象）
 * @param astNode - AST 节点（用于提取元数据）
 * @returns 附加了元数据的 Core IR 节点
 */
function withOrigin<T extends { origin?: Origin }>(
  coreNode: T,
  astNode: unknown
): T {
  const { span, file } = extractMetadata(astNode);
  const origin = spanToOrigin(span, file);
  if (origin) {
    // Core IR 构造函数返回的对象实际上是可变的，尽管类型定义声明为 readonly
    // 这是设计上的折衷：类型系统认为它们是只读的，但在降级阶段我们需要附加元数据
    (coreNode as { -readonly [K in keyof T]: T[K] }).origin = origin;
  }
  return coreNode;
}

/**
 * 将效果能力（effectCaps）从 AST Func 节点传递到 Core IR Func 节点。
 *
 * @param coreFunc - Core IR Func 节点
 * @param astFunc - AST Func 节点
 * @returns 附加了能力元数据的 Core IR Func 节点
 */
function withEffectCaps(
  coreFunc: import('./types.js').Core.Func,
  astFunc: Func
): import('./types.js').Core.Func {
  type MutableFunc = {
    -readonly [K in keyof import('./types.js').Core.Func]: (import('./types.js').Core.Func)[K]
  };
  const mutableFunc = coreFunc as unknown as MutableFunc;
  mutableFunc.effectCaps = [...astFunc.effectCaps];
  mutableFunc.effectCapsExplicit = astFunc.effectCapsExplicit;
  return coreFunc;
}

function withFuncPiiMetadata(
  coreFunc: import('./types.js').Core.Func
): import('./types.js').Core.Func {
  const metadata = aggregateFuncPii(coreFunc);
  if (!metadata) return coreFunc;
  type MutableFunc = {
    -readonly [K in keyof import('./types.js').Core.Func]: (import('./types.js').Core.Func)[K]
  };
  const mutable = coreFunc as unknown as MutableFunc;
  mutable.piiLevel = metadata.level;
  mutable.piiCategories = [...metadata.categories];
  return coreFunc;
}

type FuncPiiMeta = {
  readonly level: import('./types.js').PiiSensitivityLevel;
  readonly categories: readonly string[];
};

const PII_LEVEL_ORDER: Record<string, number> = { L1: 1, L2: 2, L3: 3 };

function aggregateFuncPii(func: import('./types.js').Core.Func): FuncPiiMeta | null {
  let summary: FuncPiiMeta | null = null;
  for (const param of func.params) {
    summary = mergeFuncPiiMeta(summary, extractPiiFromType(param.type));
  }
  return mergeFuncPiiMeta(summary, extractPiiFromType(func.ret));
}

function extractPiiFromType(type?: import('./types.js').Core.Type | null): FuncPiiMeta | null {
  if (!type) return null;
  switch (type.kind) {
    case 'PiiType': {
      const categories = type.category ? [type.category] : [];
      const baseMeta = extractPiiFromType(type.baseType);
      const current: FuncPiiMeta = { level: type.sensitivity, categories };
      return mergeFuncPiiMeta(current, baseMeta);
    }
    case 'Result':
      return mergeFuncPiiMeta(extractPiiFromType(type.ok), extractPiiFromType(type.err));
    case 'Maybe':
    case 'Option':
    case 'List':
      return extractPiiFromType(type.type);
    case 'Map':
      return mergeFuncPiiMeta(extractPiiFromType(type.key), extractPiiFromType(type.val));
    case 'FuncType': {
      let meta: FuncPiiMeta | null = null;
      for (const param of type.params ?? []) {
        meta = mergeFuncPiiMeta(meta, extractPiiFromType(param));
      }
      return mergeFuncPiiMeta(meta, extractPiiFromType(type.ret));
    }
    case 'TypeApp': {
      let meta: FuncPiiMeta | null = null;
      for (const arg of type.args ?? []) {
        meta = mergeFuncPiiMeta(meta, extractPiiFromType(arg));
      }
      return meta;
    }
    default:
      return null;
  }
}

function mergeFuncPiiMeta(left: FuncPiiMeta | null, right: FuncPiiMeta | null): FuncPiiMeta | null {
  if (!left) return right;
  if (!right) return left;
  return {
    level: pickHigherPiiLevel(left.level, right.level),
    categories: mergeCategories(left.categories, right.categories),
  };
}

function pickHigherPiiLevel(
  left: import('./types.js').PiiSensitivityLevel,
  right: import('./types.js').PiiSensitivityLevel
): import('./types.js').PiiSensitivityLevel {
  const leftRank = PII_LEVEL_ORDER[left] ?? 0;
  const rightRank = PII_LEVEL_ORDER[right] ?? 0;
  return leftRank >= rightRank ? left : right;
}

function mergeCategories(
  left: readonly string[],
  right: readonly string[]
): string[] {
  const seen = new Set<string>();
  for (const item of left) {
    if (item) seen.add(item);
  }
  for (const item of right) {
    if (item) seen.add(item);
  }
  return Array.from(seen);
}

/**
 * 将 AST Constraint 转换为 Core IR Constraint。
 *
 * @param constraints - AST 约束列表
 * @returns Core IR 约束列表
 */
function lowerConstraints(
  constraints: readonly import('./types.js').Constraint[] | undefined
): readonly import('./types.js').Core.Constraint[] {
  if (!constraints || constraints.length === 0) {
    return [];
  }
  return constraints.map(c => {
    switch (c.kind) {
      case 'Required':
        return { kind: 'Required' } as import('./types.js').Core.ConstraintRequired;
      case 'Range':
        return { kind: 'Range', min: c.min, max: c.max } as import('./types.js').Core.ConstraintRange;
      case 'Pattern':
        return { kind: 'Pattern', regexp: c.regexp } as import('./types.js').Core.ConstraintPattern;
      default:
        // 类型检查器会捕获未处理的情况
        return c as never;
    }
  });
}

/**
 * 将 AST Module 降级为 Core IR Module。
 *
 * 这是 Aster 编译管道的第四步，将高级的抽象语法树转换为更简洁、更严格的 Core IR，
 * 以便进行类型检查和后续的代码生成。
 *
 * **降级转换**：
 * - 展开语法糖（`User?` → `Maybe of User`、`Result of A and B` → 标准 Result 类型）
 * - 规范化函数体为 Block 和 Statement 序列
 * - 将模式匹配转换为 Core IR 的 Case 结构
 * - 保留原始位置信息用于错误报告
 *
 * @param ast - AST Module 节点（通过 parser.parse 生成）
 * @returns Core IR Module 节点，包含所有声明的规范化表示
 *
 * @example
 * ```typescript
 * import { canonicalize, lex, parse, lowerModule } from '@wontlost-ltd/aster-lang';
 *
 * const src = `This module is app.
 * To greet, produce Text:
 *   Return "Hello".
 * `;
 *
 * const ast = parse(lex(canonicalize(src)));
 * const core = lowerModule(ast);
 *
 * console.log(core.kind);  // "Module"
 * console.log(core.name);  // "app"
 * // Core IR 是更简洁的表示，适合类型检查和代码生成
 * ```
 */
export function lowerModule(ast: Module): import('./types.js').Core.Module {
  const decls = ast.decls.map(lowerDecl);
  const m = Core.Module(ast.name, decls);
  return withOrigin(m, ast);
}

function lowerDecl(d: Declaration): import('./types.js').Core.Declaration {
  switch (d.kind) {
    case 'Import':
      return withOrigin(Core.Import(d.name, d.asName || null), d);
    case 'Data':
      return withOrigin(
        Core.Data(
          d.name,
          d.fields.map(f => ({
            name: f.name,
            type: lowerType(f.type),
            constraints: lowerConstraints(f.constraints),
          }))
        ),
        d
      );
    case 'Enum':
      return withOrigin(Core.Enum(d.name, [...d.variants]), d);
    case 'Func':
      return lowerFunc(d);
    default: {
      const { span } = extractMetadata(d);
      const kind = (d as { kind: string }).kind;
      Diagnostics.unknownDeclKind(kind, span?.start ?? { line: 0, col: 0 }).throw();
      throw new Error('unreachable'); // For TypeScript's control flow analysis
    }
  }
}

function lowerFunc(f: Func): import('./types.js').Core.Func {
  const tvars = new Set<string>(f.typeParams ?? []);
  const params = f.params.map(p => ({
    name: p.name,
    type: lowerTypeWithVars(p.type, tvars),
    constraints: lowerConstraints(p.constraints),
    ...(p.typeInferred ? { typeInferred: true } : {}),
  }));
  const ret = lowerTypeWithVars(f.retType, tvars);
  // 严格校验效果字符串，拒绝未知值，同时将效应变量保留到声明列表
  const effectParamSet = new Set(f.effectParams ?? []);
  const declaredEffects: Array<Effect | import('./types.js').Core.EffectVar> = [];
  const effects: Effect[] = [];
  for (const e of f.effects ?? []) {
    const effect = parseEffect(e.toLowerCase());
    if (effect !== null) {
      effects.push(effect);
      declaredEffects.push(effect);
      continue;
    }
    if (effectParamSet.has(e)) {
      declaredEffects.push({ kind: 'EffectVar', name: e } as import('./types.js').Core.EffectVar);
      continue;
    }
    const validEffects = getAllEffects().join(', ');
    const { span } = extractMetadata(f);
    Diagnostics.unknownEffect(e, validEffects, span?.start ?? { line: 0, col: 0 }).throw();
    throw new Error('unreachable'); // For TypeScript's control flow analysis
  }
  const body = f.body ? lowerBlock(f.body) : Core.Block([]);
  const out = Core.Func(
    f.name,
    f.typeParams ?? [],
    params,
    ret,
    effects,
    body,
    f.effectCaps,
    f.effectCapsExplicit,
    f.effectParams,
    declaredEffects
  );
  if (f.retTypeInferred) {
    (out as { retTypeInferred?: boolean }).retTypeInferred = true;
  }
  // 传递能力与 PII 元数据，并附带源位置信息
  const enriched = withFuncPiiMetadata(withEffectCaps(out, f));
  return withOrigin(enriched, f);
}

function lowerBlock(b: Block): import('./types.js').Core.Block {
  return withOrigin(Core.Block(b.statements.map(lowerStmt)), b);
}

function lowerStmt(s: Statement): import('./types.js').Core.Statement {
  switch (s.kind) {
    case 'Let':
      return withOrigin(Core.Let(s.name, lowerExpr(s.expr)), s);
    case 'Set':
      return withOrigin(Core.Set(s.name, lowerExpr(s.expr)), s);
    case 'Return':
      return withOrigin(Core.Return(lowerExpr(s.expr)), s);
    case 'If':
      return withOrigin(
        Core.If(
          lowerExpr(s.cond),
          lowerBlock(s.thenBlock),
          s.elseBlock ? lowerBlock(s.elseBlock) : null
        ),
        s
      );
    // Scope sugar lowering placeholder: if a Block starts with a special marker, we could emit Scope. For now none.

    case 'Match':
      return withOrigin(
        Core.Match(
          lowerExpr(s.expr),
          s.cases.map(c => withOrigin(Core.Case(lowerPattern(c.pattern), lowerCaseBody(c.body)), c))
        ),
        s
      );
    case 'Start':
      return withOrigin(Core.Start(s.name, lowerExpr(s.expr)), s);
    case 'Wait':
      return withOrigin(Core.Wait(s.names), s);
    case 'workflow':
      return lowerWorkflow(s as WorkflowStmt);
    case 'Block':
      return withOrigin(Core.Scope((s as Block).statements.map(lowerStmt)), s);
    case 'Call':
      // Expression statement: Call used for side effects
      // Lower to: Let _ be <call>
      return withOrigin(
        Core.Let('_', Core.Call(lowerExpr((s as any).target), (s as any).args.map(lowerExpr))),
        s
      );
    default: {
      // Parser now prohibits bare expressions, so this should never be reached
      const { span } = extractMetadata(s);
      const kind = (s as any).kind;
      Diagnostics.unknownStmtKind(kind, span?.start ?? { line: 0, col: 0 }).throw();
      throw new Error('unreachable'); // For TypeScript's control flow analysis
    }
  }
}

function lowerWorkflow(stmt: WorkflowStmt): import('./types.js').Core.Workflow {
  const steps = stmt.steps.map((step, index) => {
    const predecessor = index > 0 ? stmt.steps[index - 1] : null;
    return lowerStep(step, predecessor ? predecessor.name : null);
  });
  const effectCaps = mergeCapabilitySets(steps.map(step => step.effectCaps));
  const retry = stmt.retry
    ? { maxAttempts: stmt.retry.maxAttempts, backoff: stmt.retry.backoff }
    : undefined;
  const timeout = stmt.timeout ? { milliseconds: stmt.timeout.milliseconds } : undefined;
  const workflow = Core.Workflow(steps, effectCaps, retry, timeout);
  return withOrigin(workflow, stmt);
}

function lowerStep(stmt: StepStmt, prevStep: string | null): import('./types.js').Core.Step {
  const body = lowerBlock(stmt.body);
  const compensate = stmt.compensate ? lowerBlock(stmt.compensate) : undefined;
  const effectCaps = mergeCapabilitySets([
    collectCapabilitiesFromBlock(body),
    ...(compensate ? [collectCapabilitiesFromBlock(compensate)] : []),
  ]);
  // 如果未显式声明依赖，则自动串行依赖前一节点以保持旧语义
  const dependencies =
    stmt.dependencies && stmt.dependencies.length > 0
      ? stmt.dependencies
      : prevStep
        ? [prevStep]
        : [];
  const step = Core.Step(stmt.name, body, effectCaps, compensate, dependencies);
  return withOrigin(step, stmt);
}

function mergeCapabilitySets(
  lists: readonly (readonly CapabilityKind[])[]
): CapabilityKind[] {
  const merged: CapabilityKind[] = [];
  const seen = new Set<CapabilityKind>();
  for (const caps of lists) {
    if (!caps) continue;
    for (const cap of caps) {
      if (!seen.has(cap)) {
        seen.add(cap);
        merged.push(cap);
      }
    }
  }
  return merged;
}

function collectCapabilitiesFromBlock(
  block: import('./types.js').Core.Block
): CapabilityKind[] {
  const caps: CapabilityKind[] = [];
  const seen = new Set<CapabilityKind>();
  class WorkflowCapabilityVisitor extends DefaultCoreVisitor {
    override visitExpression(
      e: import('./types.js').Core.Expression,
      context: import('./core/visitor.js').VisitorContext
    ): void {
      if (e.kind === 'Call' && e.target.kind === 'Name') {
        const capability = inferCapabilityFromName(e.target.name);
        if (capability && !seen.has(capability)) {
          seen.add(capability);
          caps.push(capability);
        }
      }
      super.visitExpression(e, context);
    }
  }
  new WorkflowCapabilityVisitor().visitBlock(block, createVisitorContext());
  return caps;
}

function lowerCaseBody(
  body: import('./types.js').Return | Block
): import('./types.js').Core.Return | import('./types.js').Core.Block {
  // Body can be a Return node or a Block
  if (body.kind === 'Return') {
    return withOrigin(Core.Return(lowerExpr(body.expr)), body);
  }
  return lowerBlock(body);
}

function lowerExpr(e: Expression): import('./types.js').Core.Expression {
  switch (e.kind) {
    case 'Name':
      return withOrigin(Core.Name(e.name), e);
    case 'Bool':
      return withOrigin(Core.Bool(e.value), e);
    case 'Int':
      return withOrigin(Core.Int(e.value), e);
    case 'Long':
      return withOrigin(Core.Long(e.value), e);
    case 'Double':
      return withOrigin(Core.Double(e.value), e);
    case 'String':
      return withOrigin(Core.String(e.value), e);
    case 'Null':
      return withOrigin(Core.Null(), e);
    case 'Call':
      return withOrigin(Core.Call(lowerExpr(e.target), e.args.map(lowerExpr)), e);
    case 'Construct':
      return withOrigin(
        Core.Construct(
          e.typeName,
          e.fields.map(f => ({ name: f.name, expr: lowerExpr(f.expr) }))
        ),
        e
      );
    case 'Ok':
      return withOrigin(Core.Ok(lowerExpr(e.expr)), e);
    case 'Err':
      return withOrigin(Core.Err(lowerExpr(e.expr)), e);
    case 'Some':
      return withOrigin(Core.Some(lowerExpr(e.expr)), e);
    case 'None':
      return withOrigin(Core.None(), e);
    case 'Await':
      return withOrigin(Core.Await(lowerExpr(e.expr)), e);
    case 'Lambda': {
      // 使用统一 AST 访客进行捕获变量收集
      const paramNames = new Set(e.params.map(p => p.name));
      const names = new Set<string>();
      class CaptureVisitor extends DefaultAstVisitor<void> {
        override visitExpression(ex: Expression): void {
          if (ex.kind === 'Name' && !paramNames.has(ex.name) && !ex.name.includes('.')) {
            names.add(ex.name);
          }
          super.visitExpression(ex, undefined as unknown as void);
        }
      }
      new CaptureVisitor().visitBlock(e.body, undefined as unknown as void);
      const captures = Array.from(names);
      const coreParams = e.params.map(p => ({ name: p.name, type: lowerType(p.type) }));
      const ret = lowerType(e.retType);
      const lambda: import('./types.js').Core.Lambda = {
        kind: 'Lambda',
        params: coreParams,
        retType: ret,  // BaseLambda expects retType
        ret,            // Core.Lambda also has ret
        body: lowerBlock(e.body),
        captures,
      };
      return withOrigin(lambda, e);
    }
    default: {
      const { span } = extractMetadata(e);
      const kind = (e as { kind: string }).kind;
      Diagnostics.unknownExprKind(kind, span?.start ?? { line: 0, col: 0 }).throw();
      throw new Error('unreachable'); // For TypeScript's control flow analysis
    }
  }
}

function lowerPattern(p: Pattern): import('./types.js').Core.Pattern {
  switch (p.kind) {
    case 'PatternNull':
      return withOrigin(Core.PatNull(), p);
    case 'PatternInt':
      return withOrigin(Core.PatInt(p.value), p);
    case 'PatternCtor': {
      const ctor = p as Pattern & { args?: readonly Pattern[] };
      const args = ctor.args ? ctor.args.map(pp => lowerPattern(pp)) : undefined;
      return withOrigin(Core.PatCtor(p.typeName, [...(p.names ?? [])], args), p);
    }
    case 'PatternName':
      return withOrigin(Core.PatName(p.name), p);
    default: {
      const { span } = extractMetadata(p);
      const kind = (p as { kind: string }).kind;
      Diagnostics.unknownPatternKind(kind, span?.start ?? { line: 0, col: 0 }).throw();
      throw new Error('unreachable'); // For TypeScript's control flow analysis
    }
  }
}

function spanToOrigin(span: Span | undefined, file: string | null): Origin | null {
  if (!span) return null;
  const origin: Origin = {
    start: span.start,
    end: span.end,
  };
  if (file !== null) {
    (origin as { file?: string }).file = file;
  }
  return origin;
}

function lowerType(t: Type): import('./types.js').Core.Type {
  switch (t.kind) {
    case 'TypeName':
      return withOrigin(Core.TypeName(t.name), t);
    case 'TypeVar':
      return withOrigin(Core.TypeVar(t.name), t);
    case 'TypeApp':
      return withOrigin(Core.TypeApp(t.base, t.args.map(lowerType)), t);
    case 'Maybe':
      return withOrigin(Core.Maybe(lowerType(t.type)), t);
    case 'Option':
      return withOrigin(Core.Option(lowerType(t.type)), t);
    case 'Result':
      return withOrigin(Core.Result(lowerType(t.ok), lowerType(t.err)), t);
    case 'List':
      return withOrigin(Core.List(lowerType(t.type)), t);
    case 'Map':
      return withOrigin(Core.Map(lowerType(t.key), lowerType(t.val)), t);
    case 'TypePii':
      return withOrigin(Core.Pii(lowerType(t.baseType), t.sensitivity, t.category), t);
    default: {
      const { span } = extractMetadata(t);
      const kind = (t as { kind: string }).kind;
      Diagnostics.unknownTypeKind(kind, span?.start ?? { line: 0, col: 0 }).throw();
      throw new Error('unreachable'); // For TypeScript's control flow analysis
    }
  }
}

function lowerTypeWithVars(t: Type, vars: Set<string>): import('./types.js').Core.Type {
  switch (t.kind) {
    case 'TypeName':
      return vars.has(t.name)
        ? ({ kind: 'TypeVar', name: t.name } as import('./types.js').Core.TypeVar)
        : Core.TypeName(t.name);
    case 'EffectVar':
      return { kind: 'EffectVar', name: t.name } as import('./types.js').Core.EffectVar;
    case 'Maybe':
      return Core.Maybe(lowerTypeWithVars(t.type, vars));
    case 'Option':
      return Core.Option(lowerTypeWithVars(t.type, vars));
    case 'Result':
      return Core.Result(lowerTypeWithVars(t.ok, vars), lowerTypeWithVars(t.err, vars));
    case 'List':
      return Core.List(lowerTypeWithVars(t.type, vars));
    case 'Map':
      return Core.Map(lowerTypeWithVars(t.key, vars), lowerTypeWithVars(t.val, vars));
    case 'TypeApp':
      return {
        kind: 'TypeApp',
        base: t.base,
        args: t.args.map(tt => lowerTypeWithVars(tt, vars)),
      } as import('./types.js').Core.Type;
    case 'TypeVar':
      return { kind: 'TypeVar', name: t.name } as import('./types.js').Core.TypeVar;
    case 'TypePii':
      return Core.Pii(lowerTypeWithVars(t.baseType, vars), t.sensitivity, t.category);
    default:
      return lowerType(t);
  }
}
