/**
 * CLI 专用日志工具，提供带颜色的统一输出格式。
 */

const enum AnsiColor {
  Reset = '\u001B[0m',
  Green = '\u001B[32m',
  Red = '\u001B[31m',
  Yellow = '\u001B[33m',
  Cyan = '\u001B[36m',
}

function colorize(symbol: string, message: string, color: AnsiColor): string {
  return `${color}${symbol}${AnsiColor.Reset} ${message}`;
}

// 使用 Unicode 符号满足“绿色✓/红色✗/黄色⚠”的输出规范。

export function info(message: string): void {
  console.log(colorize('ℹ', message, AnsiColor.Cyan));
}

export function success(message: string): void {
  console.log(colorize('✓', message, AnsiColor.Green));
}

export function warn(message: string): void {
  console.warn(colorize('⚠', message, AnsiColor.Yellow));
}

export function error(message: string): void {
  console.error(colorize('✗', message, AnsiColor.Red));
}
