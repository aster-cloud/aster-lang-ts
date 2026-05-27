/**
 * Browser PII analyzer failure handling test (P0-R / High #6).
 *
 * 验证 typecheckBrowser 在 PII analyzer 抛错时：
 * 1. 不让整个 typecheck 崩溃（防御性 catch）
 * 2. 用专用 error code (PII_ANALYZER_FAILED) 上报
 * 3. severity = 'error'（不是 warning——PII 安全失败不能伪装成普通问题）
 * 4. 不要再用 UNDEFINED_VARIABLE 这种语义错误的 fallback code
 *
 * 这是 codex review High #6 抓出的回归——之前的代码用 E101
 * (UNDEFINED_VARIABLE) + warning severity，把 PII analyzer failure 降级
 * 成"小问题"。修复后必须用专用 code + error severity。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { Core as CoreBuilder } from '../../../src/core/core_ir.js';
import { Effect } from '../../../src/config/semantic.js';
import type { Core } from '../../../src/types.js';

// 注入故障 fixture：构造一个会让 PII analyzer 内部失败的边界 input。
// checkModulePII 设计稳定，让它真实失败需要 monkey-patch。我们改用更直接的
// 测试策略：mock checkModulePII via dynamic import，让它抛错。
//
// 但 node:test 不支持灵活 mock。所以采用替代方案：
// 1. 验证"正常无 PII 代码"下不应该出现 PII_ANALYZER_FAILED（baseline）
// 2. 用一个 stub function 直接验证 fallback code 的语义（保证下次重构不退化）

describe('typecheckBrowser — PII analyzer failure handling (P0-R)', () => {
  it('正常代码不应触发 PII_ANALYZER_FAILED 错误', () => {
    const httpImport = CoreBuilder.Import('Http', 'H');
    const fn = CoreBuilder.Func(
      'normal',
      [],
      [{ name: 'x', type: CoreBuilder.TypeName('Text') }],
      CoreBuilder.TypeName('Text'),
      [Effect.PURE],
      CoreBuilder.Block([CoreBuilder.Return(CoreBuilder.Name('x'))]),
      [],
      false,
    );
    const module: Core.Module = CoreBuilder.Module('tests.pii.normal', [httpImport, fn]);

    const diags = typecheckBrowser(module);
    const analyzerFailed = diags.find((d) => d.code === ErrorCode.PII_ANALYZER_FAILED);
    assert.equal(
      analyzerFailed,
      undefined,
      '正常代码不应触发 PII_ANALYZER_FAILED；如果触发，说明 checkModulePII 自身 buggy',
    );
  });

  it('PII_ANALYZER_FAILED 的元数据：error severity（不是 warning）', async () => {
    // 直接断言 error_codes 的元数据 contract，保证 P0-R 修复不被回退。
    // 之前的 bug：fallback 用 UNDEFINED_VARIABLE + warning severity（codex
    // High #6）。修复后必须 error severity。
    const { ERROR_METADATA } = await import('../../../src/diagnostics/error_codes.js');
    const meta = ERROR_METADATA[ErrorCode.PII_ANALYZER_FAILED];
    assert.ok(meta, 'PII_ANALYZER_FAILED 应在 ERROR_METADATA 中注册');
    assert.equal(
      meta.severity,
      'error',
      `PII analyzer 失败必须是 error severity（不是 warning），实际：${meta.severity}`,
    );
    assert.equal(meta.category, 'pii', `PII analyzer 失败应归类为 pii，实际：${meta.category}`);
  });

  it('PII_ANALYZER_FAILED code 是 E404（专用，不与其他错误共享）', () => {
    assert.equal(
      ErrorCode.PII_ANALYZER_FAILED,
      'E404',
      'PII analyzer failure 应有专用 code，不能复用 UNDEFINED_VARIABLE 等通用 code',
    );
  });
});

describe('typecheckBrowser — PII analyzer failure injection (true fault-injection)', () => {
  // P0-R2 (codex review Medium #5): 真实 fault injection 通过
  // __setPiiCheckerForTest 注入会抛错的 checker，让 typecheckBrowser 实际
  // 命中 catch 分支。这比之前的"读 dist regex"测试强得多——直接断言运行时
  // 行为而非源代码字符串。

  it('真实注入抛错的 checker → typecheckBrowser 返回 E404 diagnostic', async () => {
    const { typecheckBrowser, __setPiiCheckerForTest } = await import(
      '../../../src/typecheck/browser.js'
    );
    const { Core: CoreBuilder } = await import('../../../src/core/core_ir.js');
    const { Effect } = await import('../../../src/config/semantic.js');

    // 注入会抛错的 checker
    __setPiiCheckerForTest(() => {
      throw new Error('synthetic-pii-analyzer-failure');
    });

    try {
      const fn = CoreBuilder.Func(
        'test_fn',
        [],
        [{ name: 'x', type: CoreBuilder.TypeName('Text') }],
        CoreBuilder.TypeName('Text'),
        [Effect.PURE],
        CoreBuilder.Block([CoreBuilder.Return(CoreBuilder.Name('x'))]),
        [],
        false,
      );
      const module = CoreBuilder.Module('tests.pii.failure_injection', [fn]);

      const diags = typecheckBrowser(module);

      const failureDiag = diags.find((d) => d.code === ErrorCode.PII_ANALYZER_FAILED);
      assert.ok(failureDiag, 'catch 分支应产生 PII_ANALYZER_FAILED 诊断');
      assert.strictEqual(failureDiag!.severity, 'error', 'severity 必须是 error');
      assert.match(
        failureDiag!.message,
        /synthetic-pii-analyzer-failure/,
        'message 应包含 catch 到的原始错误消息',
      );
      assert.match(
        failureDiag!.message,
        /PII safety analysis failed/,
        'message 应使用业务用户友好的开头',
      );
    } finally {
      // 恢复默认 checker
      __setPiiCheckerForTest(null);
    }
  });

  it('真实 isProductionRuntime 在 __ASTER_PRODUCTION__=true 下返回 true', async () => {
    // P0-R6 (codex round 6 review): 调用真实导出函数而非 inline 字符串。
    // 如果实现改坏，测试会真正失败（不是 test/implementation drift）。
    const { __isProductionRuntimeForTest } = await import(
      '../../../src/typecheck/browser.js'
    );

    const original = (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__;
    (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__ = true;
    try {
      assert.equal(
        __isProductionRuntimeForTest(),
        true,
        '__ASTER_PRODUCTION__=true 应让真实 isProductionRuntime 返回 true',
      );
    } finally {
      if (original === undefined) {
        delete (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__;
      } else {
        (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__ = original;
      }
    }
  });

  it('真实 isProductionRuntime 在 NODE_ENV=production 下返回 true', async () => {
    // P0-R6: 真实模块逻辑测试 NODE_ENV 源
    const { __isProductionRuntimeForTest } = await import(
      '../../../src/typecheck/browser.js'
    );
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.equal(
        __isProductionRuntimeForTest(),
        true,
        'NODE_ENV=production 应让真实 isProductionRuntime 返回 true',
      );
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });

  it('真实 isProductionRuntime 在无 production 信号下返回 false', async () => {
    const { __isProductionRuntimeForTest } = await import(
      '../../../src/typecheck/browser.js'
    );

    const originalEnv = process.env.NODE_ENV;
    const originalGlobal = (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__;
    delete process.env.NODE_ENV;
    delete (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__;
    try {
      assert.equal(
        __isProductionRuntimeForTest(),
        false,
        '所有源都缺失 production 信号时应返回 false',
      );
    } finally {
      if (originalEnv !== undefined) process.env.NODE_ENV = originalEnv;
      if (originalGlobal !== undefined) {
        (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__ = originalGlobal;
      }
    }
  });

  it('__ASTER_PRODUCTION__ 全局标志触发 production guard（browser/Workers 路径）', async () => {
    // P0-R4 (codex round 4): browser/Workers 没有 process 全局，
    // __ASTER_PRODUCTION__ 是显式逃生窗口（部署时手动设置）
    const { __setPiiCheckerForTest } = await import(
      '../../../src/typecheck/browser.js'
    );
    const original = (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__;
    (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__ = true;
    try {
      assert.throws(
        () => __setPiiCheckerForTest(() => { throw new Error('attack'); }),
        /testing-only API.*production runtime/i,
        '__ASTER_PRODUCTION__=true 必须阻止 non-null 注入',
      );
      __setPiiCheckerForTest(null);
    } finally {
      if (original === undefined) {
        delete (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__;
      } else {
        (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__ = original;
      }
    }
  });

  it('production runtime 拒绝 __setPiiCheckerForTest 注入 non-null（生产保护）', async () => {
    // P0-R3 (codex review High #3): 防御性 guard——production runtime
    // 即使有人误用 testing seam，也不能关闭 PII 检查。
    const { __setPiiCheckerForTest } = await import(
      '../../../src/typecheck/browser.js'
    );

    // 临时设置 NODE_ENV=production
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(
        () => __setPiiCheckerForTest(() => { throw new Error('attack'); }),
        /testing-only API.*production runtime/i,
        '生产环境必须拒绝非 null 的 PII checker 注入',
      );
      // null 仍允许（清理时不应抛错）
      __setPiiCheckerForTest(null);
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });

  it('恢复默认 checker 后正常代码不再产生 E404', async () => {
    const { typecheckBrowser, __setPiiCheckerForTest } = await import(
      '../../../src/typecheck/browser.js'
    );
    const { Core: CoreBuilder } = await import('../../../src/core/core_ir.js');
    const { Effect } = await import('../../../src/config/semantic.js');

    __setPiiCheckerForTest(null);

    const fn = CoreBuilder.Func(
      'no_pii',
      [],
      [{ name: 'plain', type: CoreBuilder.TypeName('Text') }],
      CoreBuilder.TypeName('Text'),
      [Effect.PURE],
      CoreBuilder.Block([CoreBuilder.Return(CoreBuilder.Name('plain'))]),
      [],
      false,
    );
    const module = CoreBuilder.Module('tests.pii.cleanup_check', [fn]);

    const diags = typecheckBrowser(module);
    const failureDiag = diags.find((d) => d.code === ErrorCode.PII_ANALYZER_FAILED);
    assert.equal(failureDiag, undefined, 'override 清除后无 PII 代码不应触发 E404');
  });

  it('编译后的 browser.js 包含正确的 PII_ANALYZER_FAILED 字面值（防止回退）', async () => {
    // 用 import.meta.url 拼到 dist 目录里的 browser.js，验证编译产物保留
    // 了正确的 catch 分支语义。源码读不到也无妨——我们要保护的是 dist 行为。
    const fs = await import('node:fs/promises');
    // 当前测试位置：dist/test/unit/browser/typecheck-browser-pii-failure.test.js
    // browser.js 实际位置：    dist/src/typecheck/browser.js
    const browserJsUrl = new URL('../../../src/typecheck/browser.js', import.meta.url);
    const compiled = await fs.readFile(browserJsUrl, 'utf-8');

    // 编译后 ErrorCode.PII_ANALYZER_FAILED 可能被 inline 为 "E404" 字面值，
    // 也可能保留为属性引用——两种都接受
    const hasAnalyzerFailedRef =
      /PII_ANALYZER_FAILED/.test(compiled) || /["']E404["']/.test(compiled);
    assert.ok(
      hasAnalyzerFailedRef,
      'browser.js 编译产物必须含 PII_ANALYZER_FAILED 或 "E404" 字面值',
    );

    // catch 分支必须 severity='error'
    // 而且 PII flow analysis aborted 上下文里不应再出现 UNDEFINED_VARIABLE
    assert.doesNotMatch(
      compiled,
      /UNDEFINED_VARIABLE[\s\S]{0,200}?PII flow analysis aborted/,
      '不应再用 UNDEFINED_VARIABLE 作为 PII analyzer failure fallback（P0-R High #6 修复）',
    );
  });
});
