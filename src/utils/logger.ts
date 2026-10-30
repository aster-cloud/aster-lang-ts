import { ConfigService } from '../config/config-service.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogMetadata {
  [key: string]: unknown;
}

/**
 * 日志落点。默认落点写 stderr（保证 stdout 不被污染，LSP 走 stdio）；
 * LSP 服务端安装按级别映射到 `connection.console` 的落点，并带自己的最小级别。
 */
export interface LogSink {
  /** 安装落点后生效的最小级别，覆盖各 Logger 自带的 minLevel */
  readonly minLevel: LogLevel;
  write(level: LogLevel, line: string): void;
}

let activeSink: LogSink | null = null;

/** 安装全局日志落点；返回恢复先前落点的函数。 */
export function installLogSink(sink: LogSink): () => void {
  const previous = activeSink;
  activeSink = sink;
  return () => {
    activeSink = previous;
  };
}

export class Logger {
  constructor(private readonly component: string, private readonly minLevel: LogLevel = LogLevel.INFO) {}

  debug(message: string, meta?: LogMetadata): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: LogMetadata): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: LogMetadata): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, error?: Error, meta?: LogMetadata): void {
    const errorMeta = error
      ? {
          error: error.message,
          stack: error.stack,
          ...meta,
        }
      : meta;
    this.log(LogLevel.ERROR, message, errorMeta);
  }

  private log(level: LogLevel, message: string, meta?: LogMetadata): void {
    const sink = activeSink;
    if (level < (sink ? sink.minLevel : this.minLevel)) return;

    const entry = {
      level: LogLevel[level],
      timestamp: new Date().toISOString(),
      component: this.component,
      message,
      ...meta,
    };

    const output = JSON.stringify(entry);
    if (sink) {
      sink.write(level, output);
      return;
    }
    // 默认写 stderr，避免污染 stdout（LSP 使用 stdio）
    console.error(output);
  }
}

export interface PerformanceMetrics {
  component: string;
  operation: string;
  duration: number;
  metadata?: LogMetadata;
}

export function logPerformance(metrics: PerformanceMetrics): void {
  const logger = new Logger('performance');
  logger.info(`${metrics.operation} completed`, {
    duration_ms: metrics.duration,
    ...metrics.metadata,
  });
}

export function createLogger(component: string): Logger {
  return new Logger(component, ConfigService.getInstance().logLevel);
}
