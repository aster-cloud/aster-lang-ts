import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticSeverity } from 'vscode-languageserver/node.js';
import type { Core, Origin } from '../../../src/types.js';
import { checkPiiFlow } from '../../../src/lsp/pii_diagnostics.js';
import { config, resetConfig } from '../../../src/lsp/config.js';

let piiDiagnosticsModule: typeof import('../../../src/lsp/pii_diagnostics.js') | null = null;
let originalActiveContext: unknown = null;

before(async () => {
  piiDiagnosticsModule = await import('../../../src/lsp/pii_diagnostics.js');
  if (!piiDiagnosticsModule) return;
  const exportedActive = (piiDiagnosticsModule as Record<string, unknown>).activeContext;
  if (exportedActive !== undefined) {
    originalActiveContext = exportedActive;
    return;
  }
  const resetForTesting = (piiDiagnosticsModule as Record<string, unknown>).resetContextForTesting;
  if (typeof resetForTesting === 'function') {
    originalActiveContext = (resetForTesting as () => unknown)();
  }
});

after(() => {
  if (!piiDiagnosticsModule) return;
  const exportedActive = (piiDiagnosticsModule as Record<string, unknown>).activeContext;
  if (exportedActive !== undefined) {
    (piiDiagnosticsModule as Record<string, unknown>).activeContext = originalActiveContext;
    return;
  }
  const setForTesting = (piiDiagnosticsModule as Record<string, unknown>).setContextForTesting;
  if (typeof setForTesting === 'function') {
    (setForTesting as (value: unknown) => void)(originalActiveContext);
  }
});

function makeOrigin(label: string): Origin {
  return {
    file: `${label}.aster`,
    start: { line: 1, col: 1 },
    end: { line: 1, col: 10 },
  };
}

function makeName(name: string): Core.Name {
  return { kind: 'Name', name, origin: makeOrigin(name) };
}

function makeCall(name: string, args: Core.Expression[] = []): Core.Call {
  return {
    kind: 'Call',
    target: makeName(name),
    args,
    origin: makeOrigin(`call:${name}`),
  };
}

function makeBlock(statements: Core.Statement[]): Core.Block {
  return { kind: 'Block', statements };
}

interface FuncOptions {
  name: string;
  params?: Core.Parameter[];
  effects?: ReadonlyArray<Core.Func['effects'][number]>;
  body?: Core.Block;
  ret?: Core.Type;
}

const UNIT_TYPE: Core.TypeName = { kind: 'TypeName', name: 'Unit' };

function makeFunc({
  name,
  params = [],
  effects = [],
  body = makeBlock([makeReturn(makeName('unit'))]),
  ret = UNIT_TYPE,
}: FuncOptions): Core.Func {
  return {
    kind: 'Func',
    name,
    typeParams: [],
    params: params.map(param => ({ ...param })),
    ret,
    effects,
    effectCaps: [],
    effectCapsExplicit: false,
    body,
  };
}

function makeReturn(expr: Core.Expression): Core.Return {
  return { kind: 'Return', expr };
}

function makeLet(name: string, expr: Core.Expression): Core.Let {
  return { kind: 'Let', name, expr };
}

describe('PII Diagnostics', () => {
  describe('checkPiiFlow', () => {
    it('应该对空模块返回空诊断列表', () => {
      const emptyModule: Core.Module = {
        kind: 'Module',
        name: 'TestModule',
        decls: [],
      };
      const diagnostics = checkPiiFlow(emptyModule);
      assert.strictEqual(diagnostics.length, 0);
    });

    it('默认模式下 PII 泄漏应为 Warning', () => {
      // 确保默认配置（非严格模式）
      resetConfig({ strictPiiMode: false });

      const stringType: Core.TypeName = { kind: 'TypeName', name: 'String' };
      const piiType: Core.PiiType = {
        kind: 'PiiType',
        baseType: stringType,
        sensitivity: 'L2',
        category: 'name',
      };
      const httpCallWithPii: Core.Call = {
        kind: 'Call',
        target: makeName('Http.post'),
        args: [makeName('piiData')],
        origin: makeOrigin('http-call'),
      };

      const func = makeFunc({
        name: 'leakPii',
        params: [{ name: 'piiData', type: piiType }],
        body: makeBlock([makeReturn(httpCallWithPii)]),
      });

      const module: Core.Module = {
        kind: 'Module',
        name: 'TestModule',
        decls: [func],
      };

      const diagnostics = checkPiiFlow(module);
      // 现在返回 2 个诊断：HTTP 泄漏 + 缺失同意检查
      assert.ok(diagnostics.length >= 1);
      const httpDiag = diagnostics.find(d => d.message.includes('PII data transmitted over HTTP'));
      assert.ok(httpDiag, '应检测到 HTTP PII 泄漏');
      assert.strictEqual(httpDiag.severity, DiagnosticSeverity.Warning);
    });

    it('--strict-pii 模式下 PII 泄漏应为 Error', () => {
      // 启用严格模式
      resetConfig({ strictPiiMode: true });

      const stringType: Core.TypeName = { kind: 'TypeName', name: 'String' };
      const piiType: Core.PiiType = {
        kind: 'PiiType',
        baseType: stringType,
        sensitivity: 'L2',
        category: 'name',
      };
      const httpCallWithPii: Core.Call = {
        kind: 'Call',
        target: makeName('Http.post'),
        args: [makeName('piiData')],
        origin: makeOrigin('http-call'),
      };

      const func = makeFunc({
        name: 'leakPii',
        params: [{ name: 'piiData', type: piiType }],
        body: makeBlock([makeReturn(httpCallWithPii)]),
      });

      const module: Core.Module = {
        kind: 'Module',
        name: 'TestModule',
        decls: [func],
      };

      const diagnostics = checkPiiFlow(module);
      // 现在返回 2 个诊断：HTTP 泄漏 + 缺失同意检查
      assert.ok(diagnostics.length >= 1);
      const httpDiag = diagnostics.find(d => d.message.includes('PII data transmitted over HTTP'));
      assert.ok(httpDiag, '应检测到 HTTP PII 泄漏');
      assert.strictEqual(httpDiag.severity, DiagnosticSeverity.Error);

      // 恢复默认配置
      resetConfig({ strictPiiMode: false });
    });

    it('语义层诊断应设置 source="aster-pii" (P1-3 Task 6)', () => {
      // 启用严格模式以获得 Error 级别诊断
      resetConfig({ strictPiiMode: true });

      const stringType: Core.TypeName = { kind: 'TypeName', name: 'String' };
      const piiType: Core.PiiType = {
        kind: 'PiiType',
        baseType: stringType,
        sensitivity: 'L2',
        category: 'email',
      };
      const httpCallWithPii: Core.Call = {
        kind: 'Call',
        target: makeName('Http.post'),
        args: [makeName('userEmail')],
        origin: makeOrigin('http-call'),
      };

      const func = makeFunc({
        name: 'sendEmail',
        params: [{ name: 'userEmail', type: piiType }],
        body: makeBlock([makeReturn(httpCallWithPii)]),
      });

      const module: Core.Module = {
        kind: 'Module',
        name: 'TestModule',
        decls: [func],
      };

      const diagnostics = checkPiiFlow(module);
      // 现在返回 2 个诊断：HTTP 泄漏 + 缺失同意检查
      assert.ok(diagnostics.length >= 1, '应检测到至少 1 条语义层 PII 诊断');

      const httpDiag = diagnostics.find(d => d.message.includes('PII data transmitted over HTTP'));
      assert.ok(httpDiag, '诊断对象应存在');

      // 验证 source 字段 (P1-3 Task 6)
      assert.strictEqual(httpDiag.source, 'aster-pii', '语义层诊断应设置 source="aster-pii"');
      assert.strictEqual(httpDiag.severity, DiagnosticSeverity.Error, '严格模式下应为 Error');
      assert.ok(httpDiag.message.includes('PII data transmitted over HTTP'), '消息应包含 PII HTTP 警告');

      // 验证所有诊断都使用 source="aster-pii"
      for (const diag of diagnostics) {
        assert.strictEqual(diag.source, 'aster-pii', '所有 PII 诊断应使用 source="aster-pii"');
      }

      // 恢复默认配置
      resetConfig({ strictPiiMode: false });
    });

    it('无 PII 泄漏时不应产生诊断', () => {
      resetConfig({ strictPiiMode: true });

      const stringType: Core.TypeName = { kind: 'TypeName', name: 'String' };
      const httpCallWithoutPii: Core.Call = {
        kind: 'Call',
        target: makeName('Http.post'),
        args: [makeName('safeData')],
        origin: makeOrigin('http-call'),
      };

      const func = makeFunc({
        name: 'noLeak',
        params: [{ name: 'safeData', type: stringType }],
        body: makeBlock([makeReturn(httpCallWithoutPii)]),
      });

      const module: Core.Module = {
        kind: 'Module',
        name: 'TestModule',
        decls: [func],
      };

      const diagnostics = checkPiiFlow(module);
      assert.strictEqual(diagnostics.length, 0);

      resetConfig({ strictPiiMode: false });
    });
  });
});
