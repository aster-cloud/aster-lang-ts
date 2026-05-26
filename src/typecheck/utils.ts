import type { Core, Origin, Span } from '../types.js';
import { TypeSystem } from './type_system.js';

// 类型检查工具模块：收敛常量、类型辅助与路径规范化逻辑，供多个子模块复用。

export const UNKNOWN_TYPE: Core.Type = TypeSystem.unknown();
export const UNIT_TYPE: Core.Type = { kind: 'TypeName', name: 'Unit' };
export const IO_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'IO' };
export const CPU_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'CPU' };
export const PURE_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'PURE' };

// Default IO prefixes (matches DEFAULT_CONFIG in effect_config.ts)
const DEFAULT_IO_PREFIXES: readonly string[] = [
  'IO.',
  'Http.',
  'AuthRepo.',
  'ProfileSvc.',
  'FeedSvc.',
  'Db.',
  'UUID.randomUUID',
];

// Default CPU prefixes (matches DEFAULT_CONFIG in effect_config.ts)
const DEFAULT_CPU_PREFIXES: readonly string[] = [];

// Effect prefixes - try loading from config, fallback to defaults for browser compatibility
let _ioPrefixes: readonly string[] | null = null;
let _cpuPrefixes: readonly string[] | null = null;
let _prefixesLoaded = false;

function loadPrefixes(): void {
  if (_prefixesLoaded) return; // Already loaded
  _prefixesLoaded = true;
  try {
    // Use dynamic import with createRequire for proper ESM compatibility
    const { createRequire } = require('node:module') as { createRequire: (url: string) => NodeRequire };
    const require2 = createRequire(import.meta.url);
    const config = require2('../config/effect_config.js');
    _ioPrefixes = config.getIOPrefixes();
    _cpuPrefixes = config.getCPUPrefixes();
  } catch {
    // Fallback to defaults in browser environment
    _ioPrefixes = DEFAULT_IO_PREFIXES;
    _cpuPrefixes = DEFAULT_CPU_PREFIXES;
  }
}

/**
 * Get IO prefixes for effect inference.
 * Loads from config in Node.js, uses defaults in browser.
 */
export function getIOPrefixesCompat(): readonly string[] {
  loadPrefixes();
  return _ioPrefixes!;
}

/**
 * Get CPU prefixes for effect inference.
 * Loads from config in Node.js, uses defaults in browser.
 */
export function getCPUPrefixesCompat(): readonly string[] {
  loadPrefixes();
  return _cpuPrefixes!;
}

// Exported constants for backward compatibility - use getter functions for lazy loading
// Initialize immediately since many modules expect these as constants
loadPrefixes();
export const IO_PREFIXES: readonly string[] = _ioPrefixes!;
export const CPU_PREFIXES: readonly string[] = _cpuPrefixes!;

/**
 * 解析导入别名到真实模块前缀
 * @param name 原始名称（如 "H.get"）
 * @param imports 别名映射（如 {H: "Http"}）
 * @returns 解析后的名称（如 "Http.get"）
 */
export function resolveAlias(name: string, imports: ReadonlyMap<string, string>): string {
  if (!name.includes('.')) return name;
  const [prefix, ...rest] = name.split('.');
  const resolved = imports.get(prefix!);
  return resolved ? `${resolved}.${rest.join('.')}` : name;
}

/**
 * @deprecated Since ADR-0009 (P0-1): PII flow analysis is **always enabled**
 *   across all runtimes (Node / browser / CF Workers). This function exists
 *   only as a no-op stub for source-level backwards compatibility with code
 *   that still imports it from `aster-lang-ts/typecheck`.
 *
 *   The previous opt-in strategy (via globalThis.lspConfig / ENFORCE_PII /
 *   ASTER_ENFORCE_PII env vars) was a security hazard: the same policy
 *   shipped to IDE vs CI vs Workers reported **different** safety
 *   conclusions, breaking Aster's "PII as a first-class type" promise.
 *
 *   Will be removed in the next major release. Replace any consumer code
 *   that branches on this with the assumption that PII is always on.
 *
 * @returns always `true` (callers should not rely on this; rewrite the call
 *   site to drop the gating).
 */
export function shouldEnforcePii(): boolean {
  return true;
}

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

export function typesEqual(a: Core.Type | undefined | null, b: Core.Type | undefined | null, strict = false): boolean {
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
 * 判断实际类型是否可赋值给期望类型
 *
 * 比 typesEqual 更宽松，支持 CNL 自然语言编程中的隐式类型提升：
 * - Int → Float/Double（整数提升为浮点）
 * - Long → Double（长整型提升为双精度）
 * - Float ↔ Double（浮点类型互通）
 *
 * 设计理由：
 * 1. 字段类型推断可能推断为 Float，但字面量是 Int
 * 2. 用户写 `rate = 350` 比 `rate = 350.0` 更自然
 * 3. 不影响严格类型比较（分支/匹配/泛型等场景仍用 typesEqual）
 *
 * @param expected 期望的类型（字段声明类型）
 * @param actual 实际的类型（赋值表达式类型）
 * @param strict 是否启用严格模式（禁用隐式提升）
 * @returns true 表示可赋值
 */
export function isAssignable(
  expected: Core.Type | undefined | null,
  actual: Core.Type | undefined | null,
  strict = false
): boolean {
  // 首先检查严格相等
  if (typesEqual(expected, actual, strict)) {
    return true;
  }

  // 严格模式下不做隐式提升
  if (strict) {
    return false;
  }

  const expectedType = normalizeType(expected);
  const actualType = normalizeType(actual);

  // 仅处理基础类型名的隐式提升
  if (expectedType.kind !== 'TypeName' || actualType.kind !== 'TypeName') {
    return false;
  }

  const expectedName = expectedType.name;
  const actualName = actualType.name;

  // 数值类型提升规则（仅允许安全的向上提升）
  // 规则设计：
  // - Float 和 Double 视为等价（CNL 不区分精度）
  // - Int 可提升为任意浮点类型
  // - Long 可提升为 Double
  switch (expectedName) {
    case 'Float':
      // Int → Float, Double → Float（Float/Double 等价）
      return actualName === 'Int' || actualName === 'Double';
    case 'Double':
      // Int/Long/Float → Double
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
 * Get default module search paths.
 * Uses dynamic import to avoid Node.js dependency at module load time.
 */
export function defaultModuleSearchPaths(): string[] {
  try {
    const path = require('node:path') as typeof import('node:path');
    const cwd = process.cwd();
    return [cwd, path.join(cwd, '.aster', 'packages')];
  } catch {
    // In browser environment, return empty array
    return [];
  }
}

/**
 * Normalize module search paths.
 * Uses dynamic import to avoid Node.js dependency at module load time.
 */
export function normalizeModuleSearchPaths(paths?: readonly string[]): readonly string[] {
  const source = paths && paths.length > 0 ? paths : defaultModuleSearchPaths();
  const normalized = new Set<string>();

  try {
    const path = require('node:path') as typeof import('node:path');
    for (const candidate of source) {
      if (!candidate) continue;
      normalized.add(path.resolve(candidate));
    }
  } catch {
    // In browser environment, use paths as-is
    for (const candidate of source) {
      if (!candidate) continue;
      normalized.add(candidate);
    }
  }

  return [...normalized];
}
