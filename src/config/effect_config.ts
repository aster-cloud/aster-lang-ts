/**
 * @module config/effect_config
 *
 * 效果推断配置模块：支持从配置文件加载自定义效果推断规则。
 *
 * **功能**：
 * - 定义可配置的效果推断模式
 * - 支持细粒度资源分类（io.http, io.sql, io.files 等）
 * - 提供默认配置保证向后兼容
 * - 支持环境变量 ASTER_EFFECT_CONFIG 自定义配置路径
 *
 * **设计原则**：
 * - 配置文件可选，默认行为与硬编码前缀一致
 * - 模块级缓存避免重复 I/O
 * - 配置加载失败时静默降级到默认配置
 */

import * as fs from 'node:fs';
import { ConfigService } from './config-service.js';

// ============================================================
// 配置接口定义
// ============================================================

/**
 * 效果推断配置接口。
 *
 * 定义了如何根据函数调用前缀推断效果类型。
 * 支持细粒度分类和自定义模式扩展。
 */
export interface EffectInferenceConfig {
  /**
   * 效果推断模式配置。
   *
   * 每个效果类型包含一组前缀模式，当函数调用匹配这些前缀时，
   * 推断为对应的效果。
   */
  patterns: {
    /**
     * IO 效果的细粒度分类。
     */
    io: {
      /** HTTP 网络请求前缀（如 'Http.', 'fetch.'） */
      http: string[];
      /** SQL 数据库操作前缀（如 'Db.', 'Sql.'） */
      sql: string[];
      /** 文件系统操作前缀（如 'Files.', 'Fs.'） */
      files: string[];
      /** 密钥/凭证访问前缀（如 'Secrets.', 'vault.'） */
      secrets: string[];
      /** 时间相关操作前缀（如 'Time.', 'Date.'） */
      time: string[];
    };
    /** CPU 密集型计算前缀（如 'Math.', 'crypto.hash'） */
    cpu: string[];
    /** AI 模型调用前缀（如 'AI.', 'OpenAI.'） */
    ai: string[];
  };
}

/**
 * 配置快照结构。
 *
 * 记录最近一次成功加载的配置内容与文件元数据，便于后续失效检测。
 */
export interface EffectConfigSnapshot {
  /** 最近一次加载的配置内容 */
  config: EffectInferenceConfig;
  /** 解析时使用的配置文件路径 */
  filePath: string;
  /** 文件最近修改时间（毫秒） */
  mtimeMs: number;
  /** 文件大小（字节） */
  size: number;
}

// ============================================================
// 默认配置
// ============================================================

/**
 * 默认效果推断配置。
 *
 * 包含当前所有硬编码前缀，确保向后兼容。
 * 前缀来源：src/config/semantic.ts 中的 IO_PREFIXES 和 CPU_PREFIXES。
 */
const DEFAULT_CONFIG: EffectInferenceConfig = {
  patterns: {
    io: {
      // HTTP 相关：Http. 和产品服务调用，以及通用 IO 前缀
      http: ['IO.', 'Http.', 'AuthRepo.', 'ProfileSvc.', 'FeedSvc.'],
      // SQL 相关：数据库操作
      sql: ['Db.'],
      // 文件相关：暂无默认前缀
      files: [],
      // 密钥相关：UUID 生成（随机性）
      secrets: ['UUID.randomUUID'],
      // 时间相关：暂无默认前缀
      time: [],
    },
    // CPU 相关：当前为空（完全依赖调用链传播）
    cpu: [],
    // AI 相关：暂无默认前缀
    ai: [],
  },
};

// ============================================================
// 配置加载器
// ============================================================

/**
 * 模块级配置缓存。
 *
 * 避免重复读取配置文件，提升性能。
 */
let cachedSnapshot: EffectConfigSnapshot | null = null;

/**
 * 重置配置缓存（仅用于测试）。
 *
 * **警告**：此方法仅应在测试环境中使用，生产代码不应调用。
 * 重置后，下次调用 loadEffectConfig() 会重新读取配置文件。
 */
export function resetConfigForTesting(): void {
  cachedSnapshot = null;
}

/**
 * 加载效果推断配置。
 *
 * 配置来源优先级：
 * 1. 环境变量 ASTER_EFFECT_CONFIG 指定的路径
 * 2. 默认路径 .aster/effects.json
 * 3. 配置文件不存在或解析失败时使用 DEFAULT_CONFIG
 *
 * @returns 效果推断配置对象
 *
 * @example
 * ```typescript
 * // 使用默认配置
 * const config = loadEffectConfig();
 *
 * // 使用自定义配置
 * process.env.ASTER_EFFECT_CONFIG = '/path/to/custom.json';
 * const customConfig = loadEffectConfig();
 * ```
 */
/**
 * 验证并清理数组字段，确保是字符串数组。
 *
 * @param value - 待验证的值
 * @param fallback - 验证失败时的默认值
 * @returns 清理后的字符串数组
 */
function validateStringArray(value: unknown, fallback: string[]): string[] {
  // 不是数组，使用默认值
  if (!Array.isArray(value)) {
    return fallback;
  }
  // 过滤非字符串元素
  const cleaned = value.filter((item): item is string => typeof item === 'string');
  // 如果所有元素都被过滤掉，使用默认值
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * 深度合并用户配置与默认配置。
 *
 * 确保所有必需字段都存在，避免访问 undefined 字段时抛错。
 * 同时验证数组字段类型，过滤非字符串元素。
 *
 * @param userConfig - 用户提供的配置
 * @returns 完整且经过验证的配置对象
 */
function mergeWithDefault(userConfig: Partial<EffectInferenceConfig>): EffectInferenceConfig {
  return {
    patterns: {
      io: {
        http: validateStringArray(
          userConfig.patterns?.io?.http,
          DEFAULT_CONFIG.patterns.io.http
        ),
        sql: validateStringArray(userConfig.patterns?.io?.sql, DEFAULT_CONFIG.patterns.io.sql),
        files: validateStringArray(
          userConfig.patterns?.io?.files,
          DEFAULT_CONFIG.patterns.io.files
        ),
        secrets: validateStringArray(
          userConfig.patterns?.io?.secrets,
          DEFAULT_CONFIG.patterns.io.secrets
        ),
        time: validateStringArray(
          userConfig.patterns?.io?.time,
          DEFAULT_CONFIG.patterns.io.time
        ),
      },
      cpu: validateStringArray(userConfig.patterns?.cpu, DEFAULT_CONFIG.patterns.cpu),
      ai: validateStringArray(userConfig.patterns?.ai, DEFAULT_CONFIG.patterns.ai),
    },
  };
}

/**
 * 判断是否需要重新加载配置文件。
 *
 * 基于缓存快照与当前文件状态进行双重校验。
 *
 * @param filePath - 当前配置文件路径
 * @returns 文件已变更时返回 true
 */
function shouldReload(filePath: string): boolean {
  if (!cachedSnapshot) {
    return true;
  }

  if (cachedSnapshot.filePath !== filePath) {
    return true;
  }

  try {
    const stat = fs.statSync(filePath);
    if (cachedSnapshot.mtimeMs === -1 && cachedSnapshot.size === -1) {
      return true;
    }
    if (cachedSnapshot.mtimeMs !== stat.mtimeMs) {
      return true;
    }
    if (cachedSnapshot.size !== stat.size) {
      return true;
    }
    return false;
  } catch {
    return !(cachedSnapshot.mtimeMs === -1 && cachedSnapshot.size === -1);
  }
}

export function loadEffectConfig(): EffectInferenceConfig {
  // 从 ConfigService 获取配置文件路径
  const configPath = ConfigService.getInstance().effectConfigPath;

  if (!shouldReload(configPath) && cachedSnapshot) {
    return cachedSnapshot.config;
  }

  try {
    const stat = fs.statSync(configPath);
    // 尝试读取配置文件（参考 src/lsp/server.ts:752-755 的模式）
    const content = fs.readFileSync(configPath, 'utf8');
    const userConfig = JSON.parse(content) as Partial<EffectInferenceConfig>;
    // 合并用户配置与默认配置，确保所有字段都存在
    const config = mergeWithDefault(userConfig);
    cachedSnapshot = {
      config,
      filePath: configPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
    return cachedSnapshot.config;
  } catch {
    // 配置文件不存在或解析失败，使用默认配置
    // 静默降级，不抛出错误（与现有模式一致）
    cachedSnapshot = {
      config: DEFAULT_CONFIG,
      filePath: configPath,
      mtimeMs: -1,
      size: -1,
    };
    return cachedSnapshot.config;
  }
}

/**
 * 重新加载效果配置缓存。
 *
 * @param force - 传入 true 时先清空缓存后再加载，确保读取最新文件
 * @returns 最新的效果推断配置
 */
export function reloadEffectConfig(force = false): EffectInferenceConfig {
  if (force) {
    cachedSnapshot = null;
  }
  return loadEffectConfig();
}

// ============================================================
// 向后兼容函数
// ============================================================

/**
 * 获取所有 IO 效果前缀（向后兼容）。
 *
 * 合并配置中所有 IO 子分类的前缀，返回统一数组。
 * 等价于原 IO_PREFIXES 常量的功能。
 *
 * @returns IO 前缀数组
 *
 * @example
 * ```typescript
 * const ioPrefixes = getIOPrefixes();
 * // ['Http.', 'AuthRepo.', 'ProfileSvc.', 'FeedSvc.', 'Db.', 'UUID.randomUUID']
 * ```
 */
export function getIOPrefixes(): readonly string[] {
  const config = loadEffectConfig();
  return [
    ...config.patterns.io.http,
    ...config.patterns.io.sql,
    ...config.patterns.io.files,
    ...config.patterns.io.secrets,
    ...config.patterns.io.time,
  ];
}

/**
 * 获取所有 CPU 效果前缀（向后兼容）。
 *
 * 等价于原 CPU_PREFIXES 常量的功能。
 *
 * @returns CPU 前缀数组
 *
 * @example
 * ```typescript
 * const cpuPrefixes = getCPUPrefixes();
 * // [] (当前默认为空)
 * ```
 */
export function getCPUPrefixes(): readonly string[] {
  const config = loadEffectConfig();
  return config.patterns.cpu;
}
