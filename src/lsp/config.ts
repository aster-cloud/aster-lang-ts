/**
 * LSP 配置模块（Phase 0 Task 4.1）
 *
 * 从命令行参数读取配置选项，包括：
 * - --strict-pii: 将 PII 泄漏从 Warning 升级为 Error，阻止编译
 * - --enforce-pii: 启用类型层 PII 检查，执行完整的隐私数据流分析
 */

export interface LspConfig {
  /**
   * 严格 PII 模式
   *
   * 当启用时，PII 数据泄漏诊断从 Warning 升级为 Error，阻止编译。
   * 默认值：false（向后兼容，仅警告）
   */
  strictPiiMode: boolean;

  /**
   * 启用 PII 类型检查
   *
   * 当启用时，类型检查器会执行完整的 PII 流分析，检测隐私数据泄漏。
   * 默认值：false（opt-in 策略，需显式启用）
   */
  enforcePiiChecks: boolean;
}

/**
 * 全局配置实例
 *
 * 从 process.argv 读取命令行参数
 */
export const config: LspConfig = {
  strictPiiMode: process.argv.includes('--strict-pii'),
  enforcePiiChecks: process.argv.includes('--enforce-pii'),
};

/**
 * 重置配置（用于测试）
 */
export function resetConfig(newConfig: Partial<LspConfig>): void {
  Object.assign(config, newConfig);
}
