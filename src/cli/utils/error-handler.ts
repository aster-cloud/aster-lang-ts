import type { Diagnostic } from '../../diagnostics/diagnostics.js';
import { DiagnosticCode, DiagnosticError } from '../../diagnostics/diagnostics.js';
import { error as logError, warn as logWarn } from './logger.js';

type CliErrorCategory = 'network' | 'filesystem' | 'conflict' | 'manifest' | 'unknown';

interface DiagnosticCarrier extends Error {
  diagnostics?: Diagnostic[];
}

function isDiagnosticArray(value: unknown): value is Diagnostic[] {
  return Array.isArray(value) && value.every(item => typeof item?.code === 'string');
}

function isDiagnosticCarrier(error: unknown): error is DiagnosticCarrier {
  return Boolean(error && typeof error === 'object' && 'diagnostics' in error && isDiagnosticArray((error as DiagnosticCarrier).diagnostics));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string');
}

function classify(code: DiagnosticCode): CliErrorCategory {
  if (code.startsWith('R00')) return 'network';
  if (code.startsWith('V00')) return 'conflict';
  if (code.startsWith('M00')) return 'manifest';
  if (code.startsWith('C00')) return 'filesystem';
  return 'unknown';
}

function hintFor(code: DiagnosticCode): string | null {
  switch (classify(code)) {
    case 'network':
      return '网络请求失败，请确认联网状态或切换 --registry=local';
    case 'conflict':
      return '依赖版本冲突，请尝试指定更精确的版本范围';
    case 'manifest':
      return 'manifest.json 存在格式问题，请按照 schema 修复后重试';
    case 'filesystem':
      return '本地缓存或文件权限异常，请检查 .aster 目录权限';
    default:
      return null;
  }
}

function printDiagnostics(diags: Diagnostic[]): void {
  for (const diag of diags) {
    logError(`[${diag.code}] ${diag.message}`);
    const hint = hintFor(diag.code);
    if (hint) {
      logWarn(hint);
    }
  }
}

function handleNodeError(error: NodeJS.ErrnoException): void {
  const code = error.code ?? 'UNKNOWN';
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      logError(`文件权限不足：${error.message}`);
      break;
    case 'ENOENT':
      logError(`未找到目标文件：${error.message}`);
      break;
    default:
      logError(`文件系统错误(${code})：${error.message}`);
      break;
  }
}

export function createDiagnosticsError(diagnostics: Diagnostic[]): Error {
  const error = new Error('CLI_DIAGNOSTIC_ERROR');
  (error as DiagnosticCarrier).diagnostics = diagnostics;
  return error;
}

export function handleError(error: unknown): void {
  if (error instanceof DiagnosticError) {
    printDiagnostics([error.diagnostic]);
    process.exit(1);
  }

  if (isDiagnosticCarrier(error)) {
    printDiagnostics(error.diagnostics ?? []);
    process.exit(1);
  }

  if (isDiagnosticArray(error)) {
    printDiagnostics(error);
    process.exit(1);
  }

  if (isNodeError(error)) {
    handleNodeError(error);
    process.exit(1);
  }

  if (error instanceof Error) {
    logError(error.message);
  } else {
    logError('发生未知错误，请重试');
  }

  process.exit(1);
}
