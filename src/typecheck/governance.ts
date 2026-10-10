/**
 * 治理检查（ADR 0039 §3/§4）：规则元数据注解与 Verdict 规则身份。
 * Java 镜像：aster-lang-core/.../typecheck/governance/GovernanceChecker.java，两侧判定必须逐条一致。
 *
 * 「规则返回 Verdict」口径：声明返回类型为 TypeName Verdict，
 * 或函数体任一 Return 表达式是 Verdict.* 的直接调用（不经由变量推断）。
 *
 * 注解参数约定：位置参数降级为 args: [{ name: '$0', value }]；
 * 治理注解只接受恰好一个非空白位置字符串参数，命名参数、非字符串、空白字符串一律 E702；
 * 同一规则出现多个 @id 也报 E702（@control 可重复）。
 *
 * 档案（ADR 0046 §4）：模块声明的档案不在注册表中报 E705（模块 origin），之后不再做档案检查；
 * 已知档案只约束返回 Verdict 的规则，违反要求报 E706（规则 span），同一规则同一要求只报一次。
 *
 * 本模块只依赖纯函数与 DiagnosticBuilder，Node / 浏览器两条类型检查路径共用。
 */
import type { Annotation, Core, Origin, TypecheckDiagnostic } from '../types.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import {
  defaultControlRegistry,
  isWellFormedControlKey,
  type ControlRegistry,
  type ProfileDef,
} from '../governance/controls.js';
import { DiagnosticBuilder } from './diagnostics.js';
import { originToSpan } from './pure.js';
import { VERDICT_TYPE_NAME, isVerdictCall } from './verdict_signatures.js';

const STRING_ARG_ANNOTATIONS: ReadonlySet<string> = new Set(['id', 'reason', 'control']);

function annotationsOf(func: Core.Func): readonly Annotation[] {
  return func.annotations ?? [];
}

/** 恰好一个位置参数 $0，且为非空白字符串。 */
function isSingleStringArg(annotation: Annotation): boolean {
  const args = annotation.args;
  if (!args || args.length !== 1) return false;
  const arg = args[0]!;
  return arg.name === '$0' && typeof arg.value === 'string' && arg.value.trim() !== '';
}

function stringArgOf(annotation: Annotation): string {
  return annotation.args![0]!.value as string;
}

function countIdAnnotations(func: Core.Func): number {
  return annotationsOf(func).filter((a) => a.name === 'id').length;
}

/**
 * 规则 @id：规则上恰好一个 @id 且其参数合法时返回其值；否则 undefined
 * （E702 另行报告，返回 Verdict 的规则因此同时报 W700，且不参与重复 id 判定）。
 */
export function ruleId(func: Core.Func): string | undefined {
  if (countIdAnnotations(func) !== 1) return undefined;
  const annotation = annotationsOf(func).find((a) => a.name === 'id' && isSingleStringArg(a));
  return annotation ? stringArgOf(annotation) : undefined;
}

/** 规则 @control 列表，按源码顺序；参数非法的条目跳过。 */
export function controls(func: Core.Func): string[] {
  return annotationsOf(func)
    .filter((a) => a.name === 'control' && isSingleStringArg(a))
    .map(stringArgOf);
}

function isVerdictCallExpr(expr: Core.Expression): boolean {
  return expr.kind === 'Call' && expr.target.kind === 'Name' && isVerdictCall(expr.target.name);
}

function anyReturnIsVerdictCall(stmt: Core.Statement | Core.Block | null | undefined): boolean {
  if (!stmt) return false;
  switch (stmt.kind) {
    case 'Return':
      return isVerdictCallExpr(stmt.expr);
    case 'Block':
    case 'Scope':
      return stmt.statements.some(anyReturnIsVerdictCall);
    case 'If':
      return anyReturnIsVerdictCall(stmt.thenBlock) || anyReturnIsVerdictCall(stmt.elseBlock);
    case 'Match':
      return stmt.cases.some((c) => anyReturnIsVerdictCall(c.body));
    default:
      return false;
  }
}

/** 规则是否返回 Verdict：声明返回类型为 Verdict，或任一 Return 直接调用 Verdict.*。 */
export function returnsVerdict(func: Core.Func): boolean {
  if (func.ret?.kind === 'TypeName' && func.ret.name === VERDICT_TYPE_NAME) return true;
  return anyReturnIsVerdictCall(func.body);
}

/** 形态由本模块自行把关（与 Java ControlRegistry.has 一致），注入的注册表无法放行非法键。 */
function isRegistered(key: string, registry: ControlRegistry): boolean {
  return isWellFormedControlKey(key) && registry.has(key);
}

/** 单条规则：E702 注解参数、多个 @id，记录 id 归属或报 W700，W704 未登记控制点，E706 档案要求。 */
function checkFunc(
  func: Core.Func,
  idOwners: Map<string, Core.Func[]>,
  b: DiagnosticBuilder,
  registry: ControlRegistry,
  profile: ProfileDef | undefined
): void {
  const span = originToSpan(func.origin);
  const rule = String(func.name);
  for (const a of annotationsOf(func)) {
    if (STRING_ARG_ANNOTATIONS.has(a.name) && !isSingleStringArg(a)) {
      b.error(ErrorCode.GOV_ANNOTATION_ARG_INVALID, span, { annotation: a.name, rule });
    }
  }
  if (countIdAnnotations(func) > 1) {
    b.error(ErrorCode.GOV_ANNOTATION_ARG_INVALID, span, { annotation: 'id', rule });
  }
  const id = ruleId(func);
  if (id !== undefined) {
    idOwners.set(id, [...(idOwners.get(id) ?? []), func]);
  } else if (returnsVerdict(func)) {
    b.warning(ErrorCode.GOV_VERDICT_RULE_MISSING_ID, span, { rule });
  }
  // ADR 0045：未登记或形态非法的控制键给 W704；同一规则同键只报一次，永不阻断。
  for (const key of new Set(controls(func))) {
    if (isRegistered(key, registry)) continue;
    b.warning(ErrorCode.GOV_CONTROL_UNREGISTERED, span, { control: key, rule, version: registry.version });
  }
  if (profile) checkProfile(func, profile, b, registry);
}

/** ADR 0046 §4：只对 Verdict 规则检查档案要求；同一规则同一要求只报一次。 */
function checkProfile(func: Core.Func, p: ProfileDef, b: DiagnosticBuilder, registry: ControlRegistry): void {
  if (!returnsVerdict(func)) return;
  const violation = (requirement: string): void => {
    b.error(ErrorCode.GOV_PROFILE_VIOLATION, originToSpan(func.origin), { rule: String(func.name), profile: p.id, requirement });
  };
  if (p.ruleId && ruleId(func) === undefined) violation('missing @id');
  const keys = [...new Set(controls(func))];
  if (p.registeredControls) {
    keys.filter((k) => !isRegistered(k, registry)).forEach((k) => violation(`unregistered control ${k}`));
  }
  if (p.frameworks.length > 0 && !keys.some((k) => coversFramework(k, p, registry))) {
    violation(`no registered control from framework ${p.frameworks.join(', ')}`);
  }
}

function coversFramework(key: string, p: ProfileDef, registry: ControlRegistry): boolean {
  const framework = registry.frameworkOf?.(key);
  return isRegistered(key, registry) && framework !== undefined && p.frameworks.includes(framework);
}

/** 声明了档案的模块按档案要求检查；未知档案报 E705 后不再做档案检查。 */
function resolveProfile(module: GovernanceModule, b: DiagnosticBuilder, registry: ControlRegistry): ProfileDef | undefined {
  if (module.profile === undefined) return undefined;
  const profile = registry.profile?.(module.profile);
  if (!profile) {
    b.error(ErrorCode.GOV_PROFILE_UNKNOWN, originToSpan(module.origin), {
      module: String(module.name),
      profile: module.profile,
      version: registry.version,
    });
  }
  return profile;
}

/** Verdict 为内置类型名，用户 Define 同名 Data / Enum 报 DUPLICATE_SYMBOL。 */
function checkReservedTypeName(decl: Core.Declaration, b: DiagnosticBuilder): void {
  if ((decl.kind === 'Data' || decl.kind === 'Enum') && decl.name === VERDICT_TYPE_NAME) {
    b.error(ErrorCode.DUPLICATE_SYMBOL, originToSpan(decl.origin), { name: VERDICT_TYPE_NAME });
  }
}

/** 治理检查所需的模块视图：Core.Module 满足此形状，测试可只给 decls。 */
export interface GovernanceModule {
  readonly name: string | null;
  readonly profile?: string;
  readonly decls: readonly Core.Declaration[];
  readonly origin?: Origin;
}

/**
 * 检查整个模块：E702 注解参数、W700 缺 @id、E701 模块内 @id 重复、W704 未登记控制点、
 * E705/E706 档案（ADR 0046）、Verdict 符号预占。
 * opts.controls 可注入控制注册表，缺省用内置副本（ADR 0045 §3）。
 */
export function checkGovernance(
  module: GovernanceModule,
  opts: { controls?: ControlRegistry } = {}
): TypecheckDiagnostic[] {
  const b = new DiagnosticBuilder();
  const registry = opts.controls ?? defaultControlRegistry;
  const profile = resolveProfile(module, b, registry);
  // @id → 拥有该 id 的规则（按声明顺序），用于发现重复
  const idOwners = new Map<string, Core.Func[]>();
  for (const decl of module.decls) {
    checkReservedTypeName(decl, b);
    if (decl.kind === 'Func') checkFunc(decl, idOwners, b, registry, profile);
  }
  for (const [id, funcs] of idOwners) {
    if (funcs.length < 2) continue;
    const rules = funcs.map((f) => String(f.name)).join(', ');
    b.error(ErrorCode.GOV_DUPLICATE_RULE_ID, originToSpan(funcs[0]!.origin), { id, rules });
  }
  return b.getDiagnostics();
}
