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
    if (level < this.minLevel) return;

    const entry = {
      level: LogLevel[level],
      timestamp: new Date().toISOString(),
      component: this.component,
      message,
      ...meta,
    };

    const output = JSON.stringify(entry);
    // Always output to stderr to avoid polluting stdout (LSP uses stdio)
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
