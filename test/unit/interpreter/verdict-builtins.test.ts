import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../../src/browser.js';
import { evaluate } from '../../../src/core/interpreter.js';

function run(body: string, context: Record<string, unknown> = {}) {
  const m = compile(`Module probe.\n@id("R-1")\n${body}\n`);
  assert.ok(m.core, JSON.stringify(m));
  return evaluate(m.core!, 'main', context, { maxSteps: 10_000 });
}

test('allow 形状与键序', () => {
  const ev = run('Rule main produce Verdict:\n  Return Verdict.allow().');
  assert.equal(ev.success, true);
  assert.equal(JSON.stringify(ev.value), '{"__type":"Verdict","outcome":"ALLOW"}');
});
test('deny 带 reason', () => {
  const ev = run('Rule main produce Verdict:\n  Return Verdict.deny("no consent").');
  assert.equal(JSON.stringify(ev.value), '{"__type":"Verdict","outcome":"DENY","reason":"no consent"}');
});
test('require_approval 键序 role 在 reason 前', () => {
  const ev = run('Rule main produce Verdict:\n  Return Verdict.require_approval("Senior Underwriter", "over cap").');
  assert.equal(JSON.stringify(ev.value), '{"__type":"Verdict","outcome":"REQUIRE_APPROVAL","role":"Senior Underwriter","reason":"over cap"}');
});
test('escalate', () => {
  const ev = run('Rule main produce Verdict:\n  Return Verdict.escalate("low confidence").');
  assert.equal(JSON.stringify(ev.value), '{"__type":"Verdict","outcome":"ESCALATE","reason":"low confidence"}');
});
test('空 reason 运行时失败', () => {
  const ev = run('Rule main produce Verdict:\n  Return Verdict.deny("").');
  assert.equal(ev.success, false);
  assert.match(String(ev.error), /Verdict\.deny/);
});
test('reason 为非 Text 变量时运行时失败', () => {
  const ev = run('Rule main given n, produce Verdict:\n  Return Verdict.deny(n).', { n: 42 });
  assert.equal(ev.success, false);
  assert.match(String(ev.error), /Verdict\.deny/);
});
test('空白 reason/role 运行时失败', () => {
  const deny = run('Rule main produce Verdict:\n  Return Verdict.deny("   ").');
  assert.equal(deny.success, false);
  assert.match(String(deny.error), /Verdict\.deny: reason must not be empty/);
  const approval = run('Rule main given role as Text, produce Verdict:\n  Return Verdict.require_approval(role, "over cap").', { role: ' \t' });
  assert.equal(approval.success, false);
  assert.match(String(approval.error), /Verdict\.require_approval: role must not be empty/);
});

// ===== Verdict 在布尔上下文 fail-closed（ADR 0039 §2.2，评审 C1；truffle VerdictBuiltinsTest 镜像）=====
// 类型检查会拒绝这些程序；此处直接构造 Core IR 绕过检查器，验证运行时这道最后防线。
function runCore(statements: unknown[]) {
  const core = {
    kind: 'Module', name: 'probe', decls: [{
      kind: 'Func', name: 'main', typeParams: [], params: [], ret: { kind: 'TypeName', name: 'Text' },
      effects: [], effectCaps: [], effectCapsExplicit: false, body: { kind: 'Block', statements },
    }],
  };
  return evaluate(core as never, 'main', {}, { maxSteps: 10_000 });
}
const letDeny = { kind: 'Let', name: 'v', expr: { kind: 'Call', target: { kind: 'Name', name: 'Verdict.deny' }, args: [{ kind: 'String', value: 'no consent' }] } };
const ret = (value: string) => ({ kind: 'Return', expr: { kind: 'String', value } });

test('If 条件为 Verdict 时求值失败而非放行', () => {
  const ev = runCore([
    letDeny,
    { kind: 'If', cond: { kind: 'Name', name: 'v' }, thenBlock: { kind: 'Block', statements: [ret('approved')] }, elseBlock: null },
    ret('rejected'),
  ]);
  assert.equal(ev.success, false);
  assert.match(String(ev.error), /Verdict cannot be used as Bool/);
});

test('not 作用于 Verdict 时求值失败', () => {
  const ev = runCore([letDeny, { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'not' }, args: [{ kind: 'Name', name: 'v' }] } }]);
  assert.equal(ev.success, false);
  assert.match(String(ev.error), /Verdict cannot be used as Bool/);
});
