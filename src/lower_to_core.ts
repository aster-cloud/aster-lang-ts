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

import { Core as CoreIR } from './core/core_ir.js';
import { canonicalDecimalFromLiteral } from './core/canonical-decimal.js';
import { markForResolution, withResolvedOrigin } from './core/resolution-mark.js';
import { KEYWORD_CTORS } from './frontend/resolution-choice.js';
import { inferCapabilityFromName } from './config/semantic.js';
import { Diagnostics } from './diagnostics/diagnostics.js';
import type { Annotation, Core, Span, Resolved } from './types.js';
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
  Name,
  PatternCtor,
} from './types.js';
import { DefaultAstVisitor } from './ast/ast_visitor.js';
import { DefaultCoreVisitor, createVisitorContext } from './core/visitor.js';
import type { CapabilityKind } from './config/semantic.js';

type CoreOrigin = Core.Origin;

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
 * 把 AST 节点的源码位置挂到 Core IR 节点上（ADR 0055 #17：每个带 kind 的节点都必带 origin）。
 * AST 节点没有 span 时依次尝试 fallback（例如推断类型用其形参 / 函数的位置）；都没有时保留
 * 构造时的 NO_ORIGIN，由 every_node_has_origin 测试兜底发现。
 */
function withOrigin<T extends { origin: CoreOrigin }>(coreNode: T, astNode: unknown, ...fallback: unknown[]): T {
  for (const source of [astNode, ...fallback]) {
    const { span, file } = extractMetadata(source);
    if (span) {
      (coreNode as { origin: CoreOrigin }).origin = spanToOrigin(span, file);
      return coreNode;
    }
  }
  return coreNode;
}

/**
 * 名称解析（ADR 0051）：有 R1 结果时取规范名，否则保留原写法。
 */
function canonicalOf(name: string, resolved: Resolved | undefined): string {
  return resolved?.canonical ?? name;
}

/**
 * 在已附加的 origin 上记录 R1 的原写法与角色（仅 written !== canonical 时）。
 * 无 R1 结果时原样返回，保证未解析的 AST 降级结果不变。
 */
function withResolution<T extends { origin: CoreOrigin }>(coreNode: T, resolved: Resolved | undefined): T {
  if (!resolved) return coreNode;
  (coreNode as { origin: CoreOrigin }).origin = withResolvedOrigin(coreNode.origin, resolved.written, resolved.canonical, resolved.role);
  return coreNode;
}

/**
 * 约束（ADR 0055 #4）：Range 两端是规范十进制串，取自字面量原文；每个约束带自己的 origin。
 */
function lowerConstraints(constraints: readonly import('./types.js').Constraint[] | undefined): Core.Constraint[] {
  return (constraints ?? []).map(c => {
    switch (c.kind) {
      case 'Required':
        return withOrigin(CoreIR.Required(), c);
      case 'Range':
        return withOrigin(CoreIR.Range(rangeBound(c.minRaw, c.min), rangeBound(c.maxRaw, c.max)), c);
      case 'Pattern':
        return withOrigin(CoreIR.Pattern(c.regexp), c);
      default: {
        const never: never = c;
        throw new Error(`未处理的约束：${JSON.stringify(never)}`);
      }
    }
  });
}

/** Range 的一端：优先用字面量原文；只有数值（无原文，如测试手工构造的 AST）时取其十进制表示。 */
function rangeBound(raw: string | undefined, value: number | undefined): string | null {
  if (raw !== undefined) return canonicalDecimalFromLiteral(raw);
  return value === undefined ? null : canonicalDecimalFromLiteral(String(value));
}

/** 注解（ADR 0055 #3）：args 保持源码顺序；位置参数已由解析器命名为 $0、$1…。 */
function lowerAnnotations(annotations: readonly Annotation[] | undefined): Core.Annotation[] {
  return (annotations ?? []).map(a => ({
    name: a.name,
    args: (a.args ?? []).map(arg => ({ name: arg.name, value: arg.value })),
  }));
}

/**
 * Func.effects（ADR 0055 #5，控制器裁决）：只保留授权型具体效应 io / cpu（小写）与已声明的效应变量，
 * 按首次声明顺序去重；pure、async 与未知效应名不授权任何效应，不写入。
 * 内建名优先于效应参数：`<IO>` 这类与内建同名的效应参数由类型检查报 E213。
 */
function lowerEffects(effects: readonly string[], effectParams: readonly string[]): string[] {
  const params = new Set(effectParams);
  const out: string[] = [];
  for (const e of effects) {
    const lower = e.toLowerCase();
    const name = AUTHORIZING_EFFECTS.has(lower) ? lower : params.has(e) ? e : undefined;
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 授权型具体效应名（schema `$defs/BuiltinEffect`）。 */
const AUTHORIZING_EFFECTS: ReadonlySet<string> = new Set(['io', 'cpu']);

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
 * @internal 不从包入口导出：未经 R1 的 AST 降级后名字保持原写法（可能是本地化名）。
 * 外部调用方使用 resolveAndLowerChecked（compile-pipeline）或 browser `compile`。
 */
export function lowerModule(ast: Module): Core.Module {
  const decls = ast.decls.map(lowerDecl);
  const m = CoreIR.Module(ast.name, decls, ast.profile ?? null);
  return withOrigin(m, ast);
}

function lowerDecl(d: Declaration): Core.Declaration {
  switch (d.kind) {
    case 'Import':
      return withOrigin(CoreIR.Import(d.name, d.asName || null, d.version ?? null), d);
    case 'Data':
      return withResolution(withOrigin(
        CoreIR.Data(
          canonicalOf(d.name, d.resolved),
          d.fields.map(f => CoreIR.Field(
            canonicalOf(f.name, f.resolved),
            lowerType(f.type, NO_TYPE_VARS, f),
            lowerConstraints(f.constraints),
            f.typeInferred === true
          ))
        ),
        d
      ), d.resolved);
    case 'Enum':
      return withResolution(
        withOrigin(CoreIR.Enum(canonicalOf(d.name, d.resolved), d.variants.map((v, i) => canonicalOf(v, d.resolvedVariants?.[i]))), d),
        d.resolved
      );
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

function lowerFunc(f: Func): Core.Func {
  const tvars = new Set<string>(f.typeParams ?? []);
  const params = f.params.map(p => CoreIR.Param(
    p.name,
    lowerType(p.type, tvars, p),
    lowerConstraints(p.constraints),
    p.typeInferred === true
  ));
  const ret = lowerType(f.retType, tvars, f);
  const effectParams = f.effectParams ?? [];
  const body = f.body ? lowerBlock(f.body) : withOrigin(CoreIR.Block([]), f);
  const out = CoreIR.Func(
    canonicalOf(f.name, f.resolved),
    f.typeParams ?? [],
    params,
    ret,
    lowerEffects(f.effects ?? [], effectParams),
    body,
    f.effectCaps,
    f.effectCapsExplicit,
    effectParams,
    lowerAnnotations(f.annotations)
  );
  (out as { retTypeInferred: boolean }).retTypeInferred = f.retTypeInferred === true;
  return withResolution(withOrigin(out, f), f.resolved);
}

function lowerBlock(b: Block): Core.Block {
  return withOrigin(CoreIR.Block(b.statements.map(lowerStmt)), b);
}

function lowerStmt(s: Statement): Core.Statement {
  switch (s.kind) {
    case 'Let':
      return withOrigin(CoreIR.Let(s.name, lowerExpr(s.expr)), s);
    case 'Set': {
      // Set 目标属于 FIELD_REF，R1 不解析：保留原写法交给 R2
      const set = withOrigin(CoreIR.Set(s.name, lowerExpr(s.expr)), s);
      markForResolution(set, { written: s.name });
      return set;
    }
    case 'Return':
      return withOrigin(CoreIR.Return(lowerExpr(s.expr)), s);
    case 'If':
      return withOrigin(
        CoreIR.If(
          lowerExpr(s.cond),
          lowerBlock(s.thenBlock),
          s.elseBlock ? lowerBlock(s.elseBlock) : null
        ),
        s
      );
    // Scope sugar lowering placeholder: if a Block starts with a special marker, we could emit Scope. For now none.

    case 'Match':
      return withOrigin(
        CoreIR.Match(
          lowerExpr(s.expr),
          s.cases.map(c => withOrigin(CoreIR.Case(lowerPattern(c.pattern), lowerCaseBody(c.body)), c))
        ),
        s
      );
    case 'Start':
      return withOrigin(CoreIR.Start(s.name, lowerExpr(s.expr)), s);
    case 'Wait':
      return withOrigin(CoreIR.Wait(s.names), s);
    case 'workflow':
      return lowerWorkflow(s as WorkflowStmt);
    case 'Block':
      return withOrigin(CoreIR.Scope((s as Block).statements.map(lowerStmt)), s);
    case 'Call':
      // 裸表达式语句（`File.write("...").`）：求值并丢弃结果，降为 `Let _ be <call>`。
      //
      // ★内层 Call 也必须挂 origin。原实现只给外层 Let 包了 withOrigin，内层
      //   `CoreIR.Call(...)` 直接构造 → 该表达式**没有位置信息**。
      //   后果：ADR 0032 的 trace 锚点与 ADR 0037 的 OriginMap 都按位置定位，
      //   一个无 origin 的节点在「点击源码 ↔ 高亮 IR」里**不可达**——不报错，
      //   只是这段代码从双向导航里静默消失。
      //   （实测 eff_valid_all_caps.aster：真正的 Let 有 expr.origin，
      //     合成的 Let "_" 没有，与 Java 侧跨引擎分叉。）
      return withOrigin(
        CoreIR.Let('_', withOrigin(
          CoreIR.Call(lowerExpr((s as any).target), (s as any).args.map(lowerExpr)), s)),
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

function lowerWorkflow(stmt: WorkflowStmt): Core.Workflow {
  const steps = stmt.steps.map((step, index) => {
    const predecessor = index > 0 ? stmt.steps[index - 1] : null;
    return lowerStep(step, predecessor ? predecessor.name : null);
  });
  const effectCaps = mergeCapabilitySets(steps.map(step => step.effectCaps));
  const retry = stmt.retry
    ? { maxAttempts: stmt.retry.maxAttempts, backoff: stmt.retry.backoff }
    : null;
  const timeout = stmt.timeout ? { milliseconds: stmt.timeout.milliseconds } : null;
  const workflow = CoreIR.Workflow(steps, effectCaps, retry, timeout);
  return withOrigin(workflow, stmt);
}

function lowerStep(stmt: StepStmt, prevStep: string | null): Core.Step {
  const body = lowerBlock(stmt.body);
  const compensate = stmt.compensate ? lowerBlock(stmt.compensate) : null;
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
  const step = CoreIR.Step(stmt.name, body, effectCaps, compensate, dependencies);
  return withOrigin(step, stmt);
}

function mergeCapabilitySets(
  lists: readonly (readonly string[])[]
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
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
  block: Core.Block
): CapabilityKind[] {
  const caps: CapabilityKind[] = [];
  const seen = new Set<CapabilityKind>();
  class WorkflowCapabilityVisitor extends DefaultCoreVisitor {
    override visitExpression(
      e: Core.Expression,
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
): Core.Return | Core.Block {
  // Body can be a Return node or a Block
  if (body.kind === 'Return') {
    return withOrigin(CoreIR.Return(lowerExpr(body.expr)), body);
  }
  return lowerBlock(body);
}

/**
 * 取一个模式引入的绑定名集合 —— 与 Java `CoreLowering.patternBindings` 同构。
 *
 * <p>`PatternName` 绑定自身名字；`PatternCtor` 绑定 `names` 并递归 `args`；
 * `PatternNull` / `PatternInt` 不引入绑定。
 */
function patternBindings(p: Pattern | undefined): Set<string> {
  const out = new Set<string>();
  if (!p) return out;
  if (p.kind === 'PatternName') {
    if (p.name) out.add(p.name);
    return out;
  }
  if (p.kind === 'PatternCtor') {
    for (const n of p.names ?? []) out.add(n);
    for (const arg of p.args ?? []) {
      for (const n of patternBindings(arg)) out.add(n);
    }
    return out;
  }
  return out;
}

/**
 * UFCS 拆分：把 `recv.method(args)` 的调用目标拆成「接收者 + 方法名」。
 *
 * <p>与 Java `AstBuilder.applyCallSuffix` 的行为**逐字对齐**（已实测三种形态）：
 *
 * ```
 *   value.sum(1)    → 接收者 value，方法 sum        （首段是 IDENT → UFCS）
 *   a.b.c(1)        → 接收者 a，    方法 b.c        （接收者只取**首段**）
 *   _x.f(1)         → 接收者 _x，   方法 f          （下划线开头也是 IDENT）
 *   Text.concat(1)  → 不拆分（TYPE_IDENT = 类型/模块限定名）
 *   Map.get(1)      → 不拆分（同上）
 *   数据.求和(1)     → 不拆分（CJK 归 TYPE_IDENT，见下）
 * ```
 *
 * <p>返回 `null` 表示不做 UFCS 转换（调用方按普通 Call 处理）。
 *
 * <p>★判定依据**不是**「首字母是否大写」，而是 lexer 的 IDENT / TYPE_IDENT 之分。
 * 权威规则在 `AsterCustomLexer.isUppercaseStart`（core）：
 *
 * ```
 *   ASCII 小写 a-z 或下划线 _  → IDENT      → 走 UFCS
 *   其余（大写、CJK、…）        → TYPE_IDENT → 不拆分
 * ```
 *
 * 我最初按「首字母 === 大写形式」近似，**实测是错的**：中文 `数据.求和` 在该
 * 近似下会被当作小写（`'数' === '数'.toUpperCase()` 为 true 才排除，实际
 * toUpperCase 对无大小写字符返回自身，故判断反复无常），而 Java 明确把 CJK
 * 归为 TYPE_IDENT、不做 UFCS。此处改用与 core 逐字一致的字符区间判断。
 *
 * <p>★规则本身隐式且不易预期，但它是 Java 侧既有语义并有测试钉住
 * （`AstBuilderTest.testMethodCallTransformsReceiver`）；此处职责是对齐，
 * 不是重新设计。若要改语义，应走 ADR。
 */
function splitUfcsReceiver(
  target: Core.Expression,
  unresolvedTarget: boolean
): { receiver: Core.Expression; method: Core.Expression } | null {
  if (!target || (target as { kind?: string }).kind !== 'Name') return null;
  const full = (target as unknown as { name?: unknown }).name;
  if (typeof full !== 'string') return null;

  const dot = full.indexOf('.');
  if (dot <= 0 || dot === full.length - 1) return null; // 无点，或点在首/末位

  const head = full.slice(0, dot);
  const first = head[0];
  if (first === undefined) return null;
  // 与 core 的 `AsterCustomLexer.isUppercaseStart` 逐字一致：
  // 只有 ASCII 小写或下划线开头（= lexer 的 IDENT）才走 UFCS。
  const isIdentStart = (first >= 'a' && first <= 'z') || first === '_';
  if (!isIdentStart) return null;

  // ★接收者与方法名都必须挂 origin。它们是从**同一个** Name 节点拆出来的，
  //   源码位置沿用该节点的 span。若不挂，这两个节点在 ADR 0032 的 trace 锚点
  //   与 ADR 0037 的 OriginMap 里**不可达**——不报错，只是从双向导航里静默消失
  //   （与 `Let "_"` 内层 Call 缺 origin 是同一类问题）。
  //   注：Java 侧给接收者/方法名的是各自更精确的子 span；此处沿用整体 span，
  //   跨引擎在 `file+line` 口径下一致（同一行），strict 口径下的列差属既有
  //   col 口径问题，不在本次范围。
  const receiver = CoreIR.Name(head);
  const method = CoreIR.Name(full.slice(dot + 1));
  const span = (target as { origin?: unknown }).origin;
  if (span !== undefined) {
    (receiver as { origin?: unknown }).origin = span;
    (method as { origin?: unknown }).origin = span;
  }
  // 拆分前的点分名由 R1 留给 R2 时，拆出的接收者与方法名同样交给 R2（均为裸名）
  if (unresolvedTarget) {
    markForResolution(receiver, { written: head, ufcs: true });
    markForResolution(method, { written: full.slice(dot + 1), ufcs: true });
  }
  return { receiver, method };
}

function lowerExpr(e: Expression): Core.Expression {
  switch (e.kind) {
    case 'Name':
      return lowerName(e);
    case 'Bool':
      return withOrigin(CoreIR.Bool(e.value), e);
    case 'Int':
      return withOrigin(CoreIR.Int(e.value), e);
    case 'Long':
      return withOrigin(CoreIR.Long(e.value), e);
    case 'Double':
      // ADR 0055 #18：规范十进制串取自字面量原文，不经二进制浮点（手工构造、没有原文的 AST 退回其数值）
      return withOrigin(CoreIR.Double(canonicalDecimalFromLiteral(e.raw ?? String(e.value))), e);
    case 'Decimal':
      return withOrigin(CoreIR.Decimal(e.value), e);
    case 'String':
      return withOrigin(CoreIR.String(e.value), e);
    case 'Null':
      return withOrigin(CoreIR.Null(), e);
    case 'Call': {
      // ★内置变体的调用形式归一（aster-lang-ts#124）：`Some(x)` / `Ok(x)` / `Err(x)` /
      // `None()` 与关键字形式 `some of x` 必须降到**完全相同**的 Core IR 节点。
      //
      // 此前只有关键字形式产出 Expr.Some，调用形式一路保留成 Call{Name 'Some'}，
      // 靠解释器在**求值期**特判兜底。单跑 TS 没问题，但把这样的 IR 交给 JVM 引擎
      // 就炸——truffle 期望独立的 Some 节点（CoreModel.Some），只认 Call 的话报
      // `Unknown call target: Some`。即：两引擎各自都"能跑"，唯独跨引擎喂 IR 不通。
      //
      // Java 侧在 **parse 期**就归一（AstBuilder 对 Ok/Err/Some/None 调用形式特判），
      // 故其 IR 里始终是独立节点。这里补上同一步，让两引擎的 Core IR 真正一致。
      //
      // 用户声明同名记录类型的情形不必在此防御：parser 已先行拒绝对已声明类型的
      // 位置式构造（"Cannot construct 'X' with positional arguments"），
      // 故走到这里的 Call 目标不可能是已声明的记录类型。
      if (e.target.kind === 'Name') {
        const ctor = e.target.name;
        if (e.args.length === 1) {
          if (ctor === 'Some') return withOrigin(CoreIR.Some(lowerExpr(e.args[0]!)), e);
          if (ctor === 'Ok') return withOrigin(CoreIR.Ok(lowerExpr(e.args[0]!)), e);
          if (ctor === 'Err') return withOrigin(CoreIR.Err(lowerExpr(e.args[0]!)), e);
        }
        if (ctor === 'None' && e.args.length === 0) {
          return withOrigin(CoreIR.None(), e);
        }
      }
      // ★UFCS（接收者转参数）：`value.sum(1, 2)` → `sum(value, 1, 2)`。
      //
      //   这是 Java 引擎有意设计的调用约定（`AstBuilder.applyCallSuffix`，并由
      //   `AstBuilderTest.testMethodCallTransformsReceiver` 钉住），此前 TS 侧缺失，
      //   导致同一段源码在两个引擎上**实际传参个数不同**——不是表示差异，是行为差异：
      //
      //     io.verify(user, pass)
      //       Java → Call(Name "verify",    [io, user, pass])   3 参
      //       TS   → Call(Name "io.verify", [user, pass])       2 参   ← 分叉
      //
      //   触发条件与 Java 完全一致：限定名的**首段首字母小写**时才做转换。
      //   首字母大写（`Text.concat`、`Http.get`、`Map.get`）是**类型/模块限定名**，
      //   保持整体作为调用目标，不拆分。
      //
      //   ★该规则本身（「首字母大小写决定调用约定」）是隐式的、用户不易预期的，
      //     但它是既有语义且有测试支撑；此处的职责是**与 Java 对齐**，
      //     而不是单方面改变语义。若要重新设计，应走 ADR。
      const target = lowerExpr(e.target);
      const loweredArgs = e.args.map(lowerExpr);
      const ufcs = splitUfcsReceiver(target, e.target.kind === 'Name' && !e.target.resolved);
      if (ufcs) {
        return withOrigin(CoreIR.Call(ufcs.method, [ufcs.receiver, ...loweredArgs]), e);
      }
      return withOrigin(CoreIR.Call(target, loweredArgs), e);
    }
    case 'Construct':
      return withResolution(
        withOrigin(
          CoreIR.Construct(
            canonicalOf(e.typeName, e.resolved),
            e.fields.map(f => ({ name: canonicalOf(f.name, f.resolved), expr: lowerExpr(f.expr) }))
          ),
          e
        ),
        e.resolved
      );
    case 'Ok':
      return withOrigin(CoreIR.Ok(lowerExpr(e.expr)), e);
    case 'Err':
      return withOrigin(CoreIR.Err(lowerExpr(e.expr)), e);
    case 'Some':
      return withOrigin(CoreIR.Some(lowerExpr(e.expr)), e);
    case 'None':
      return withOrigin(CoreIR.None(), e);
    case 'Await':
      return withOrigin(CoreIR.Await(lowerExpr(e.expr)), e);
    case 'IfExpr':
      // ADR 0019 G2b：表达式级 if → Core IR IfExpr（三分支递归 lower）。
      return withOrigin(CoreIR.IfExpr(lowerExpr(e.cond), lowerExpr(e.thenE), lowerExpr(e.elseE)), e);
    case 'ListLit':
      // ADR 0024 C0：列表字面量 → Core IR ListLit（元素递归 lower）。
      return withOrigin(CoreIR.ListLit(e.elements.map(lowerExpr)), e);
    case 'Lambda': {
      // 捕获变量收集：只收**自由变量**（引用了、但在 lambda 内部没被绑定的名字）。
      //
      // ★此前这里没有作用域栈，只排除当前 lambda 自己的形参，于是把
      //   lambda 体内 `Let` 声明的局部、以及嵌套 lambda 的名字/形参
      //   一并当成了捕获（over-capture）。Java 侧 CoreLowering.collectCaptures
      //   有完整的 ArrayDeque<Set<String>> scopes + Stmt.Let 入栈，
      //   两侧对同一段源码产出不同的 captures：
      //
      //     Let f be function with x, produce:
      //       Let localA be 1.
      //       Return If x then outer else localA.
      //
      //     Java → [outer]            TS（修前）→ [outer, localA]
      //
      //   captures 不是元数据：Truffle 的 Loader 按它建 FrameDescriptor 并按位置
      //   传实参，多算一个名字就多一个槽位、且 NameNodeEnv 解析不到时会返回
      //   **名字本身的字符串**——与本轮修掉的 under-capture 是同一套故障机制。
      const scopes: Set<string>[] = [new Set(e.params.map(p => p.name))];
      const names = new Set<string>();
      const isBound = (n: string): boolean => scopes.some(s => s.has(n));
      class CaptureVisitor extends DefaultAstVisitor<void> {
        override visitBlock(b: Block, ctx: void): void {
          // 块级作用域：进块压栈、出块弹栈（与 Java 的 traverseBlock 同构）。
          scopes.push(new Set());
          try {
            super.visitBlock(b, ctx);
          } finally {
            scopes.pop();
          }
        }

        override visitStatement(s: Statement, ctx: void): void {
          if (s.kind === 'Match') {
            // ★Match 的模式会**绑定**新名字，这些名字在该 case 体内不是自由变量。
            //   此前只递归不绑定，于是 `When bound, Return bound.` 里的 bound
            //   被当成捕获（Java 侧 CoreLowering:820-832 有 patternBindings，
            //   两侧因此分叉：Java [] vs TS ["bound"]）。
            this.visitExpression(s.expr, ctx);
            for (const c of s.cases) {
              scopes.push(patternBindings(c.pattern));
              try {
                if (c.body.kind === 'Return') this.visitExpression(c.body.expr, ctx);
                else this.visitBlock(c.body, ctx);
              } finally {
                scopes.pop();
              }
            }
            return;
          }
          super.visitStatement(s, ctx);
          // ★先递归再绑定：`Let x be x + 1` 里右侧的 x 指的是**外层**的 x，
          //   先绑定会把它误判成已绑定而漏掉这次捕获。
          if (s.kind === 'Let') {
            scopes[scopes.length - 1]!.add(s.name);
          }
        }

        override visitExpression(ex: Expression, ctx: void): void {
          if (ex.kind === 'Lambda') {
            // 嵌套 lambda：内层形参在内层作用域内有效；内层引用的外部变量
            // 必须**穿透**记到外层 captures（外层不捕获，内层就拿不到）。
            scopes.push(new Set(ex.params.map(p => p.name)));
            try {
              this.visitBlock(ex.body, ctx);
            } finally {
              scopes.pop();
            }
            return;
          }
          // 以 R1 规范名记录捕获（未解析时即原写法；R2 再按其解析结果改写）
          const captured = ex.kind === 'Name' ? canonicalOf(ex.name, ex.resolved) : '';
          if (ex.kind === 'Name' && !isBound(captured) && !captured.includes('.')) {
            names.add(captured);
          }
          super.visitExpression(ex, ctx);
        }
      }
      new CaptureVisitor().visitBlock(e.body, undefined as unknown as void);
      const captures = Array.from(names);
      const coreParams = e.params.map(p => CoreIR.Param(
        p.name,
        lowerType(p.type, NO_TYPE_VARS, p),
        [],
        // 解析器对未标注类型的 lambda 参数同样写入 typeInferred（Parameter），BaseParameter 未声明该字段
        (p as { typeInferred?: boolean }).typeInferred === true
      ));
      const lambda = CoreIR.Lambda(coreParams, lowerType(e.retType, NO_TYPE_VARS, e), lowerBlock(e.body), captures);
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

function lowerPattern(p: Pattern): Core.Pattern {
  switch (p.kind) {
    case 'PatternNull':
      return withOrigin(CoreIR.PatNull(), p);
    case 'PatternInt':
      return withOrigin(CoreIR.PatInt(p.value), p);
    case 'PatternCtor':
      return lowerPatternCtor(p);
    case 'PatternName': {
      // 裸的关键词构造器（`When None`）是 0 参变体模式（ADR 0055 #16），与 Java 的裸名构造器同形
      if (KEYWORD_CTORS.has(p.name)) return withOrigin(CoreIR.PatCtor(p.name, []), p);
      // 模式名可能是期望枚举下的成员（ADR 0051 裁决 R12），由 R2 判定
      const pat = withOrigin(CoreIR.PatName(p.name), p);
      markForResolution(pat, { written: p.name });
      return pat;
    }
    default: {
      const { span } = extractMetadata(p);
      const kind = (p as { kind: string }).kind;
      Diagnostics.unknownPatternKind(kind, span?.start ?? { line: 0, col: 0 }).throw();
      throw new Error('unreachable'); // For TypeScript's control flow analysis
    }
  }
}

/**
 * 构造器模式（ADR 0055 #15）：只用 args。`Ok(x)` 的各个名字与 Java AstBuilder 一样作为嵌套的名字模式
 * 降级（各取自己的 span，没有时取构造器位置），由 R2 判定成员还是绑定；嵌套模式（AST 的 args）照常降级。
 */
function lowerPatternCtor(p: PatternCtor): Core.PatCtor {
  const named = (p.names ?? []).map((n, i): Pattern => ({ kind: 'PatternName', name: n, span: p.nameSpans?.[i] ?? p.span }));
  const args = [...named, ...(p.args ?? [])].map(pp => lowerPattern(pp));
  const pat = withResolution(withOrigin(CoreIR.PatCtor(canonicalOf(p.typeName, p.resolved), args), p), p.resolved);
  // 主语类型在 R1 未知的用户构造器留给 R2；关键词构造器不查词汇
  if (!p.resolved && !KEYWORD_CTORS.has(p.typeName)) markForResolution(pat, { written: p.typeName });
  return pat;
}

/**
 * 值位置名字：R1 已解析的取规范名。裸单段名一律交给 R2（期望类型为枚举时结果可能改变），
 * 并记下 R1 的角色；R1 未决定的点分名（字段路径、限定调用）同样交给 R2。
 */
function lowerName(e: Name): Core.Name {
  const node = withResolution(withOrigin(CoreIR.Name(canonicalOf(e.name, e.resolved)), e), e.resolved);
  if (!e.name.includes('.')) {
    markForResolution(node, e.resolved ? { written: e.name, r1Role: e.resolved.role } : { written: e.name });
  } else if (!e.resolved) {
    markForResolution(node, { written: e.name });
  }
  return node;
}

function spanToOrigin(span: Span, file: string | null): CoreOrigin {
  return { file, start: span.start, end: span.end, written: null, role: null };
}

const NO_TYPE_VARS: ReadonlySet<string> = new Set();

/**
 * 类型降级。`vars` 为函数声明的类型参数：其中的名字降为 TypeVar。每个类型节点都带 origin
 * （ADR 0055 #17）：取类型自身的 span，没有时（解析器合成的推断类型）取 fallback 节点的位置。
 * 签名中被改写的写法照常记录 written / role（ADR 0051 §4）。
 */
function lowerType(t: Type, vars: ReadonlySet<string>, ...fallback: unknown[]): Core.Type {
  const sub = (x: Type): Core.Type => lowerType(x, vars, t, ...fallback);
  const at = <T extends { origin: CoreOrigin }>(node: T): T => withOrigin(node, t, ...fallback);
  switch (t.kind) {
    case 'TypeName':
      return vars.has(t.name)
        ? at(CoreIR.TypeVar(t.name))
        : withResolution(at(CoreIR.TypeName(canonicalOf(t.name, t.resolved))), t.resolved);
    case 'TypeVar':
      return at(CoreIR.TypeVar(t.name));
    case 'EffectVar':
      // v2 没有效应变量类型节点（schema Type 联合不含 EffectVar）；解析器不产出它，手工 AST 按类型变量处理
      return at(CoreIR.TypeVar(t.name));
    case 'TypeApp':
      return withResolution(at(CoreIR.TypeApp(canonicalOf(t.base, t.resolved), t.args.map(sub))), t.resolved);
    case 'Maybe':
      return at(CoreIR.Maybe(sub(t.type)));
    case 'Option':
      return at(CoreIR.Option(sub(t.type)));
    case 'Result':
      return at(CoreIR.Result(sub(t.ok), sub(t.err)));
    case 'List':
      return at(CoreIR.List(sub(t.type)));
    case 'Map':
      return at(CoreIR.Map(sub(t.key), sub(t.val)));
    case 'TypePii':
      return at(CoreIR.Pii(sub(t.baseType), t.sensitivity, t.category));
    case 'FuncType':
      return at(CoreIR.FuncType(t.params.map(sub), sub(t.ret)));
    default: {
      const { span } = extractMetadata(t);
      const kind = (t as { kind: string }).kind;
      Diagnostics.unknownTypeKind(kind, span?.start ?? { line: 0, col: 0 }).throw();
      throw new Error('unreachable'); // For TypeScript's control flow analysis
    }
  }
}
