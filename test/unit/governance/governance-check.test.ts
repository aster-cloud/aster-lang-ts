import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import { compileAndTypecheck } from '../../../src/browser.js';
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

test('已登记控制点无 W704', () => {
  const codes = diagnose(`@id("R-1")\n@control("EU_AI_ACT:ART14")\n${VERDICT_RULE}`);
  assert.equal(codes.filter((c) => c === 'W704').length, 0, codes.join(','));
});

test('未登记与形态非法都报 W704，同键只报一次', () => {
  const codes = diagnose(`@id("R-1")\n@control("ACME:ART1")\n@control("ACME:ART1")\n@control("eu_ai_act:art14")\n${VERDICT_RULE}`);
  assert.equal(codes.filter((c) => c === 'W704').length, 2, codes.join(','));
});

test('注入空注册表时已登记键也报 W704', () => {
  const empty = { version: '0.0.0', has: () => false };
  const fn = handFunc('main', Core.Block([]), [
    { name: 'id', args: [{ name: '$0', value: 'R-1' }] },
    { name: 'control', args: [{ name: '$0', value: 'EU_AI_ACT:ART14' }] },
  ]);
  const diags = checkGovernance([fn], { controls: empty });
  assert.ok(diags.some((d) => d.code === 'W704'), JSON.stringify(diags));
});

test('注入的注册表沿 Node / 浏览器 / compileAndTypecheck 透传', () => {
  const empty = { version: '0.0.0', has: () => false };
  const body = `@id("R-1")\n@control("EU_AI_ACT:ART14")\n${VERDICT_RULE}`;
  const nodeCodes = typecheckModule(coreOf(body), { controls: empty }).map((d) => String(d.code));
  const browserCodes = typecheckBrowser(coreOf(body), { controls: empty }).map((d) => String(d.code));
  const compiled = compileAndTypecheck(`Module probe.\n${body}\n`, { controls: empty });
  const compiledCodes = compiled.typeErrors.map((d) => String(d.code));
  for (const codes of [nodeCodes, browserCodes, compiledCodes]) {
    assert.ok(codes.includes(ErrorCode.GOV_CONTROL_UNREGISTERED), codes.join(','));
  }
});

// 诊断黄金（ADR 0045 §3）：源文在 aster-lang-test tier3 type-checker 桶，期望在本仓 expected/；
// 既有 golden 回归脚本读 npm 版语料，新源文发布前读不到，故直读兄弟仓（本地 ../ 或 CI 子目录 ./）。
// 不走 CI 必失败规则：ci.yml 的 test job 不 checkout aster-lang-test（仅 parity job 有，但不跑单测），
// 故 CI 中恒跳过；待 aster-lang-test 发布含该源文的 npm 版本后改读 npm 语料即可在 CI 生效。
test('W704 诊断黄金与期望文件一致', (t) => {
  const name = 'governance_control_unregistered';
  const relative = ['corpus', 'tier3-fixtures', 'type-checker', `${name}.aster`];
  const source = [
    join(process.cwd(), '..', 'aster-lang-test', ...relative),
    join(process.cwd(), 'aster-lang-test', ...relative),
  ].find((c) => existsSync(c));
  if (source === undefined) {
    return t.skip('aster-lang-test 未并列 checkout（CI test job 不 checkout 它；npm 版语料尚无该源文）');
  }
  const ast = parse(lex(canonicalize(readFileSync(source, 'utf8')))).ast as AstModule;
  const actual = typecheckModule(lowerModule(ast)).map(({ code, severity, message }) => ({ code, severity, message }));
  const expectedPath = join(process.cwd(), 'test', 'type-checker', 'expected', `${name}.errors.json`);
  const expected = (JSON.parse(readFileSync(expectedPath, 'utf8')) as { diagnostics: unknown[] }).diagnostics;
  assert.deepEqual(actual, expected);
});
