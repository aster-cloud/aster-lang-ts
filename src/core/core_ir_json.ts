import type { Core } from '../types.js';

/**
 * Core IR JSON 序列化封装（版本化）
 *
 * 提供 Core IR 模块的 JSON 序列化和反序列化功能，
 * 支持版本控制和元数据。
 */

/**
 * Core IR JSON 封装接口
 * 包含版本信息和可选元数据
 */
export interface CoreIREnvelope {
  /** JSON schema 版本 */
  version: '1.0';
  /** Core IR 模块定义 */
  module: Core.Module;
  /** 可选元数据 */
  metadata?: {
    /** 生成时间（ISO 8601 格式） */
    generatedAt?: string;
    /** 源文件路径或描述 */
    source?: string;
    /** 编译器版本 */
    compilerVersion?: string;
  };
}

/**
 * 将 Core IR 模块序列化为 JSON 字符串
 *
 * @param module - Core IR 模块对象
 * @param metadata - 可选元数据
 * @returns 格式化的 JSON 字符串（2 空格缩进）
 *
 * @example
 * ```typescript
 * const coreIR = lowerToCore(ast);
 * const json = serializeCoreIR(coreIR, { source: 'policy.aster' });
 * ```
 */
export function serializeCoreIR(
  module: Core.Module,
  metadata?: CoreIREnvelope['metadata']
): string {
  const envelope: CoreIREnvelope = {
    version: '1.0',
    module,
    ...(metadata ? { metadata } : {}),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * 从 JSON 字符串反序列化为 Core IR 模块
 *
 * @param json - JSON 字符串
 * @returns Core IR 模块对象
 * @throws {Error} 如果 JSON 无效或版本不支持
 *
 * @example
 * ```typescript
 * const json = fs.readFileSync('policy.json', 'utf8');
 * const coreIR = deserializeCoreIR(json);
 * ```
 */
export function deserializeCoreIR(json: string): Core.Module {
  let envelope: unknown;

  try {
    envelope = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 类型检查：确保是对象（非数组）
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Invalid Core IR JSON: expected object');
  }

  const typed = envelope as Record<string, unknown>;

  // 版本检查
  if (!('version' in typed) || typed.version !== '1.0') {
    throw new Error(
      `Unsupported Core IR JSON version: ${typed.version ?? 'missing'}. Expected: 1.0`
    );
  }

  // 模块字段检查
  if (!('module' in typed) || !typed.module || typeof typed.module !== 'object') {
    throw new Error('Invalid Core IR JSON: missing or invalid "module" field');
  }

  // 基本结构验证：检查 module 是否有 kind 和 decls 字段
  const module = typed.module as Record<string, unknown>;
  if (module.kind !== 'Module') {
    throw new Error(`Invalid Core IR JSON: expected module.kind === 'Module', got ${module.kind}`);
  }

  if (!Array.isArray(module.decls)) {
    throw new Error('Invalid Core IR JSON: module.decls must be an array');
  }

  return typed.module as Core.Module;
}

/**
 * 验证 JSON 字符串是否为有效的 Core IR 格式
 *
 * @param json - JSON 字符串
 * @returns true 如果有效，false 否则
 */
export function isValidCoreIRJson(json: string): boolean {
  try {
    deserializeCoreIR(json);
    return true;
  } catch {
    return false;
  }
}
