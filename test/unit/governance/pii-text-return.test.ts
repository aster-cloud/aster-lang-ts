import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { analyzePiiTextReturns } from '../../../src/governance/pii-text-return.js';
import type { Core as CoreTypes, Module as AstModule } from '../../../src/types.js';

// W709：@pii 输入字段流入返回的 Text（aster-cloud#772 方案 3）。逐例行为由共享夹具守护，这里只验接线与文案。

const APPLICANT = 'Define Applicant has name as @pii(L2, name) Text, city as Text.\n\n';
const GREET = `${APPLICANT}Rule greet given applicant as Applicant, produce Text:\n  Return "Hello, " + applicant.name.`;

function coreOf(body: string): CoreTypes.Module {
  const ast = parse(lex(canonicalize(`Module probe.\n\n${body}\n`))).ast as AstModule;
  return lowerModule(ast);
}

test('完整类型检查通道给出 W709 警告，文案含字段与规则', () => {
  const w709 = typecheckModule(coreOf(GREET)).filter((d) => d.code === ErrorCode.GOV_PII_RETURNED_AS_TEXT);
  assert.equal(w709.length, 1);
  assert.equal(w709[0]!.severity, 'warning');
  assert.equal(w709[0]!.message,
    "Rule 'greet' returns Text built from @pii field 'applicant.name'; the execution output is stored and shown unmasked");
  assert.ok(w709[0]!.help);
});

test('浏览器类型检查通道同样给出 W709', () => {
  const w709 = typecheckBrowser(coreOf(GREET)).filter((d) => d.code === ErrorCode.GOV_PII_RETURNED_AS_TEXT);
  assert.equal(w709.length, 1);
});

test('非 PII 字段不报', () => {
  const src = `${APPLICANT}Rule where given applicant as Applicant, produce Text:\n  Return "City: " + applicant.city.`;
  assert.equal(typecheckModule(coreOf(src)).filter((d) => d.code === ErrorCode.GOV_PII_RETURNED_AS_TEXT).length, 0);
});

test('只看声明类型：字段未标注 @pii 时不按名字猜测', () => {
  const core = coreOf('Define Applicant has name as Text.\n\nRule greet given applicant as Applicant, produce Text:\n  Return applicant.name.');
  const greet = core.decls.find((d): d is CoreTypes.Func => d.kind === 'Func')!;
  assert.deepEqual(analyzePiiTextReturns(core, greet), []);
});
