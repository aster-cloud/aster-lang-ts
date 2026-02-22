/**
 * 异步调度顺序检查
 *
 * 聚焦 Wait-before-Start 诊断，验证控制流敏感的调度逻辑。
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

function compileAndGetDiagnostics(source: string): Array<{ severity: string; message: string; code?: string }> {
  try {
    const canonical = canonicalize(source);
    const tokens = lex(canonical);
    const ast = parse(tokens) as AstModule;
    const core = lowerModule(ast);
    return typecheckModule(core);
  } catch (error) {
    return [{ severity: 'error', message: (error as Error).message }];
  }
}

describe('异步调度 - Wait-before-Start', () => {
  it('应检测 Wait 在 Start 之前', () => {
    const source = `
Module test.async.schedule.wait_before_start.simple.

Define User has id as Text.

Rule orchestrate given u as User, produce Text. It performs io:
  Wait for job.
  Start job as async launch(u.id).
  Wait for job.
  Return "Done".

Rule launch given id as Text, produce Text. It performs io:
  Return "job".
`;

    const diagnostics = compileAndGetDiagnostics(source);
    const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_WAIT_BEFORE_START);

    assert.equal(errors.length, 1, '应该产生 1 个 Wait-before-Start 错误');
    assert.ok(errors[0]!.message.includes('job'), '错误消息应该包含任务名 job');
  });

  it('不应报错在 Start 之后正常 Wait', () => {
    const source = `
Module test.async.schedule.wait_after_start.

Define User has id as Text.

Rule orchestrate given u as User, produce Text. It performs io:
  Start task as async launch(u.id).
  Wait for task.
  Return "Done".

Rule launch given id as Text, produce Text. It performs io:
  Return "ok".
`;

    const diagnostics = compileAndGetDiagnostics(source);
    const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_WAIT_BEFORE_START);

    assert.equal(errors.length, 0, '正常顺序不应产生 Wait-before-Start 错误');
  });

  it('应检测嵌套块中的顺序违规', () => {
    const source = `
Module test.async.schedule.wait_in_branch.

Rule orchestrate given enabled as Bool, produce Text. It performs io:
  If enabled
    Wait for task.
  Start task as async launch().
  Wait for task.
  Return "Done".

Rule launch produce Text. It performs io:
  Return "ok".
`;

    const diagnostics = compileAndGetDiagnostics(source);
    const errors = diagnostics.filter(d => d.severity === 'error' && d.code === ErrorCode.ASYNC_WAIT_BEFORE_START);

    assert.equal(errors.length, 1, '嵌套块中的提前 Wait 应被检测');
    assert.ok(errors[0]!.message.includes('task'), '错误消息应该包含任务名 task');
  });
});

describe('异步调度 - 条件分支', () => {
  it('不应误报 If 互斥分支的重复 Start', () => {
    const source = `
Module test.async.schedule.if_branch.

Rule orchestrate given tier as Text, produce Text. It performs io:
  If tier equals to "vip"
    Start session as async startVip().
  Otherwise
    Start session as async startStandard().
  Wait for session.
  Return "Done".

Rule startVip produce Text. It performs io:
  Return "vip".

Rule startStandard produce Text. It performs io:
  Return "standard".
`;

    const diagnostics = compileAndGetDiagnostics(source);
    const duplicateStarts = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);

    assert.equal(duplicateStarts.length, 0, '互斥分支不应产生重复 Start 错误');
  });

  it('不应误报 Match 互斥分支的重复 Start', () => {
    const source = `
Module test.async.schedule.match_branch.

Define Choice as one of Primary, Secondary.

Rule orchestrate given choice as Choice, produce Text. It performs io:
  Match choice:
    When Primary:
      Start session as async startPrimary().
    When Secondary:
      Start session as async startSecondary().
  Wait for session.
  Return "Done".

Rule startPrimary produce Text. It performs io:
  Return "primary".

Rule startSecondary produce Text. It performs io:
  Return "secondary".
`;

    const diagnostics = compileAndGetDiagnostics(source);
    const duplicateStarts = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);

    assert.equal(duplicateStarts.length, 0, 'Match 互斥分支不应产生重复 Start 错误');
  });

  it('应报告同一执行路径上的重复 Start', () => {
    const source = `
Module test.async.schedule.duplicate_start.path.

Rule orchestrate produce Text. It performs io:
  Start session as async startOne().
  Start session as async startTwo().
  Wait for session.
  Return "Done".

Rule startOne produce Text. It performs io:
  Return "one".

Rule startTwo produce Text. It performs io:
  Return "two".
`;

    const diagnostics = compileAndGetDiagnostics(source);
    const duplicateStarts = diagnostics.filter(d => d.code === ErrorCode.ASYNC_DUPLICATE_START);

    assert.equal(duplicateStarts.length, 1, '同一路径上的重复 Start 应被检测');
    assert.ok(duplicateStarts[0]!.message.includes('session'), '诊断应指向 session 任务');
  });
});
