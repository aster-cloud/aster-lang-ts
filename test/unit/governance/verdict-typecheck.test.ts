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
