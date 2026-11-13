/**
 * Pure type-system helpers — **browser-safe leaf module**.
 *
 * R15 (codex round 14/15 review): split from `typecheck/utils.ts` because
 * utils.ts carries `loadPrefixes()` at module-load that statically references
 * `require('node:module')`. Webpack/strict bundlers see that reference even
 * if wrapped in try/catch, so any browser-reachable file that imports from
 * utils.ts pulls Node built-ins into the bundle closure.
 *
 * This module contains **only** pure constants and pure functions over Core
 * types — no Node API surface, no IO/CPU prefix loading, no path resolution.
 *
 * Callers:
 *   - `typecheck/browser.ts` (browser entry)
 *   - `typecheck-pii.ts` (via alias.ts; cross-runtime PII flow)
 *   - any future browser/edge-bound module
 *
 * For Node-only callers (`typecheck.ts`, `lsp/*`, `ai/validator.ts`),
 * `typecheck/utils.ts` re-exports the same symbols + the prefix loaders.
 */

import type { Core, Origin, Span, TypecheckDiagnostic, Ty } from '../types.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { TypeSystem } from './type_system.js';

// Re-export resolveAlias 从 alias.ts (纯 leaf) — 让 pure.ts 成为单一 browser-safe
// import 来源, 调用方不必同时 import pure + alias.
export { resolveAlias } from './alias.js';

export const UNKNOWN_TYPE: Ty.Type = TypeSystem.unknown();
export const UNIT_TYPE: Ty.Type = { kind: 'TypeName', name: 'Unit' };
export const IO_EFFECT_TYPE: Ty.Type = { kind: 'TypeName', name: 'IO' };
export const CPU_EFFECT_TYPE: Ty.Type = { kind: 'TypeName', name: 'CPU' };
export const PURE_EFFECT_TYPE: Ty.Type = { kind: 'TypeName', name: 'PURE' };

/**
 * 默认 IO 前缀 (browser-safe, 无 config loading).
 * Node-only 调用方应通过 `typecheck/utils.ts` 的 `getIOPrefixesCompat()` 读 config.
 * 同 effect_config.ts DEFAULT_CONFIG, 复制以避免 transitive Node 依赖.
 */
export const IO_PREFIXES: readonly string[] = [
  'IO.',
  'Http.',
  'AuthRepo.',
  'ProfileSvc.',
  'FeedSvc.',
  'Db.',
  'UUID.randomUUID',
];

/** 默认 CPU 前缀 (browser-safe). */
export const CPU_PREFIXES: readonly string[] = [];

export function isUnknown(type: Ty.Type | undefined | null): boolean {
  if (!type) return true;
  return type.kind === 'TypeName' && type.name === 'Unknown';
}

export function unknownType(): Ty.Type {
  return UNKNOWN_TYPE;
}

export function normalizeType(type: Ty.Type | undefined | null): Ty.Type {
  return type ?? UNKNOWN_TYPE;
}

/**
 * 规则签名中的形参类型：未写类型的形参（解析器按名字推断，`typeInferred`）登记为 Unknown。
 * 推断类型只是按名字猜的，调用方传入的实参不以它为准（#266）；函数体内仍按推断类型检查形参的使用。
 * Java 目前仍按推断类型比较并拒绝这类调用，TS 放行（向 TS 对齐见 aster-lang-core#229）。
 */
export function signatureParamTypes(params: readonly Core.Parameter[]): Ty.Type[] {
  return params.map(param => (param.typeInferred ? UNKNOWN_TYPE : normalizeType(param.type as Ty.Type)));
}

export function buildFieldTypeMap(decls: readonly Core.Declaration[]): Map<string, Ty.Type> {
  const fieldTypes = new Map<string, Ty.Type>();
  const conflicts = new Set<string>();
  for (const decl of decls) {
    if (decl.kind !== 'Data') continue;
    for (const field of decl.fields) {
      const normalized = normalizeType(field.type as Ty.Type);
      const existing = fieldTypes.get(field.name);
      if (!existing) fieldTypes.set(field.name, normalized);
      if (existing && !TypeSystem.equals(existing, normalized, true)) conflicts.add(field.name);
    }
  }
  for (const name of conflicts) fieldTypes.delete(name);
  return fieldTypes;
}

export function checkEntryRuleUniqueness(decls: readonly Core.Declaration[]): TypecheckDiagnostic[] {
  const entryFuncs = decls.filter(
    (decl): decl is Core.Func =>
      decl.kind === 'Func' && (decl.annotations ?? []).some(annotation => annotation.name === 'entry')
  );
  if (entryFuncs.length <= 1) return [];

  // 与 Java TypeChecker.checkEntryRuleUniqueness 对齐：穷尽列出全部冲突规则名
  // （逗号拼接），而非仅报前两条；诊断锚点取首个 @entry 规则的 origin。
  const ruleNames = entryFuncs
    .map(func => func.name)
    .filter((name): name is string => typeof name === 'string');
  const diagnostic: TypecheckDiagnostic = {
    severity: 'error',
    code: ErrorCode.MULTIPLE_ENTRY_RULES,
    message: `Multiple @entry rules in module: ${ruleNames.join(', ')}`,
    help: 'Keep at most one Rule annotated with @entry in a module.',
    data: { rules: ruleNames.join(', ') },
  };
  const anchor = entryFuncs[0]!.origin;
  if (anchor) diagnostic.origin = anchor;
  return [diagnostic];
}

export function formatType(type: Ty.Type | undefined | null): string {
  return TypeSystem.format(normalizeType(type));
}

export function isWorkflowType(type: Ty.Type): type is Ty.TypeApp {
  return type.kind === 'TypeApp' && type.base === 'Workflow' && type.args.length >= 1;
}

export function unwrapWorkflowResult(type: Ty.Type): Ty.Type {
  if (isWorkflowType(type)) {
    return normalizeType(type.args[0] as Ty.Type);
  }
  return type;
}

export function typesEqual(
  a: Ty.Type | undefined | null,
  b: Ty.Type | undefined | null,
  strict = false,
): boolean {
  const left = normalizeType(a);
  const right = normalizeType(b);

  if (isWorkflowType(left) && !isWorkflowType(right)) {
    return typesEqual(unwrapWorkflowResult(left), right, strict);
  }
  if (!isWorkflowType(left) && isWorkflowType(right)) {
    return typesEqual(left, unwrapWorkflowResult(right), strict);
  }

  return TypeSystem.equals(left, right, strict);
}

/**
 * 判断实际类型是否可赋值给期望类型.
 *
 * 比 typesEqual 更宽松, 支持 CNL 自然语言编程中的隐式类型提升:
 * - Int → Float/Double（整数提升为浮点）
 * - Long → Double（长整型提升为双精度）
 * - Float ↔ Double（浮点类型互通）
 *
 * 设计理由:
 * 1. 字段类型推断可能推断为 Float，但字面量是 Int
 * 2. 用户写 `rate = 350` 比 `rate = 350.0` 更自然
 * 3. 不影响严格类型比较（分支/匹配/泛型等场景仍用 typesEqual）
 */
export function isAssignable(
  expected: Ty.Type | undefined | null,
  actual: Ty.Type | undefined | null,
  strict = false,
): boolean {
  if (typesEqual(expected, actual, strict)) return true;
  if (strict) return false;

  const expectedType = normalizeType(expected);
  const actualType = normalizeType(actual);

  if (expectedType.kind !== 'TypeName' || actualType.kind !== 'TypeName') {
    return false;
  }

  const expectedName = expectedType.name;
  const actualName = actualType.name;

  switch (expectedName) {
    case 'Float':
      return actualName === 'Int' || actualName === 'Double';
    case 'Double':
      return actualName === 'Int' || actualName === 'Long' || actualName === 'Float';
    default:
      return false;
  }
}

/**
 * 只按名字推断出的类型实例（未写类型的形参 / lambda 形参，及经 Let 传递的同一实例），按对象身份登记。
 * 与 Java BaseTypeChecker.uncheckedForCalls 同一做法：实例随 Let、Set、Some(...)、规则返回值原样传播，
 * argumentFits 遇到登记的实例（任一侧、任一层）即放行（aster-lang-core#232）。WeakSet 不阻止 GC，也不进 IR。
 */
const NAME_INFERRED_TYPES = new WeakSet<object>();

/** 登记一个只按名字推断出的类型实例（共享的 Unknown 单例无需登记）。 */
export function markNameInferredType(type: Ty.Type): void {
  if (type !== UNKNOWN_TYPE) NAME_INFERRED_TYPES.add(type);
}

/** 是否为只按名字推断出的类型实例（markNameInferredType 登记过），这类类型按未知处理。 */
export function isNameInferredType(type: Ty.Type): boolean {
  return NAME_INFERRED_TYPES.has(type);
}

/**
 * 数值拓宽：整数可传给小数 / 更宽的整数形参（用户裁决，Java 侧对齐见 aster-lang-core#229）。
 * Float 在类型检查中规范化为 Double，两者同列。
 */
const NUMERIC_WIDENING: Readonly<Record<string, readonly string[]>> = {
  Int: ['Long', 'Float', 'Double', 'Decimal'],
  Long: ['Float', 'Double', 'Decimal'],
  Float: ['Double'],
  Double: ['Float'],
};

/**
 * 值能否放进期望类型的位置（规则调用实参 E001、字段构造 E012、Set E002、Return E003 共用），按结构逐层比较；拿不准时放行。
 * 原则：能正常运行的程序不新增类型错误，TS 不比 Java 严（aster-lang-core#231 与此同一套规则）。
 * - 任一侧为 Unknown、只按名字推断出的类型实例（markNameInferredType）、或含类型变量（泛型规则、推断失败的返回类型占位 TypeVar 'Unknown'）：放行；
 * - PII 包装先剥掉；Maybe 与 Option 视为同一种类，T 可传给 T?（None 的类型为 Option of Unknown）；
 * - List / Map / Result / TypeApp 逐个比较元素类型；函数类型参数位逆变、不比较效应；
 * - 类型名：相等（含 TS 既有的 DateTime ≈ Text 宽松）或按 NUMERIC_WIDENING 拓宽。
 */
export function argumentFits(param: Ty.Type, arg: Ty.Type): boolean {
  if (NAME_INFERRED_TYPES.has(param) || NAME_INFERRED_TYPES.has(arg)) return true;
  const p = unwrapPii(param);
  const a = unwrapPii(arg);
  if (isUnknown(p) || isUnknown(a) || containsTypeVar(p) || containsTypeVar(a)) return true;
  if (isOptional(p)) return argumentFits(p.type as Ty.Type, isOptional(a) ? (a.type as Ty.Type) : a);
  if (p.kind === 'List' && a.kind === 'List') return argumentFits(p.type as Ty.Type, a.type as Ty.Type);
  if (p.kind === 'Map' && a.kind === 'Map') {
    return argumentFits(p.key as Ty.Type, a.key as Ty.Type) && argumentFits(p.val as Ty.Type, a.val as Ty.Type);
  }
  if (p.kind === 'Result' && a.kind === 'Result') {
    return argumentFits(p.ok as Ty.Type, a.ok as Ty.Type) && argumentFits(p.err as Ty.Type, a.err as Ty.Type);
  }
  if (p.kind === 'TypeApp' && a.kind === 'TypeApp') {
    return p.base === a.base && p.args.length === a.args.length &&
      p.args.every((t, i) => argumentFits(t as Ty.Type, a.args[i] as Ty.Type));
  }
  if (p.kind === 'FuncType' && a.kind === 'FuncType') {
    return p.params.length === a.params.length &&
      // 形参位逆变：期望 (Int) -> X 时可以传 (Float) -> X
      p.params.every((t, i) => argumentFits(a.params[i] as Ty.Type, t as Ty.Type)) &&
      argumentFits(p.ret as Ty.Type, a.ret as Ty.Type);
  }
  if (p.kind === 'TypeName' && a.kind === 'TypeName' && NUMERIC_WIDENING[a.name]?.includes(p.name)) return true;
  return typesEqual(p, a);
}

function isOptional(type: Ty.Type): type is Ty.Maybe | Ty.Option {
  return type.kind === 'Maybe' || type.kind === 'Option';
}

function unwrapPii(type: Ty.Type): Ty.Type {
  return type.kind === 'PiiType' ? unwrapPii(type.baseType as Ty.Type) : type;
}

function containsTypeVar(type: Ty.Type): boolean {
  switch (type.kind) {
    case 'TypeVar':
      return true;
    case 'TypeApp':
      return type.args.some(t => containsTypeVar(t as Ty.Type));
    case 'FuncType':
      return type.params.some(t => containsTypeVar(t as Ty.Type)) || containsTypeVar(type.ret as Ty.Type);
    case 'Result':
      return containsTypeVar(type.ok as Ty.Type) || containsTypeVar(type.err as Ty.Type);
    case 'Maybe':
    case 'Option':
    case 'List':
      return containsTypeVar(type.type as Ty.Type);
    case 'Map':
      return containsTypeVar(type.key as Ty.Type) || containsTypeVar(type.val as Ty.Type);
    case 'PiiType':
      return containsTypeVar(type.baseType as Ty.Type);
    default:
      return false;
  }
}

export function originToSpan(origin: Origin | undefined): Span | undefined {
  if (!origin) return undefined;
  return { start: origin.start, end: origin.end };
}

/**
 * @deprecated Since ADR-0009 (P0-1): PII flow analysis is **always enabled**
 *   across all runtimes (Node / browser / CF Workers). Stub kept for source
 *   compat; will be removed in next major.
 */
export function shouldEnforcePii(): boolean {
  return true;
}
