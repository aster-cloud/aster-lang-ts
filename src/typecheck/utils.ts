import { join, resolve } from 'node:path';
import type { Core, Origin, Span } from '../types.js';
import { getIOPrefixes, getCPUPrefixes } from '../config/effect_config.js';
import { TypeSystem } from './type_system.js';

// 类型检查工具模块：收敛常量、类型辅助与路径规范化逻辑，供多个子模块复用。

export const UNKNOWN_TYPE: Core.Type = TypeSystem.unknown();
export const UNIT_TYPE: Core.Type = { kind: 'TypeName', name: 'Unit' };
export const IO_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'IO' };
export const CPU_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'CPU' };
export const PURE_EFFECT_TYPE: Core.Type = { kind: 'TypeName', name: 'PURE' };

// 从配置获取效果推断前缀（模块级，避免重复调用）
export const IO_PREFIXES = getIOPrefixes();
export const CPU_PREFIXES = getCPUPrefixes();

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
 * 判断是否启用 PII 检查
 *
 * 采用渐进式启用策略，默认禁用 PII 检查，需显式启用。
 * 配置优先级（从高到低）：
 * 1. LSP 配置注入（globalThis.lspConfig.enforcePiiChecks）
 * 2. 环境变量（ENFORCE_PII 或 ASTER_ENFORCE_PII，大小写不敏感）
 * 3. 默认值 false（opt-in 策略）
 *
 * 设计理由：
 * 1. 兼容性：避免破坏现有项目，给团队时间逐步迁移
 * 2. 渐进式：允许团队按自己的节奏采纳 PII 检查
 * 3. 明确性：需要显式声明启用，避免意外启用
 * 4. 统一性：与 Java 编译器的 shouldEnforcePii() 保持一致（大小写无关匹配）
 * 5. 解耦性：通过 globalThis 注入避免 LSP 与 typecheck 模块循环依赖
 *
 * @returns true 表示启用 PII 检查，false 表示禁用
 */
export function shouldEnforcePii(): boolean {
  // 优先级 1: LSP 配置注入（IDE 会话通过 --enforce-pii 参数启用）
  if (globalThis.lspConfig?.enforcePiiChecks !== undefined) {
    return globalThis.lspConfig.enforcePiiChecks;
  }

  // 优先级 2: 环境变量（向后兼容 CLI 工具和测试，大小写无关匹配）
  const envValue = process.env.ENFORCE_PII || process.env.ASTER_ENFORCE_PII;
  if (envValue?.toLowerCase() === 'true') {
    return true;
  }

  // 优先级 3: 默认禁用 PII 检查（渐进式启用策略）
  return false;
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

export function originToSpan(origin: Origin | undefined): Span | undefined {
  if (!origin) return undefined;
  return { start: origin.start, end: origin.end };
}

export function defaultModuleSearchPaths(): string[] {
  const cwd = process.cwd();
  return [cwd, join(cwd, '.aster', 'packages')];
}

export function normalizeModuleSearchPaths(paths?: readonly string[]): readonly string[] {
  const source = paths && paths.length > 0 ? paths : defaultModuleSearchPaths();
  const normalized = new Set<string>();
  for (const candidate of source) {
    if (!candidate) continue;
    normalized.add(resolve(candidate));
  }
  return [...normalized];
}
