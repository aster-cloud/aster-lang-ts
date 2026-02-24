import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { TypecheckDiagnostic } from '../../../src/types.js';

function runTypecheck(source: string): TypecheckDiagnostic[] {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  const ast = parse(tokens).ast;
  const core = lowerModule(ast);
  return typecheckModule(core);
}

function codes(diags: readonly TypecheckDiagnostic[]): ErrorCode[] {
  return diags.map(d => d.code);
}

describe('类型推导与诊断', () => {
  test('泛型恒等函数应该无诊断', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.identity.

Rule identity of T given value as T, produce T:
  Return value.
`);
    assert.equal(diagnostics.length, 0);
  });

  test('未使用的类型参数应该触发 TYPE_PARAM_UNUSED 告警', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.unused_type_param.

Rule constant of T given value as Int, produce Int:
  Return value.
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.TYPE_PARAM_UNUSED), true);
  });

  test('可变变量赋值类型不符应该触发 TYPE_MISMATCH_ASSIGN', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.assign_mismatch.

Rule demo, produce Int:
  Let counter be 1.
  Set counter to "x".
  Return counter.
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.TYPE_MISMATCH_ASSIGN), true);
  });

  test('返回类型不匹配应该触发 RETURN_TYPE_MISMATCH', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.return_mismatch.

Rule describe given value as Int, produce Text:
  Return value.
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.RETURN_TYPE_MISMATCH), true);
  });

  test('使用未定义变量应该触发 UNDEFINED_VARIABLE', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.undefined_var.

Rule badAccess, produce Int:
  Return missing.
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.UNDEFINED_VARIABLE), true);
  });

  test('Match 分支返回类型不一致应该触发 MATCH_BRANCH_MISMATCH', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.match_mismatch.

Define Result as one of Ok, Err.

Rule handle given outcome as Result, produce Int:
  Match outcome:
    When Ok, Return 1.
    When Err, Return "bad".
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.MATCH_BRANCH_MISMATCH), true);
  });

  test('未知字段应该触发 UNKNOWN_FIELD', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.unknown_field.

Define User has id as Text, name as Text.

Rule buildUser, produce User:
  Return User with id set to "42", nickname set to "Anon", name set to "Alice".
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.UNKNOWN_FIELD), true);
  });

  test('字段类型不匹配应该触发 FIELD_TYPE_MISMATCH', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.field_type.

Define User has id as Text, name as Text.

Rule buildUser, produce User:
  Return User with id set to 42, name set to "Alice".
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.FIELD_TYPE_MISMATCH), true);
  });

  test('缺失必填字段应该触发 MISSING_REQUIRED_FIELD', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.missing_field.

Define User has id as Text, name as Text.

Rule buildUser, produce User:
  Return User with id set to "42".
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.MISSING_REQUIRED_FIELD), true);
  });

  test('await 非 Maybe/Result 应该触发 AWAIT_TYPE', () => {
    const diagnostics = runTypecheck(`
Module test.typecheck.await_type.

Rule badAwait given value as Int, produce Int:
  Return await(value).
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.AWAIT_TYPE), true);
  });
});
