/**
 * @module config-service
 *
 * 统一配置管理服务：集中管理所有环境变量配置。
 *
 * **设计目标**：
 * - 单一数据源：所有配置从 ConfigService 获取，避免散落的 process.env 访问
 * - 类型安全：提供强类型配置接口，在启动时校验配置有效性
 * - 可测试性：支持测试环境下重置配置
 * - 延迟初始化：使用单例模式，首次访问时初始化
 *
 * **使用方式**：
 * ```typescript
 * import { ConfigService } from './config/config-service.js';
 *
 * const config = ConfigService.getInstance();
 * if (config.effectsEnforce) {
 *   // 效果系统强制执行逻辑
 * }
 * ```
 */

import { LogLevel } from '../utils/logger.js';

/**
 * 配置服务单例类。
 *
 * 在首次调用 getInstance() 时初始化，从环境变量读取所有配置。
 * 配置项在实例生命周期内保持不变（只读）。
 */
export class ConfigService {
  private static instance: ConfigService | null = null;

  /** 是否强制执行效果能力检查（默认 true，设置 ASTER_CAP_EFFECTS_ENFORCE=0 可禁用） */
  readonly effectsEnforce: boolean;

  /** 效果配置文件路径（默认 .aster/effects.json） */
  readonly effectConfigPath: string;

  /** 缓存实例初始化时使用的效果配置路径，便于检测环境变量变更 */
  readonly cachedEffectConfigPath: string;

  /** 日志级别（默认 INFO） */
  readonly logLevel: LogLevel;

  /** 能力清单文件路径（可选，用于 LSP 诊断） */
  readonly capsManifestPath: string | null;

  /** 是否启用调试类型输出（默认 false，设置 ASTER_DEBUG_TYPES=1 启用） */
  readonly debugTypes: boolean;

  /**
   * 私有构造函数，确保只能通过 getInstance() 创建实例。
   */
  private constructor() {
    // 读取环境变量并设置默认值
    this.effectsEnforce = process.env.ASTER_CAP_EFFECTS_ENFORCE !== '0';
    this.effectConfigPath = process.env.ASTER_EFFECT_CONFIG || '.aster/effects.json';
    this.cachedEffectConfigPath = this.effectConfigPath;
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL);
    this.capsManifestPath = process.env.ASTER_CAPS || null;
    this.debugTypes = process.env.ASTER_DEBUG_TYPES === '1';

    // 启动时校验配置有效性
    this.validate();
  }

  /**
   * 解析 LOG_LEVEL 环境变量为 LogLevel 枚举值。
   *
   * @param raw - 原始环境变量值
   * @returns 解析后的 LogLevel，默认 INFO
   */
  private parseLogLevel(raw: string | undefined): LogLevel {
    if (!raw) return LogLevel.INFO;
    const upper = raw.toUpperCase();
    return upper in LogLevel
      ? (LogLevel[upper as keyof typeof LogLevel] as LogLevel)
      : LogLevel.INFO;
  }

  /**
   * 校验配置的有效性。
   *
   * 当前实现为占位符，未来可添加更多校验逻辑：
   * - 检查文件路径是否可访问
   * - 验证配置值的取值范围
   * - 检查依赖配置的一致性
   */
  private validate(): void {
    // 占位符：未来可添加配置校验逻辑
    // 例如：检查 effectConfigPath 文件是否存在
    // 例如：验证 capsManifestPath 格式是否正确
  }

  /**
   * 获取 ConfigService 单例实例。
   *
   * 首次调用时创建实例，后续调用返回同一实例。
   *
   * @returns ConfigService 实例
   */
  static getInstance(): ConfigService {
    const currentEffectConfigPath = process.env.ASTER_EFFECT_CONFIG || '.aster/effects.json';
    if (
      ConfigService.instance !== null &&
      ConfigService.instance.cachedEffectConfigPath !== currentEffectConfigPath
    ) {
      ConfigService.instance = null;
    }

    if (ConfigService.instance === null) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * 重置单例实例（仅用于测试）。
   *
   * **警告**：此方法仅应在测试环境中使用，生产代码不应调用。
   * 重置后，下次调用 getInstance() 会重新读取环境变量。
   */
  static resetForTesting(): void {
    ConfigService.instance = null;
  }
}
