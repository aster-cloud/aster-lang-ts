import { LogLevel, installLogSink, type LogSink } from '../utils/logger.js';
import { ConfigService } from '../config/config-service.js';

/** `connection.console` 中本模块用到的方法子集，便于测试时替换。 */
export interface LspConsole {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  log(message: string): void;
}

/** LSP 下的默认最小级别：INFO/DEBUG 不经 window/logMessage 推给客户端。 */
export const LSP_DEFAULT_LOG_LEVEL = LogLevel.WARN;

/**
 * 构造把 Logger 级别映射到 window/logMessage 类型的落点：
 * ERROR→1、WARN→2、INFO→3、DEBUG→4（经 `connection.console.log`）。
 */
export function createLspLogSink(lspConsole: LspConsole, minLevel: LogLevel): LogSink {
  return {
    minLevel,
    write(level, line): void {
      switch (level) {
        case LogLevel.ERROR:
          lspConsole.error(line);
          return;
        case LogLevel.WARN:
          lspConsole.warn(line);
          return;
        case LogLevel.INFO:
          lspConsole.info(line);
          return;
        default:
          lspConsole.log(line);
      }
    },
  };
}

/**
 * 在 LSP 服务端安装日志落点。最小级别取 ASTER_LOG_LEVEL（兼容 LOG_LEVEL），缺省为 WARN。
 * 返回恢复先前落点的函数。
 */
export function installLspLogSink(lspConsole: LspConsole): () => void {
  const level = ConfigService.getInstance().configuredLogLevel ?? LSP_DEFAULT_LOG_LEVEL;
  return installLogSink(createLspLogSink(lspConsole, level));
}
