import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleError,
  createDiagnosticsError,
} from '../../../src/cli/utils/error-handler.js';
import {
  DiagnosticCode,
  DiagnosticSeverity,
  type Diagnostic,
} from '../../../src/diagnostics/diagnostics.js';

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super('exit');
  }
}

const defaultSpan = {
  start: { line: 1, col: 1 },
  end: { line: 1, col: 1 },
};

function makeDiagnostic(code: DiagnosticCode, message: string): Diagnostic {
  return {
    severity: DiagnosticSeverity.Error,
    code,
    message,
    span: defaultSpan,
  };
}

describe('error-handler', { concurrency: false }, () => {
  let originalExit: typeof process.exit;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;
  let errors: string[];
  let warnings: string[];

  beforeEach(() => {
    errors = [];
    warnings = [];
    originalExit = process.exit;
    originalError = console.error;
    originalWarn = console.warn;
    process.exit = ((code?: number) => {
      throw new ExitSignal(code ?? 0);
    }) as never;
    console.error = (message?: unknown) => {
      errors.push(String(message ?? ''));
    };
    console.warn = (message?: unknown) => {
      warnings.push(String(message ?? ''));
    };
  });

  afterEach(() => {
    process.exit = originalExit;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('输出诊断与分类提示', () => {
    const diagnostics: Diagnostic[] = [
      makeDiagnostic(DiagnosticCode.R003_PackageNotFoundOnGitHub, 'network'),
      makeDiagnostic(DiagnosticCode.V003_PackageNotFound, 'version'),
      makeDiagnostic(DiagnosticCode.M003_InvalidPackageName, 'manifest'),
      makeDiagnostic(DiagnosticCode.C001_CacheCorrupted, 'cache'),
      makeDiagnostic(DiagnosticCode.S001_UndefinedVariable, 'unknown'),
    ];

    try {
      handleError(diagnostics);
      assert.fail('handleError 应调用 process.exit');
    } catch (error) {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 1);
    }

    assert.equal(errors.length, diagnostics.length);
    assert.equal(warnings.length, diagnostics.length - 1);
    assert.match(errors[0] ?? '', /\[R003]/);
  });

  it('支持 createDiagnosticsError 产生的 carrier', () => {
    const diagnostic = makeDiagnostic(DiagnosticCode.M002_ManifestFileNotFound, 'missing');
    try {
      handleError(createDiagnosticsError([diagnostic]));
      assert.fail('handleError 应终止流程');
    } catch (error) {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 1);
    }
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? '', /\[M002]/);
  });

  it('处理 NodeJS 文件系统错误', () => {
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    try {
      handleError(enoent);
      assert.fail('handleError 应终止流程');
    } catch (error) {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 1);
    }
    assert.ok(errors[0]?.includes('未找到目标文件'), '应输出缺失文件提示');
  });

  it('打印普通错误信息', () => {
    try {
      handleError('未知异常');
      assert.fail('handleError 应终止流程');
    } catch (error) {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 1);
    }
    assert.ok(errors[0]?.includes('未知错误'), '默认路径应输出未知错误提示');
  });
});
