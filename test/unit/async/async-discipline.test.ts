/**
 * 异步纪律检查测试
 *
 * 测试 collectAsync 的错误检查逻辑：
 * 1. Start 未 Wait - 应该产生 error
 * 2. Wait 未 Start - 应该产生 error
 * 3. 重复 Start - 应该产生 error
 * 4. 重复 Wait - 应该产生 warning
 * 5. 正常场景 - 不应该有错误
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Module as AstModule } from '../../../src/types.js';

const ASYNC_ERROR_CODES = new Set([
  ErrorCode.ASYNC_START_NOT_WAITED,
  ErrorCode.ASYNC_WAIT_NOT_STARTED,
  ErrorCode.ASYNC_DUPLICATE_START,
  ErrorCode.ASYNC_DUPLICATE_WAIT,
  ErrorCode.ASYNC_WAIT_BEFORE_START
]);

function compileAndGetDiagnostics(source: string): Array<{ severity: string; message: string; code?: string }> {
  try {
    const canonical = canonicalize(source);
    const tokens = lex(canonical);
    const ast = parse(tokens).ast as AstModule;
    const core = lowerModule(ast);
    return typecheckModule(core);
  } catch (error) {
    return [{ severity: 'error', message: (error as Error).message }];
  }
}

describe('异步纪律检查', () => {
  describe('Start 未 Wait 场景', () => {
    it('应该检测单个 Start 未 Wait', () => {
      const source = `
Module test.async.start_not_waited.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_START_NOT_WAITED);

      assert.equal(errors.length, 1, '应该有1个 Start 未 Wait 错误');
      assert.equal(errors[0]!.message.includes('profile'), true, '错误消息应该包含任务名 profile');
      assert.equal(errors[0]!.message.includes('not waited'), true, '错误消息应该说明未等待');
    });

    it('应该检测多个 Start 未 Wait', () => {
      const source = `
Module test.async.multiple_not_waited.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Start timeline as async fetchTimeline(u.id).
  Start settings as async fetchSettings(u.id).
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".

Rule fetchTimeline given id as Text, produce Text. It performs io:
  Return "Timeline".

Rule fetchSettings given id as Text, produce Text. It performs io:
  Return "Settings".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_START_NOT_WAITED);

      assert.equal(errors.length, 3, '应该有3个 Start 未 Wait 错误');
      const errorNames = errors.map(e => e.message).join(' ');
      assert.equal(errorNames.includes('profile'), true, '应该包含 profile');
      assert.equal(errorNames.includes('timeline'), true, '应该包含 timeline');
      assert.equal(errorNames.includes('settings'), true, '应该包含 settings');
    });
  });

  describe('Wait 未 Start 场景', () => {
    it('应该检测单个 Wait 未 Start', () => {
      const source = `
Module test.async.wait_not_started.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Wait for profile.
  Return "Done".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_WAIT_NOT_STARTED);

      assert.equal(errors.length, 1, '应该有1个 Wait 未 Start 错误');
      assert.equal(errors[0]!.message.includes('profile'), true, '错误消息应该包含任务名 profile');
      assert.equal(errors[0]!.message.includes('never started'), true, '错误消息应该说明从未启动');
    });

    it('应该检测多个 Wait 未 Start', () => {
      const source = `
Module test.async.multiple_wait_not_started.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Wait for profile and timeline and settings.
  Return "Done".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_WAIT_NOT_STARTED);

      assert.equal(errors.length, 3, '应该有3个 Wait 未 Start 错误');
      const errorNames = errors.map(e => e.message).join(' ');
      assert.equal(errorNames.includes('profile'), true, '应该包含 profile');
      assert.equal(errorNames.includes('timeline'), true, '应该包含 timeline');
      assert.equal(errorNames.includes('settings'), true, '应该包含 settings');
    });
  });

  describe('重复 Start 场景', () => {
    it('应该检测重复 Start 同一任务', () => {
      const source = `
Module test.async.duplicate_start.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Start profile as async fetchProfile(u.id).
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_DUPLICATE_START);

      assert.equal(errors.length, 1, '应该有1个重复 Start 错误');
      assert.equal(errors[0]!.message.includes('profile'), true, '错误消息应该包含任务名 profile');
      assert.equal(errors[0]!.message.includes('multiple times'), true, '错误消息应该说明多次启动');
      assert.equal(errors[0]!.message.includes('2'), true, '错误消息应该包含出现次数 2');
    });

    it('应该检测三次 Start 同一任务', () => {
      const source = `
Module test.async.triple_start.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Start profile as async fetchProfile(u.id).
  Start profile as async fetchProfile(u.id).
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_DUPLICATE_START);

      // 应该有2个错误（第2次和第3次启动）
      assert.equal(errors.length, 2, '应该有2个重复 Start 错误（第2次和第3次启动）');
      assert.equal(errors[0]!.message.includes('3'), true, '错误消息应该包含总出现次数 3');
    });
  });

  describe('重复 Wait 场景', () => {
    it('应该检测重复 Wait 同一任务（warning）', () => {
      const source = `
Module test.async.duplicate_wait.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Wait for profile.
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const warnings = diagnostics.filter(d => d.severity === 'warning' && d.code === ErrorCode.ASYNC_DUPLICATE_WAIT);

      assert.equal(warnings.length, 1, '应该有1个重复 Wait 警告');
      assert.equal(warnings[0]!.message.includes('profile'), true, '警告消息应该包含任务名 profile');
      assert.equal(warnings[0]!.message.includes('multiple times'), true, '警告消息应该说明多次等待');
      assert.equal(warnings[0]!.message.includes('2'), true, '警告消息应该包含出现次数 2');
    });

    it('应该检测三次 Wait 同一任务', () => {
      const source = `
Module test.async.triple_wait.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Wait for profile.
  Wait for profile.
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const warnings = diagnostics.filter(d => d.severity === 'warning' && d.code === ErrorCode.ASYNC_DUPLICATE_WAIT);

      // 应该有2个警告（第2次和第3次等待）
      assert.equal(warnings.length, 2, '应该有2个重复 Wait 警告（第2次和第3次等待）');
      assert.equal(warnings[0]!.message.includes('3'), true, '警告消息应该包含总出现次数 3');
    });
  });

  describe('正常场景', () => {
    it('单个 Start-Wait 对应该无错误', () => {
      const source = `
Module test.async.normal_single.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const asyncErrors = diagnostics.filter(d =>
        d.code !== undefined && ASYNC_ERROR_CODES.has(d.code as ErrorCode)
      );

      assert.equal(asyncErrors.length, 0, '正常场景不应该有异步纪律错误');
    });

    it('多个 Start-Wait 对应该无错误', () => {
      const source = `
Module test.async.normal_multiple.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Start timeline as async fetchTimeline(u.id).
  Start settings as async fetchSettings(u.id).
  Wait for profile and timeline and settings.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".

Rule fetchTimeline given id as Text, produce Text. It performs io:
  Return "Timeline".

Rule fetchSettings given id as Text, produce Text. It performs io:
  Return "Settings".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const asyncErrors = diagnostics.filter(d =>
        d.code !== undefined && ASYNC_ERROR_CODES.has(d.code as ErrorCode)
      );

      assert.equal(asyncErrors.length, 0, '正常场景不应该有异步纪律错误');
    });

    it('分批 Wait 应该无错误', () => {
      const source = `
Module test.async.normal_batched.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Start timeline as async fetchTimeline(u.id).
  Wait for profile.
  Start settings as async fetchSettings(u.id).
  Wait for timeline and settings.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".

Rule fetchTimeline given id as Text, produce Text. It performs io:
  Return "Timeline".

Rule fetchSettings given id as Text, produce Text. It performs io:
  Return "Settings".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const asyncErrors = diagnostics.filter(d =>
        d.code !== undefined && ASYNC_ERROR_CODES.has(d.code as ErrorCode)
      );

      assert.equal(asyncErrors.length, 0, '分批等待场景不应该有异步纪律错误');
    });
  });

  describe('混合场景', () => {
    it('应该同时检测多种错误', () => {
      const source = `
Module test.async.mixed_errors.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  Start profile as async fetchProfile(u.id).
  Start timeline as async fetchTimeline(u.id).
  Wait for profile.
  Wait for profile.
  Wait for settings.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".

Rule fetchTimeline given id as Text, produce Text. It performs io:
  Return "Timeline".
`;

      const diagnostics = compileAndGetDiagnostics(source);

      // 应该有1个 Start 未 Wait 错误（timeline）
      const startNotWaited = diagnostics.filter(d => d.code === ErrorCode.ASYNC_START_NOT_WAITED);
      assert.equal(startNotWaited.length, 1, '应该有1个 Start 未 Wait 错误');
      assert.equal(startNotWaited[0]!.message.includes('timeline'), true, '应该是 timeline');

      // 应该有1个 Wait 未 Start 错误（settings）
      const waitNotStarted = diagnostics.filter(d => d.code === ErrorCode.ASYNC_WAIT_NOT_STARTED);
      assert.equal(waitNotStarted.length, 1, '应该有1个 Wait 未 Start 错误');
      assert.equal(waitNotStarted[0]!.message.includes('settings'), true, '应该是 settings');

      // 应该有1个重复 Start 错误（profile）
      const duplicateStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);
      assert.equal(duplicateStart.length, 1, '应该有1个重复 Start 错误');
      assert.equal(duplicateStart[0]!.message.includes('profile'), true, '应该是 profile');

      // 应该有1个重复 Wait 警告（profile）
      const duplicateWait = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_WAIT);
      assert.equal(duplicateWait.length, 1, '应该有1个重复 Wait 警告');
      assert.equal(duplicateWait[0]!.message.includes('profile'), true, '应该是 profile');
    });
  });

  describe('Wait 与 Start 顺序', () => {
    it('Wait 在 Start 之前应报告错误', () => {
      const source = `
Module test.async.wait_before_start.simple.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Wait for profile.
  Start profile as async fetchProfile(u.id).
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const waitBeforeStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_WAIT_BEFORE_START);

      assert.equal(waitBeforeStart.length, 1, 'Wait 在 Start 前应产生调度错误');
      assert.equal(waitBeforeStart[0]!.message.includes('profile'), true, '诊断应包含任务名 profile');
    });

    it('Wait 在 Start 前且 Start 位于分支应报告错误', () => {
      const source = `
Module test.async.wait_before_start.branch.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Wait for profile.
  If u.id equals to "vip"
    Start profile as async fetchProfile(u.id).
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;
      const diagnostics = compileAndGetDiagnostics(source);
      const waitBeforeStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_WAIT_BEFORE_START);

      assert.equal(waitBeforeStart.length, 1, '分支中的提前 Wait 应被检测');
      assert.equal(waitBeforeStart[0]!.message.includes('profile'), true, '诊断应包含任务名 profile');
    });
  });

  describe('分支中的多重 Start', () => {
    it('If 互斥分支的重复 Start 不再报错', () => {
      const source = `
Module test.async.branch_duplicate.if.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  If u.id equals to "vip"
    Start profile as async fetchProfile(u.id).
  Otherwise
    Start profile as async fetchProfile(u.id).
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const duplicateStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);
      const waitBeforeStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_WAIT_BEFORE_START);

      assert.equal(duplicateStart.length, 0, '互斥分支中的重复 Start 不应触发重复诊断');
      assert.equal(waitBeforeStart.length, 0, '此场景不存在 Wait 顺序问题');
    });

    it('多个条件路径触发相同 Start 会被累计', () => {
      const source = `
Module test.async.branch_duplicate.multi_paths.

Define User has id as Text, tier as Text.

Rule fetchData given u as User, produce Text. It performs io:
  If u.tier equals to "vip"
    Start profile as async fetchProfile(u.id).
  If u.tier equals to "premium"
    Start profile as async fetchProfile(u.id).
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const duplicateStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);

      assert.equal(duplicateStart.length, 1, '多个条件路径重复 Start 仍被视为重复');
      assert.equal(duplicateStart[0]!.message.includes('profile'), true, '诊断应包含任务名 profile');
      assert.equal(duplicateStart[0]!.message.includes('2'), true, '诊断应包含出现次数 2');
    });
  });

  describe('嵌套作用域的 Start 行为', () => {
    it('嵌套分支中遗漏 Wait 会被视为 Start 未 Wait', () => {
      const source = `
Module test.async.nested_missing_wait.branch.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  If u.id equals to "vip"
    Start audit as async fetchAudit(u.id).
    If u.id equals to "vip"
      Start deeper as async fetchAudit(u.id).
  Wait for audit.
  Return "Done".

Rule fetchAudit given id as Text, produce Text. It performs io:
  Return "Audit".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const missingWait = diagnostics.filter(d => d.code === ErrorCode.ASYNC_START_NOT_WAITED);

      assert.equal(missingWait.length, 1, '未等待的 inner Start 仍会被全局检测');
      assert.equal(missingWait[0]!.message.includes('deeper'), true, '诊断应包含任务名 deeper');
    });

    it('外层与嵌套作用域重复 Start 会产生重复诊断', () => {
      const source = `
Module test.async.nested_duplicate_start.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Start profile as async fetchProfile(u.id).
  If u.id equals to "vip"
    Start profile as async fetchProfile(u.id).
  Wait for profile.
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const duplicateStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);

      assert.equal(duplicateStart.length, 1, '嵌套作用域内的重复 Start 也被按重复处理');
      assert.equal(duplicateStart[0]!.message.includes('profile'), true, '诊断应包含任务名 profile');
      assert.equal(duplicateStart[0]!.message.includes('2'), true, '诊断应包含出现次数 2');
    });
  });

  describe('组合场景与诊断精确性', () => {
    it('Wait 提前 + 分支重复 Start 仅产生重复诊断', () => {
      const source = `
Module test.async.combo.branch_wait_first.

Define User has id as Text.

Rule fetchData given u as User, produce Text. It performs io:
  Wait for profile.
  If u.id equals to "vip"
    Start profile as async fetchProfile(u.id).
  Otherwise
    Start profile as async fetchProfile(u.id).
  Return "Done".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".
`;

      const diagnostics = compileAndGetDiagnostics(source);
      const duplicateStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);
      const waitBeforeStart = diagnostics.filter(d => d.code === ErrorCode.ASYNC_WAIT_BEFORE_START);

      assert.equal(duplicateStart.length, 0, '互斥分支不再产生重复 Start 诊断');
      assert.equal(waitBeforeStart.length, 1, '应检测到 Wait-before-Start 顺序错误');
      assert.equal(waitBeforeStart[0]!.message.includes('profile'), true, '诊断应包含任务名 profile');
    });
  });
});
