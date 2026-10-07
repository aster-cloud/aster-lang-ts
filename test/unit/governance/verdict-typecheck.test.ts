import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Module as AstModule } from '../../../src/types.js';

function diagnose(body: string): string[] {
  const src = `Module probe.\n${body}\n`;
  const ast = parse(lex(canonicalize(src))).ast as AstModule;
  const core = lowerModule(ast);
  return typecheckModule(core).map((d) => String(d.code));
}

test('produce Verdict 不被当成类型参数，allow 通过', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Verdict:\n  Return Verdict.allow().');
  assert.ok(!codes.includes(ErrorCode.RETURN_TYPE_MISMATCH), codes.join(','));
  assert.ok(!codes.includes(ErrorCode.EFF_INFER_UNKNOWN_BUILTIN), codes.join(','));
});

test('produce Bool 返回 Verdict 报 E003', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Bool:\n  Return Verdict.allow().');
  assert.ok(codes.includes(ErrorCode.RETURN_TYPE_MISMATCH), codes.join(','));
});

test('两个分支类型不一致报错', () => {
  // 两引擎均在 If 分支汇合处报不一致（与 Java 侧裁定一致），返回 then 分支类型
  const codes = diagnose('@id("R-1")\nRule main given x, produce Verdict:\n  If x equals to 1:\n    Return Verdict.allow().\n  Otherwise:\n    Return true.');
  assert.ok(
    codes.includes(ErrorCode.IF_BRANCH_MISMATCH) || codes.includes(ErrorCode.RETURN_TYPE_MISMATCH),
    codes.join(',')
  );
});

test('deny 缺参数报 E703', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Verdict:\n  Return Verdict.deny().');
  assert.ok(codes.includes(ErrorCode.GOV_VERDICT_CALL_ARITY), codes.join(','));
});

test('deny 非 Text 参数报类型不匹配', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Verdict:\n  Return Verdict.deny(42).');
  assert.ok(codes.includes(ErrorCode.TYPE_MISMATCH), codes.join(','));
});

test('require_approval 两个 Text 通过', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Verdict:\n  Return Verdict.require_approval("Senior Underwriter", "over cap").');
  assert.equal(codes.filter((c) => c.startsWith('E')).length, 0, codes.join(','));
});

// ===== Verdict 不可当布尔用（ADR 0039 §2.2，评审 C1；Java VerdictTypeCheckTest 镜像）=====

test('If 条件为 Verdict 报类型不匹配', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Text:\n  Let v be Verdict.deny("x").\n  If v:\n    Return "yes".\n  Return "no".');
  assert.ok(codes.includes(ErrorCode.TYPE_MISMATCH), codes.join(','));
});

test('not 作用于 Verdict 报类型不匹配', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Bool:\n  Let v be Verdict.deny("x").\n  Return not v.');
  assert.ok(codes.includes(ErrorCode.TYPE_MISMATCH), codes.join(','));
});

test('Verdict 与 true 相等比较报类型不匹配', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Bool:\n  Let v be Verdict.deny("x").\n  Return v equals to true.');
  assert.ok(codes.includes(ErrorCode.TYPE_MISMATCH), codes.join(','));
});

// ===== Text 形参可作 reason/role（评审 I1）=====

test('Text 形参作 reason 通过', () => {
  const codes = diagnose('@id("R-1")\nRule main given reason as Text, produce Verdict:\n  Return Verdict.deny(reason).');
  assert.equal(codes.filter((c) => c.startsWith('E')).length, 0, codes.join(','));
});

test('Text 形参作 role 与 reason 通过', () => {
  const codes = diagnose('@id("R-1")\nRule main given role as Text, reason as Text, produce Verdict:\n  Return Verdict.require_approval(role, reason).');
  assert.equal(codes.filter((c) => c.startsWith('E')).length, 0, codes.join(','));
});

test('个数不符时仍检查参数内未定义名', () => {
  const codes = diagnose('@id("R-1")\nRule main produce Verdict:\n  Return Verdict.allow(missing_name).');
  assert.ok(codes.includes(ErrorCode.GOV_VERDICT_CALL_ARITY), codes.join(','));
  assert.ok(codes.includes(ErrorCode.UNDEFINED_VARIABLE), codes.join(','));
});

// ===== Verdict 字段 outcome/role/reason 为 Text（评审 I2）=====

test('读取 outcome 得到 Text', () => {
  const codes = diagnose('Rule main produce Text:\n  Let d be Verdict.deny("x").\n  Return d.outcome.');
  assert.equal(codes.filter((c) => c.startsWith('E')).length, 0, codes.join(','));
});

test('Verdict 字段类型为 Text 而非 Unknown', () => {
  const codes = diagnose('Rule main produce Int:\n  Let d be Verdict.require_approval("r", "x").\n  Return d.role.');
  assert.ok(codes.includes(ErrorCode.RETURN_TYPE_MISMATCH), codes.join(','));
});

test('Verdict 未知字段仍报 E011', () => {
  const codes = diagnose('Rule main produce Text:\n  Let d be Verdict.deny("x").\n  Return d.verdict.');
  assert.ok(codes.includes(ErrorCode.UNKNOWN_FIELD), codes.join(','));
});
