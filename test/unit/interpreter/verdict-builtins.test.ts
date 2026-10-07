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
