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

import type { Core, Origin, Span } from '../types.js';
import { TypeSystem } from './type_system.js';

// Re-export resolveAlias 从 alias.ts (纯 leaf) — 让 pure.ts 成为单一 browser-safe
// import 来源, 调用方不必同时 import pure + alias.
export { resolveAlias } from './alias.js';

export const UNKNOWN_TYPE: Core.Type = TypeSystem.unknown();
export const UNIT_TYPE: Core.Type = { kind: 'TypeName', name: 'Unit' };
export const IO_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'IO' };
export const CPU_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'CPU' };
export const PURE_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'PURE' };

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

export function isUnknown(type: Core.Type | undefined | null): boolean {
  if (!type) return true;
  return type.kind === 'TypeName' && type.name === 'Unknown';
}

export function unknownType(): Core.Type {
  return UNKNOWN_TYPE;
}

export function normalizeType(type: Core.Type | undefined | null): Core.Type {
  return type ?? UNKNOWN_TYPE;
}

export function buildFieldTypeMap(decls: readonly Core.Declaration[]): Map<string, Core.Type> {
  const fieldTypes = new Map<string, Core.Type>();
  const conflicts = new Set<string>();
  for (const decl of decls) {
    if (decl.kind !== 'Data') continue;
    for (const field of decl.fields) {
      const normalized = normalizeType(field.type as Core.Type);
      const existing = fieldTypes.get(field.name);
      if (!existing) fieldTypes.set(field.name, normalized);
      if (existing && !TypeSystem.equals(existing, normalized, true)) conflicts.add(field.name);
    }
  }
  for (const name of conflicts) fieldTypes.delete(name);
  return fieldTypes;
}

export function formatType(type: Core.Type | undefined | null): string {
  return TypeSystem.format(normalizeType(type));
}

export function isWorkflowType(type: Core.Type): type is Core.TypeApp {
  return type.kind === 'TypeApp' && type.base === 'Workflow' && type.args.length >= 1;
}

export function unwrapWorkflowResult(type: Core.Type): Core.Type {
  if (isWorkflowType(type)) {
    return normalizeType(type.args[0] as Core.Type);
  }
  return type;
}

export function typesEqual(
  a: Core.Type | undefined | null,
  b: Core.Type | undefined | null,
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
  expected: Core.Type | undefined | null,
  actual: Core.Type | undefined | null,
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
