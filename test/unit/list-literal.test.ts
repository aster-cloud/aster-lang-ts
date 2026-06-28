import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// ADR 0024 C0：列表字面量 [a, b, c] 端到端（parse → lower → eval）。
// 修复前 `[..]` 在 TS parser 报 "Unexpected expression"（parsePrimary 无 `[` 分支）。
function run(src: string, fn: string, ctx: Record<string, unknown>): unknown {
  const c = compile(src);
  assert.ok(c.core, `compile produced core; parseErrors=${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, fn, ctx);
  assert.ok(ev.success, `eval succeeded: ${ev.error ?? ''}`);
  return ev.value;
}

describe('ADR 0024 C0 — list literal', () => {
  it('list literal + List.length', () => {
    const v = run(
      `Module probe.\nRule sizeOf given seed as Int, produce Int:\n  Let xs be [10, 20, 30].\n  Return List.length(xs).\n`,
      'sizeOf', { seed: 0 });
    assert.equal(v, 3);
  });

  it('empty list literal', () => {
    const v = run(
      `Module probe.\nRule e given seed as Int, produce Int:\n  Return List.length([]).\n`,
      'e', { seed: 0 });
    assert.equal(v, 0);
  });

  it('list literal + List.get', () => {
    const v = run(
      `Module probe.\nRule g given seed as Int, produce Int:\n  Let xs be [5, 15, 25].\n  Return List.get(xs, 1).\n`,
      'g', { seed: 0 });
    assert.equal(v, 15);
  });

  it('list literal as a direct call argument', () => {
    const v = run(
      `Module probe.\nRule h given seed as Int, produce Int:\n  Return List.length([1, 2, 3, 4]).\n`,
      'h', { seed: 0 });
    assert.equal(v, 4);
  });
});
