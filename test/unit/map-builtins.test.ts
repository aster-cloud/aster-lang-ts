import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// 补齐 TS interpreter 与 truffle 对等的 Map.* （put/remove/keys/values）——
// 之前 TS 仅有 empty/get/contains/size，List.groupBy(...) 的 Map.values 链需要。
function run(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}
const R = (expr: string): string => `Rule main given seed as Int, produce Int:\n  Return ${expr}.`;

describe('Map.* 双引擎对等补齐', () => {
  it('Map.put then Map.get/size', () => assert.equal(run(R('Map.size(Map.put(Map.empty(), "a", 1))')), 1));
  it('Map.values length', () => assert.equal(run(R('List.length(Map.values(Map.put(Map.put(Map.empty(), "a", 1), "b", 2)))')), 2));
  it('Map.keys length', () => assert.equal(run(R('List.length(Map.keys(Map.put(Map.empty(), "a", 1)))')), 1));
  it('Map.remove', () => assert.equal(run(R('Map.size(Map.remove(Map.put(Map.empty(), "a", 1), "a"))')), 0));
});
