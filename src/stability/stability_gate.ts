/**
 * StabilityGate — 编译器强制 Stable/Experimental 边界（ADR 0031，P0-C）。
 *
 * spec-1.0-freeze 把语言特性分 Stable / Experimental / Excluded，承诺「Stable 集 1.x 内
 * 语法+语义不变」。但编译器对 Experimental 特性零拦截 → 客户可能无意依赖 Experimental
 * 特性，下版本语义变了规则悄悄坏。本 gate 扫 **Core IR**（非 typecheck、非表面 AST）找
 * 5 类 Experimental 特性，产 W600 诊断，warn 默认 + strict surface 可拒。
 *
 * ★为何扫 Core IR（ADR 0031 §3.2）：aster-api 生产路径不走 typecheck（PolicyCompiler.compile
 * 只 parse+lower）——gate 若挂 typecheck，服务端 compile/激活看不到 Experimental 使用，
 * strict 拒不了=假门禁。StabilityGate 是独立 pass，接所有产 Core IR 的 enforcement surface。
 *
 * ★遍历用 {@link DefaultCoreVisitor}（显式 switch + assertNever 穷尽守卫），非结构化反射
 * 遍历（Codex 审查纠正）——Java 侧可用同款显式 switch 复刻，Core union 新增 kind 时两边都
 * 编译期强制更新，漏报变编译错误而非运行时沉默。
 *
 * ★5 类信号全部实证在 lowered Core IR 保真：
 *   Workflow(Start/Wait/workflow/Await) / Import.version / Func.effectCapsExplicit /
 *   PiiType 节点+Func.piiLevel / annotation.name∈{example,deprecated}。
 *
 * ★双引擎 parity：Java 侧须实现同一 5 类检测，同源码产同 featureId+nodeKind 集（M1 exit 硬门）。
 */

import type { Core, Span, Origin } from '../types.js';
import { DefaultCoreVisitor } from '../core/visitor.js';

/**
 * W600 诊断码。★monorepo 约束：正式单源在 `shared/error_codes.json`（generator 产双引擎
 * error_codes.ts + ErrorCode.java）。本仓 error_codes.ts 是 @generated 勿手改，故此处用
 * 本地常量；monorepo 上下文注册 W600 后应替换为 generated enum（ADR 0031 §3.1）。
 */
export const STABILITY_EXPERIMENTAL_CODE = 'W600' as const;

/** 机器可读特性标识（支持未来 per-feature policy；与 Java 侧逐字一致）。 */
export type StabilityFeatureId =
  | 'workflow'
  | 'version-import'
  | 'effect-capabilities'
  | 'pii'
  | 'deprecated-annotation';

export interface StabilityGateOptions {
  /**
   * 是否严格模式。★strict 不改 severity（恒 warning）——只置 data.blocking=true；
   * 调用方据「strict && 有 W600」决定拒绝（ADR §3.5）。
   */
  readonly strict: boolean;
  /** tenant/policy 显式放行 Experimental（进审计）。true 时 scan 返回 []。 */
  readonly allowExperimental?: boolean;
}

/** 稳定性诊断（W600）。severity 恒 warning；strict 语义走 data.blocking。 */
export interface StabilityDiagnostic {
  readonly severity: 'warning';
  readonly code: typeof STABILITY_EXPERIMENTAL_CODE;
  readonly message: string;
  readonly help: string;
  readonly span?: Span;
  readonly data: {
    readonly featureId: StabilityFeatureId;
    readonly moduleName: string | null;
    readonly strict: boolean;
    readonly blocking: boolean;
    readonly nodeKind?: string;
    readonly detail?: Record<string, unknown>;
  };
}

function originToSpan(origin: Origin | undefined | null): Span | undefined {
  if (!origin) return undefined;
  return { start: origin.start, end: origin.end };
}

function featureMessage(featureId: StabilityFeatureId): string {
  return `Experimental feature '${featureId}' is not part of the stable surface.`;
}

function featureHelp(strict: boolean): string {
  return strict
    ? 'Remove this feature or grant an experimental exception; strict stable mode rejects modules with W600 diagnostics.'
    : 'Grant experimental support to silence this warning, or avoid this feature for stable-surface compatibility.';
}

/** 遍历上下文：收集诊断 + 稳定序号（无 span 时保证「每触发节点一条」不被误合并）。 */
interface StabilityContext {
  readonly moduleName: string | null;
  readonly strict: boolean;
  readonly diagnostics: StabilityDiagnostic[];
  /** 已见去重 key（有 span 用位置，无 span 用递增序号——避免 Codex P2 的 nospan 误合并）。 */
  readonly seen: Set<string>;
  /** 递增序号，给无 span 节点唯一 key。 */
  seq: { n: number };
}

/**
 * StabilityGate visitor：扩展 DefaultCoreVisitor（显式 switch 遍历），在命中 Experimental
 * 节点处 emit W600，其余交 super 递归。
 */
class StabilityScanner extends DefaultCoreVisitor<StabilityContext> {
  private emit(
    ctx: StabilityContext,
    featureId: StabilityFeatureId,
    origin: Origin | undefined | null,
    nodeKind: string,
    detail?: Record<string, unknown>,
  ): void {
    const span = originToSpan(origin);
    // 去重 key：有 span 用位置（同一节点同特性只报一条）；无 span 用递增序号（不误合并）。
    const posKey = span
      ? `${span.start.line}:${span.start.col}-${span.end.line}:${span.end.col}`
      : `seq${ctx.seq.n++}`;
    const key = `${featureId}|${nodeKind}|${posKey}`;
    if (ctx.seen.has(key)) return;
    ctx.seen.add(key);

    ctx.diagnostics.push({
      severity: 'warning',
      code: STABILITY_EXPERIMENTAL_CODE,
      message: featureMessage(featureId),
      help: featureHelp(ctx.strict),
      ...(span ? { span } : {}),
      data: {
        featureId,
        moduleName: ctx.moduleName,
        strict: ctx.strict,
        blocking: ctx.strict,
        nodeKind,
        ...(detail ? { detail } : {}),
      },
    });
  }

  override visitDeclaration(d: Core.Declaration, ctx: StabilityContext): void {
    if (d.kind === 'Import') {
      // 2. version-import：Import.version 非空（钉版本才是 experimental）。
      const version = (d as { version?: number | null }).version;
      if (version !== null && version !== undefined) {
        this.emit(ctx, 'version-import', d.origin, 'Import', {
          import: d.name,
          version,
          asName: (d as { asName?: string | null }).asName ?? null,
        });
      }
    } else if (d.kind === 'Func') {
      // 3. effect-capabilities：effectCapsExplicit === true（裸 @io 是 false=Stable）。
      if ((d as { effectCapsExplicit?: boolean }).effectCapsExplicit === true) {
        this.emit(ctx, 'effect-capabilities', d.origin, 'Func', {
          func: d.name,
          effectCaps: (d as { effectCaps?: readonly string[] }).effectCaps ?? [],
        });
      }
      // 5. deprecated-annotation：annotation.name ∈ {example, deprecated}（大小写不敏感）。
      for (const anno of (d as { annotations?: readonly { name: string; origin?: Origin }[] }).annotations ?? []) {
        const lower = anno.name?.toLowerCase();
        if (lower === 'example' || lower === 'deprecated') {
          this.emit(ctx, 'deprecated-annotation', anno.origin ?? d.origin, 'Annotation', {
            func: d.name,
            annotationName: anno.name,
          });
        }
      }
    }
    // 交 super 递归 Data.fields/Func.params/ret 类型（触发 visitType）+ Func.body（触发语句/表达式）。
    super.visitDeclaration(d, ctx);

    // 4. PII 兜底：若某 Func **签名类型树**（params/ret，不含 body）无 PiiType，但 piiLevel
    //    非空 → 报一条（span 指函数）。用显式 containsPiiType 判签名（非 diagnostics 计数差，
    //    Codex 复审 P2：计数差会把 body 里 Lambda 的 PII 误算进签名，且不利 Java parity）。
    if (d.kind === 'Func') {
      const piiLevel = (d as { piiLevel?: string | null }).piiLevel;
      if (piiLevel !== null && piiLevel !== undefined && !funcSignatureHasPii(d)) {
        this.emit(ctx, 'pii', d.origin, 'Func', { func: d.name, piiLevel });
      }
    }
  }

  override visitStatement(s: Core.Statement, ctx: StabilityContext): void {
    // 1. Workflow：Start/Wait/workflow 语句。emit 后交 super 递归子节点（step body 里的 Await 等）。
    if (s.kind === 'Start' || s.kind === 'Wait' || s.kind === 'workflow') {
      this.emit(ctx, 'workflow', (s as { origin?: Origin }).origin, s.kind);
    }
    super.visitStatement(s, ctx);
  }

  override visitExpression(e: Core.Expression, ctx: StabilityContext): void {
    // 1. Workflow：Await 表达式。
    if (e.kind === 'Await') {
      this.emit(ctx, 'workflow', (e as { origin?: Origin }).origin, 'Await');
    }
    // ★Lambda 的参数/返回类型 base visitor 不 visitType（Codex P1 漏报）——显式补扫。
    // ret ?? retType：Core.Lambda 加了 ret，但 BaseLambda 标准字段是 retType（Java/外部
    // Core JSON 可能只保留 retType，Codex 复审 P2），两者都读兜底。
    if (e.kind === 'Lambda') {
      const lam = e as { params?: readonly { type?: Core.Type }[]; ret?: Core.Type; retType?: Core.Type };
      for (const p of lam.params ?? []) this.visitType(p.type as Core.Type, ctx);
      const lamRet = lam.ret ?? lam.retType;
      if (lamRet) this.visitType(lamRet, ctx);
    }
    super.visitExpression(e, ctx);
  }

  /**
   * 4. PII：类型树里的 PiiType。base visitor 的 visitType 只在 Data.fields/Func.params/ret
   * 处**调用**但不递归嵌套类型，故此处 emit + 手动递归子类型（List/Map/Result/TypeApp/
   * FuncType/PiiType.baseType），确保嵌套 PII 也被检出。
   */
  override visitType(t: Core.Type, ctx: StabilityContext): void {
    if (!t || typeof t !== 'object') return;
    if (t.kind === 'PiiType') {
      const pt = t as { origin?: Origin; sensitivity?: string; category?: string; baseType?: Core.Type };
      this.emit(ctx, 'pii', pt.origin, 'PiiType', {
        sensitivity: pt.sensitivity,
        category: pt.category,
      });
    }
    // 递归子类型（结构化字段名固定，Java 可复刻——非反射遍历任意 key）。
    for (const child of childTypes(t)) {
      this.visitType(child, ctx);
    }
  }
}

/** 类型树里是否含 PiiType（显式布尔，供 Func 签名 PII 兜底判定——非 diagnostics 计数差）。 */
function containsPiiType(type: Core.Type | undefined | null): boolean {
  if (!type || typeof type !== 'object') return false;
  if ((type as { kind?: string }).kind === 'PiiType') return true;
  return childTypes(type).some((c) => containsPiiType(c));
}

/** Func 签名（params + ret，不含 body）类型树是否含 PiiType。 */
function funcSignatureHasPii(func: Core.Func): boolean {
  const params = (func as { params?: readonly { type?: Core.Type }[] }).params ?? [];
  if (params.some((p) => containsPiiType(p.type))) return true;
  return containsPiiType((func as { ret?: Core.Type }).ret);
}

/** 取一个类型节点的直接子类型（Java 侧按同名字段复刻）。 */
function childTypes(t: Core.Type): Core.Type[] {
  const n = t as unknown as Record<string, unknown> & { kind: string };
  const out: Core.Type[] = [];
  const push = (v: unknown): void => {
    if (v && typeof v === 'object' && typeof (v as { kind?: unknown }).kind === 'string') {
      out.push(v as Core.Type);
    }
  };
  switch (n.kind) {
    case 'PiiType':
      push(n.baseType);
      break;
    case 'Maybe':
    case 'Option':
    case 'List':
      push(n.type);
      break;
    case 'Result':
      push(n.ok);
      push(n.err);
      break;
    case 'Map':
      // Core.Map 字段是 key/val（非 value，Codex 核实）。
      push(n.key);
      push(n.val);
      break;
    case 'TypeApp':
      for (const a of (n.args as unknown[]) ?? []) push(a);
      break;
    case 'FuncType':
      for (const p of (n.params as unknown[]) ?? []) push(p);
      push(n.ret);
      break;
    default:
      // TypeName / TypeVar / EffectVar 是叶子。
      break;
  }
  return out;
}

/**
 * 扫 Core Module 找 5 类 Experimental 特性。每个触发节点一条诊断。
 * 返回按 decls 顺序 + 每 decl 内 DFS 顺序（确定性，便于 parity 比对）。
 */
export function scan(coreModule: Core.Module, options: StabilityGateOptions): StabilityDiagnostic[] {
  if (options.allowExperimental === true) return [];
  const ctx: StabilityContext = {
    moduleName: coreModule.name ?? null,
    strict: options.strict,
    diagnostics: [],
    seen: new Set(),
    seq: { n: 0 },
  };
  new StabilityScanner().visitModule(coreModule, ctx);
  return ctx.diagnostics;
}

/** 便捷：strict surface 判断是否应拒绝（有 W600 且 strict）。 */
export function shouldRejectForStability(diagnostics: readonly StabilityDiagnostic[], strict: boolean): boolean {
  return strict && diagnostics.some((d) => d.code === STABILITY_EXPERIMENTAL_CODE);
}

export const StabilityGate = { scan, shouldRejectForStability };
