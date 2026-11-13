import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import { controlRegistryFrom, defaultControlRegistry } from '../../../src/governance/controls.js';
import { parseSource, resolveAndLowerChecked } from '../../../src/compile-pipeline.js';
import { checkGovernance } from '../../../src/typecheck/governance.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { ControlRegistry } from '../../../src/governance/controls.js';
import type { Module as AstModule, TypecheckDiagnostic } from '../../../src/types.js';

// ADR 0046 §4：档案检查。场景与 Java ProfileCheckTest 逐条对应（源码、错误码、数量、消息子串一致）。

function diagnoseSource(src: string, controls?: ControlRegistry): TypecheckDiagnostic[] {
  const ast = parse(lex(canonicalize(src))).ast as AstModule;
  return typecheckModule(lowerModule(ast), controls ? { controls } : {});
}

/** 声明了档案的探针模块源码。 */
function profiled(id: string, body: string): string {
  return `Module probe.\nProfile "${id}".\n\n${body}\n`;
}

function count(d: readonly TypecheckDiagnostic[], code: ErrorCode): number {
  return d.filter((x) => x.code === code).length;
}

/** 拼接某错误码的全部消息，便于断言包含关系。 */
function messages(d: readonly TypecheckDiagnostic[], code: ErrorCode): string {
  return d.filter((x) => x.code === code).map((x) => x.message).join('\n');
}

const show = (d: readonly TypecheckDiagnostic[]): string => JSON.stringify(d.map(({ code, message }) => ({ code, message })));

test('未知档案报 E705', () => {
  const diags = diagnoseSource('Module m.\nProfile "nope".\n\nRule r produce Int:\n  Return 1.\n');
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_UNKNOWN), 1, show(diags));
  assert.ok(messages(diags, ErrorCode.GOV_PROFILE_UNKNOWN).includes("unknown profile 'nope' (controls registry 1.3.0)"));
  const e705 = diags.find((d) => d.code === ErrorCode.GOV_PROFILE_UNKNOWN)!;
  assert.equal(e705.span?.start.line, 1, 'E705 应定位到 Module 声明行');
});

test('缺 @id 报 E706 且 W700 照常', () => {
  const diags = diagnoseSource(profiled('governed', 'Rule r produce Verdict:\n  Return Verdict.allow().'));
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION), 1, show(diags));
  assert.equal(count(diags, ErrorCode.GOV_VERDICT_RULE_MISSING_ID), 1);
  assert.ok(messages(diags, ErrorCode.GOV_PROFILE_VIOLATION).includes("Rule 'r' violates profile 'governed': missing @id"));
  const e706 = diags.find((d) => d.code === ErrorCode.GOV_PROFILE_VIOLATION)!;
  assert.ok(e706.span !== undefined, 'E706 应定位到规则');
});

test('未登记控制点报 E706', () => {
  const diags = diagnoseSource(profiled('governed', '@id("R-1")\n@control("ACME:ART1")\nRule r produce Verdict:\n  Return Verdict.allow().'));
  assert.ok(messages(diags, ErrorCode.GOV_PROFILE_VIOLATION).includes('unregistered control ACME:ART1'), show(diags));
  assert.equal(count(diags, ErrorCode.GOV_CONTROL_UNREGISTERED), 1);
});

test('重复控制点每条要求只报一次', () => {
  const diags = diagnoseSource(
    profiled('governed', '@id("R-1")\n@control("ACME:ART1")\n@control("ACME:ART1")\nRule r produce Verdict:\n  Return Verdict.allow().')
  );
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION), 1, show(diags));
});

test('缺所需框架控制点报 E706', () => {
  const diags = diagnoseSource(
    profiled('eu-ai-act-high-risk', '@id("R-1")\n@control("GDPR:ART6")\nRule r produce Verdict:\n  Return Verdict.allow().')
  );
  assert.ok(messages(diags, ErrorCode.GOV_PROFILE_VIOLATION).includes('no registered control from framework EU_AI_ACT'), show(diags));
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION), 1);
});

test('合规规则零 E70x', () => {
  const diags = diagnoseSource(
    profiled('eu-ai-act-high-risk', '@id("R-1")\n@control("EU_AI_ACT:ART14")\nRule r produce Verdict:\n  Return Verdict.allow().')
  );
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION) + count(diags, ErrorCode.GOV_PROFILE_UNKNOWN), 0, show(diags));
});

test('非 Verdict 规则不受档案约束', () => {
  const diags = diagnoseSource(profiled('governed', 'Rule helper produce Int:\n  Return 1.'));
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION), 0, show(diags));
});

test('未声明档案的模块零 E70x', () => {
  const diags = diagnoseSource('Module m.\n\nRule r produce Verdict:\n  Return Verdict.allow().\n');
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION) + count(diags, ErrorCode.GOV_PROFILE_UNKNOWN), 0, show(diags));
});

test('未知档案下缺 @id 的 Verdict 规则只报 E705 与 W700', () => {
  const diags = diagnoseSource('Module m.\nProfile "nope".\n\nRule r produce Verdict:\n  Return Verdict.allow().\n');
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_UNKNOWN), 1, show(diags));
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION), 0, show(diags));
  assert.equal(count(diags, ErrorCode.GOV_VERDICT_RULE_MISSING_ID), 1, show(diags));
});

test('高风险档案下未登记的同框架键同时违反两条要求', () => {
  const diags = diagnoseSource(
    profiled('eu-ai-act-high-risk', '@id("R-1")\n@control("EU_AI_ACT:ART99")\nRule r produce Verdict:\n  Return Verdict.allow().')
  );
  const e706 = messages(diags, ErrorCode.GOV_PROFILE_VIOLATION);
  assert.ok(e706.includes('unregistered control EU_AI_ACT:ART99'), show(diags));
  assert.ok(e706.includes('no registered control from framework EU_AI_ACT'), show(diags));
  assert.equal(count(diags, ErrorCode.GOV_CONTROL_UNREGISTERED), 1, show(diags));
});

test('注入的注册表携带自定义档案与框架', () => {
  const custom = controlRegistryFrom({
    version: '9.9.9',
    // 档案引用的框架须在根 frameworks 中登记，否则档案不登记
    frameworks: [
      { id: 'ACME', title: { en: 'a', zh: 'a', de: 'a' } },
      { id: 'SOX', title: { en: 's', zh: 's', de: 's' } },
    ],
    controls: [
      { key: 'ACME:ART1', framework: 'ACME', article: '1', title: { en: 'a', zh: 'a', de: 'a' } },
      { key: 'acme:bad', framework: 'ACME', article: 'x', title: { en: 'b', zh: 'b', de: 'b' } },
    ],
    clauses: [],
    profiles: [
      { id: 'acme', title: { en: 'a', zh: 'a', de: 'a' }, requires: { ruleId: false, registeredControls: true, frameworks: ['ACME', 'SOX'] } },
    ],
  });
  const ok = diagnoseSource(profiled('acme', '@control("ACME:ART1")\nRule r produce Verdict:\n  Return Verdict.allow().'), custom);
  assert.equal(count(ok, ErrorCode.GOV_PROFILE_VIOLATION) + count(ok, ErrorCode.GOV_PROFILE_UNKNOWN), 0, show(ok));
  // 形态非法键即便在注入数据中登记也不算已登记，亦不覆盖框架
  const bad = diagnoseSource(profiled('acme', '@control("acme:bad")\nRule r produce Verdict:\n  Return Verdict.allow().'), custom);
  const e706 = messages(bad, ErrorCode.GOV_PROFILE_VIOLATION);
  assert.ok(e706.includes('unregistered control acme:bad'), show(bad));
  assert.ok(e706.includes('no registered control from framework ACME, SOX'), show(bad));
  // 默认档案在自定义注册表中不存在
  const unknown = diagnoseSource(profiled('governed', 'Rule h produce Int:\n  Return 1.'), custom);
  assert.ok(messages(unknown, ErrorCode.GOV_PROFILE_UNKNOWN).includes("unknown profile 'governed' (controls registry 9.9.9)"), show(unknown));
});

test('只含 version/has 的手写注册表视为无档案', () => {
  const minimal: ControlRegistry = { version: '0.1.0', has: (k) => defaultControlRegistry.has(k) };
  const diags = diagnoseSource(profiled('governed', '@id("R-1")\nRule r produce Verdict:\n  Return Verdict.allow().'), minimal);
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_UNKNOWN), 1, show(diags));
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_VIOLATION), 0, show(diags));
});

test('默认注册表含档案与框架归属', () => {
  assert.equal(defaultControlRegistry.version, '1.3.0');
  assert.deepEqual(defaultControlRegistry.profile?.('governed'), { id: 'governed', ruleId: true, registeredControls: true, frameworks: [], verifiedInputs: false });
  assert.equal(defaultControlRegistry.profile?.('eu-ai-act-high-risk')?.verifiedInputs, true);
  assert.deepEqual(defaultControlRegistry.profile?.('eu-ai-act-high-risk')?.frameworks, ['EU_AI_ACT']);
  assert.equal(defaultControlRegistry.profile?.('nope'), undefined);
  assert.equal(defaultControlRegistry.frameworkOf?.('EU_AI_ACT:ART14'), 'EU_AI_ACT');
});

test('缺 profiles 的输入视为空档案', () => {
  const r = controlRegistryFrom({
    version: '9',
    frameworks: [],
    controls: [{ key: 'A:B', framework: 'A', article: 'B', title: { en: 'a', zh: 'a', de: 'a' } }],
    clauses: [],
  });
  assert.equal(r.profile?.('governed'), undefined);
  assert.equal(r.has('A:B'), true);
});

test('浏览器类型检查路径同样报 E705', () => {
  const src = 'Module m.\nProfile "nope".\n\nRule r produce Int:\n  Return 1.\n';
  const core = lowerModule(parse(lex(canonicalize(src))).ast as AstModule);
  const diags = typecheckBrowser(core);
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_UNKNOWN), 1, show(diags));
  assert.ok(messages(diags, ErrorCode.GOV_PROFILE_UNKNOWN).includes("unknown profile 'nope' (controls registry 1.3.0)"));
});

// ---- ADR 0046 §11 D2 第 2 条：E708（注入要求 verifiedInputs 的注册表；与 Java ProfileCheckTest 同场景） ----

function registryRequiring(verifiedInputs: boolean): ControlRegistry {
  return controlRegistryFrom({
    version: 't',
    frameworks: [{ id: 'EU_AI_ACT', title: { en: 'a', zh: 'a', de: 'a' } }],
    controls: [{ key: 'EU_AI_ACT:ART14', framework: 'EU_AI_ACT', article: '14', title: { en: 'a', zh: 'a', de: 'a' } }],
    clauses: [],
    profiles: [{ id: 'hr', title: { en: 'a', zh: 'a', de: 'a' }, requires: { ruleId: true, registeredControls: true, frameworks: ['EU_AI_ACT'], verifiedInputs } }],
  });
}

const DYNAMIC_RULE = 'Define Req has action as Text, meta as Map Text to Text.\n\n'
  + '@id("R-1")\n@control("EU_AI_ACT:ART14")\nRule decide given req as Req, produce Verdict:\n'
  + '  If Map.get(req.meta, req.action) equals to "x":\n    Return Verdict.deny("d").\n'
  + '  Return Verdict.allow().\n\n'
  + '@id("R-2")\n@control("EU_AI_ACT:ART14")\nRule fine given req as Req, produce Verdict:\n'
  + '  If req.action equals to "x":\n    Return Verdict.deny("d").\n  Return Verdict.allow().';

function checkResolved(header: string, controls?: ControlRegistry): TypecheckDiagnostic[] {
  const parsed = parseSource(`Module m.\n${header}\n${DYNAMIC_RULE}\n`);
  return checkGovernance(resolveAndLowerChecked(parsed.ast).core, controls ? { controls } : {});
}

test('要求 verifiedInputs 时动态键规则报 E708', () => {
  const diags = checkResolved('Profile "hr".\n', registryRequiring(true));
  const e708 = diags.filter((d) => d.code === ErrorCode.GOV_PROFILE_INPUT_UNRESOLVABLE);
  assert.equal(e708.length, 1, show(diags));
  assert.deepEqual(e708[0]!.data, { rule: 'decide', profile: 'hr', construct: 'dynamic-map-key' });
  assert.equal(e708[0]!.message, "Rule 'decide' reads inputs that cannot be resolved statically (dynamic-map-key); profile 'hr' requires verified inputs");
  assert.equal(e708[0]!.severity, 'error');
  assert.ok(e708[0]!.span, 'E708 应定位到规则');
});

test('未声明档案不报 E708', () => {
  assert.equal(count(checkResolved('', registryRequiring(true)), ErrorCode.GOV_PROFILE_INPUT_UNRESOLVABLE), 0);
});

test('未知档案只报 E705 不报 E708', () => {
  const diags = checkResolved('Profile "nope".\n', registryRequiring(true));
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_UNKNOWN), 1, show(diags));
  assert.equal(count(diags, ErrorCode.GOV_PROFILE_INPUT_UNRESOLVABLE), 0);
});

test('档案不要求 verifiedInputs 时不报 E708', () => {
  assert.equal(count(checkResolved('Profile "hr".\n', registryRequiring(false)), ErrorCode.GOV_PROFILE_INPUT_UNRESOLVABLE), 0);
});

// registry 1.3.0（ADR 0046 §11.4 ⑦）：默认注册表的 eu-ai-act-high-risk 要求 verifiedInputs，governed 不要求。
test('默认注册表下高风险档案的动态键规则报 E708（defaultRegistryReportsE708ForHighRiskStarRule）', () => {
  const diags = checkResolved('Profile "eu-ai-act-high-risk".\n');
  const e708 = diags.filter((d) => d.code === ErrorCode.GOV_PROFILE_INPUT_UNRESOLVABLE);
  assert.equal(e708.length, 1, show(diags));
  assert.deepEqual(e708[0]!.data, { rule: 'decide', profile: 'eu-ai-act-high-risk', construct: 'dynamic-map-key' });
  assert.equal(e708[0]!.severity, 'error');
});

test('默认注册表下 governed 档案不报 E708', () => {
  assert.equal(count(checkResolved('Profile "governed".\n'), ErrorCode.GOV_PROFILE_INPUT_UNRESOLVABLE), 0);
});
