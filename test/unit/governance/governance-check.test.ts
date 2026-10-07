import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import { Core } from '../../../src/core/core_ir.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { checkGovernance, controls, returnsVerdict, ruleId } from '../../../src/typecheck/governance.js';
import type { Annotation, Core as CoreTypes, Module as AstModule, TypecheckDiagnostic } from '../../../src/types.js';

function coreOf(body: string): CoreTypes.Module {
  const src = `Module probe.\n${body}\n`;
  const ast = parse(lex(canonicalize(src))).ast as AstModule;
  return lowerModule(ast);
}

function diagnoseFull(body: string): TypecheckDiagnostic[] {
  return typecheckModule(coreOf(body));
}

function diagnose(body: string): string[] {
  return diagnoseFull(body).map((d) => String(d.code));
}

/** 手工构造一个规则函数，用于覆盖 CNL 语法难以产出的 Core 形态。 */
function handFunc(name: string, body: CoreTypes.Block, annotations: readonly Annotation[] = []): CoreTypes.Func {
  return Core.Func(name, [], [], Core.TypeName('Unknown'), [], body, [], false, undefined, undefined, annotations);
}

const VERDICT_RULE = 'Rule main produce Verdict:\n  Return Verdict.allow().';

test('返回 Verdict 且无 @id 报 W700', () => {
  assert.ok(diagnose(VERDICT_RULE).includes(ErrorCode.GOV_VERDICT_RULE_MISSING_ID));
});

test('未声明返回类型但返回 Verdict 调用也报 W700', () => {
  assert.ok(diagnose('Rule main produce:\n  Return Verdict.deny("no").').includes(ErrorCode.GOV_VERDICT_RULE_MISSING_ID));
});

test('有 @id 不报 W700', () => {
  assert.ok(!diagnose(`@id("R-1")\n${VERDICT_RULE}`).includes(ErrorCode.GOV_VERDICT_RULE_MISSING_ID));
});

test('返回 Bool 不报 W700', () => {
  assert.ok(!diagnose('Rule main produce Bool:\n  Return true.').includes(ErrorCode.GOV_VERDICT_RULE_MISSING_ID));
});

test('重复 @id 报恰好一个 E701，列出全部规则', () => {
  const diags = diagnoseFull(
    '@id("R-1")\nRule alpha produce Verdict:\n  Return Verdict.allow().\n\n@id("R-1")\nRule beta produce Verdict:\n  Return Verdict.allow().'
  );
  const dup = diags.filter((d) => d.code === ErrorCode.GOV_DUPLICATE_RULE_ID);
  assert.equal(dup.length, 1, diags.map((d) => d.code).join(','));
  assert.equal((dup[0]!.data as { rules: string }).rules, 'alpha, beta');
  assert.equal((dup[0]!.data as { id: string }).id, 'R-1');
});

test('@id 非字符串报 E702', () => {
  assert.ok(diagnose(`@id(42)\n${VERDICT_RULE}`).includes(ErrorCode.GOV_ANNOTATION_ARG_INVALID));
});

test('@id 命名参数报 E702', () => {
  assert.ok(diagnose(`@id(value: "R-1")\n${VERDICT_RULE}`).includes(ErrorCode.GOV_ANNOTATION_ARG_INVALID));
});

test('@control 可重复', () => {
  const codes = diagnose(`@id("R-1")\n@control("EU_AI_ACT:ART14")\n@control("GDPR:ART6")\n${VERDICT_RULE}`);
  assert.equal(codes.filter((c) => c === 'W700' || c === 'E701' || c === 'E702').length, 0, codes.join(','));
});

test('用户 Define Verdict 报 DUPLICATE_SYMBOL', () => {
  assert.ok(diagnose('Define Verdict has approved.\n\nRule main produce Bool:\n  Return true.').includes(ErrorCode.DUPLICATE_SYMBOL));
});

test('空白 @id("") 报 E702 且同时报 W700', () => {
  const codes = diagnose(`@id("")\n${VERDICT_RULE}`);
  assert.ok(codes.includes(ErrorCode.GOV_ANNOTATION_ARG_INVALID), codes.join(','));
  assert.ok(codes.includes(ErrorCode.GOV_VERDICT_RULE_MISSING_ID), codes.join(','));
});

test('同一规则多个 @id 报 E702，ruleId 为空', () => {
  const m = coreOf(`@id("A")\n@id("B")\n${VERDICT_RULE}`);
  const diags = typecheckModule(m);
  const e702 = diags.filter((d) => d.code === ErrorCode.GOV_ANNOTATION_ARG_INVALID);
  assert.equal(e702.length, 1, diags.map((d) => d.code).join(','));
  assert.equal((e702[0]!.data as { annotation: string }).annotation, 'id');
  const func = m.decls.find((d): d is CoreTypes.Func => d.kind === 'Func')!;
  assert.equal(ruleId(func), undefined);
});

test('@reason 非字符串报 E702', () => {
  const diags = diagnoseFull(`@id("R-1")\n@reason(42)\n${VERDICT_RULE}`);
  const e702 = diags.filter((d) => d.code === ErrorCode.GOV_ANNOTATION_ARG_INVALID);
  assert.equal(e702.length, 1, diags.map((d) => d.code).join(','));
  assert.equal((e702[0]!.data as { annotation: string }).annotation, 'reason');
});

test('ruleId / controls 读取合法注解值', () => {
  const m = coreOf(`@id("R-1")\n@control("EU_AI_ACT:ART14")\n@control("GDPR:ART6")\n@control("")\n${VERDICT_RULE}`);
  const func = m.decls.find((d): d is CoreTypes.Func => d.kind === 'Func')!;
  assert.equal(ruleId(func), 'R-1');
  assert.deepEqual(controls(func), ['EU_AI_ACT:ART14', 'GDPR:ART6']);
});

test('returnsVerdict 穿透 Block → Scope → Return（手工构造 Core IR）', () => {
  const ret = Core.Return(Core.Call(Core.Name('Verdict.deny'), [Core.String('no')]));
  const func = handFunc('main', Core.Block([Core.Scope([ret])]));
  assert.equal(returnsVerdict(func), true);
  const codes = checkGovernance([func]).map((d) => d.code);
  assert.deepEqual(codes, [ErrorCode.GOV_VERDICT_RULE_MISSING_ID]);
});

test('returnsVerdict 不经由变量判定', () => {
  const body = Core.Block([
    Core.Let('v', Core.Call(Core.Name('Verdict.allow'), [])),
    Core.Return(Core.Name('v')),
  ]);
  assert.equal(returnsVerdict(handFunc('main', body)), false);
});

test('注解 name 为 null/undefined 不抛异常', () => {
  const bogus = [{ name: null }, { name: undefined }] as unknown as Annotation[];
  const func = handFunc('main', Core.Block([Core.Return(Core.Bool(true))]), bogus);
  assert.doesNotThrow(() => checkGovernance([func]));
  assert.deepEqual(checkGovernance([func]), []);
  assert.equal(ruleId(func), undefined);
  assert.deepEqual(controls(func), []);
});

test('浏览器路径同样报 W700', () => {
  const codes = typecheckBrowser(coreOf(VERDICT_RULE)).map((d) => String(d.code));
  assert.ok(codes.includes(ErrorCode.GOV_VERDICT_RULE_MISSING_ID), codes.join(','));
});
