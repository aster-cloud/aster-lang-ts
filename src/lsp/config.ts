/**
 * LSP 配置模块
 *
 * 从命令行参数读取配置选项。
 *
 * **ADR-0009 P0-1 之后**：`--enforce-pii` 和 `enforcePiiChecks` 字段已**无效**
 * （PII 检查永远启用）。保留这些字段是为了向后兼容，避免老脚本传参时报错；
 * 启动时会写入 deprecation 警告日志。
 *
 * 当前仍生效的选项：
 * - `--strict-pii`: 将 PII 泄漏从 Warning 升级为 Error，阻止编译
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
   * @deprecated ADR-0009 P0-1 起 PII 检查永远启用，此字段不再生效。
   *   保留作向后兼容（旧脚本可能仍传 --enforce-pii），但任何值都被忽略。
   *   下一个 major release 移除。
   */
  enforcePiiChecks: boolean;
}

/**
 * 全局配置实例
 *
 * 从 process.argv 读取命令行参数。
 */
export const config: LspConfig = {
  strictPiiMode: process.argv.includes('--strict-pii'),
  enforcePiiChecks: process.argv.includes('--enforce-pii'),
};

// ADR-0009 P0-1: 在 LSP 启动时打印 deprecation warning 给传 --enforce-pii
// / --no-enforce-pii 的老脚本——避免用户误以为开关有效。
if (process.argv.includes('--enforce-pii') || process.argv.includes('--no-enforce-pii')) {
  // 使用 stderr 避免污染 LSP stdio 协议（stdout 是 JSON-RPC channel）
  // eslint-disable-next-line no-console
  console.error(
    '[aster-lsp] DEPRECATION: --enforce-pii / --no-enforce-pii flags are ignored ' +
      'since ADR-0009 P0-1. PII flow analysis is always enabled. ' +
      'Remove these flags from your launch configuration.',
  );
}

/**
 * 重置配置（用于测试）
 */
export function resetConfig(newConfig: Partial<LspConfig>): void {
  Object.assign(config, newConfig);
}
