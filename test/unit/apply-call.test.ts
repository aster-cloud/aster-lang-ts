import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';

// 无括号单参调用 `apply <fn> to <arg>`（ADR 0027）—— TS 引擎。lower 成与 `fn(arg)` **完全相同**
// 的 Call（零新 AST/Core IR 节点）；双引擎一致由 tier1-parity（g3-apply-call 样本）锁。
// 软关键词（Codex 审查 019f1639）：`apply` 仅在形如 `apply <名(.名)*> to` 时当调用引入词，
// 故 `Rule apply given …`（函数名 apply）+ `apply(x)` 不破；目标段放行集对齐 Java callTargetSegment。
initializeAllBundledLexicons();

function fingerprint(body: string): string {
  const c = compile(`Module probe.\n${body}\n`, { lexicon: EN_US });
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  return JSON.stringify(stripOrigin(c.core));
}
function compiles(body: string): boolean {
  return compile(`Module probe.\n${body}\n`, { lexicon: EN_US }).success;
}
function run(body: string, entry: string, ctx: Record<string, unknown>): unknown {
  const c = compile(`Module probe.\n${body}\n`, { lexicon: EN_US });
  assert.ok(c.success && c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, entry, ctx);
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}

describe('apply <fn> to <arg> — 无括号单参调用（ADR 0027）', () => {
  it('裸名 target：`apply double to x` ≡ `double(x)`', () => {
    assert.equal(
      fingerprint('Rule r given x:\n  Return apply double to x.'),
      fingerprint('Rule r given x:\n  Return double(x).'),
    );
  });

  it('贪婪 arg：`apply f to a plus 2` ≡ `f(a plus 2)`（非 `f(a) plus 2`）', () => {
    assert.equal(
      fingerprint('Rule r given a:\n  Return apply f to a plus 2.'),
      fingerprint('Rule r given a:\n  Return f(a plus 2).'),
    );
  });

  it('apply 在二元右操作数：`a plus apply f to b plus c` ≡ `a plus f(b plus c)`', () => {
    assert.equal(
      fingerprint('Rule r given a, b, c:\n  Return a plus apply f to b plus c.'),
      fingerprint('Rule r given a, b, c:\n  Return a plus f(b plus c).'),
    );
  });

  it('限定名 target：`apply Math.abs to x` ≡ `Math.abs(x)`；`apply Map.get to m` ≡ `Map.get(m)`', () => {
    assert.equal(
      fingerprint('Rule r given x:\n  Return apply Math.abs to x.'),
      fingerprint('Rule r given x:\n  Return Math.abs(x).'),
    );
    assert.equal(
      fingerprint('Rule r given m:\n  Return apply Map.get to m.'),
      fingerprint('Rule r given m:\n  Return Map.get(m).'),
    );
  });

  it('wrapper 构造一致：`apply Some to x` ≡ `Some(x)`、`apply Ok to x` ≡ `Ok(x)`', () => {
    assert.equal(
      fingerprint('Rule r given x:\n  Return apply Some to x.'),
      fingerprint('Rule r given x:\n  Return Some(x).'),
    );
    assert.equal(
      fingerprint('Rule r given x:\n  Return apply Ok to x.'),
      fingerprint('Rule r given x:\n  Return Ok(x).'),
    );
  });

  it('递归执行：`apply twice to seed plus 1` = twice(seed+1) = (seed+1)*2', () => {
    const body = 'Rule twice given n:\n  Return n times 2.\nRule run given seed:\n  Return apply twice to seed plus 1.';
    assert.equal(run(body, 'run', { seed: 4 }), 10);
    assert.equal(run(body, 'run', { seed: 0 }), 2);
  });

  it('软关键词不破：`Rule apply given x` + `apply(x)` 后缀调用仍工作', () => {
    assert.ok(compiles('Rule apply given x:\n  Return x plus 1.'), '函数名 apply 应可编译');
    assert.ok(
      compiles('Rule apply given x:\n  Return x.\nRule r given y:\n  Return apply(y).'),
      '`apply(y)` 后缀调用应可编译',
    );
  });

  it('软关键词作 target：`apply if to x` / `apply return to x` 接受（对齐 Java structKeywordName）', () => {
    assert.ok(compiles('Rule r given x:\n  Return apply if to x.'), '`apply if to x` 应接受');
    assert.ok(compiles('Rule r given x:\n  Return apply return to x.'), '`apply return to x` 应接受');
  });

  it('硬关键词作 target 拒绝：`apply and/or/with/given/set to x` 报错（对齐 Java，避免双引擎分歧）', () => {
    for (const kw of ['and', 'or', 'not', 'with', 'given', 'produce', 'set', 'to']) {
      assert.ok(!compiles(`Rule r given x:\n  Return apply ${kw} to x.`),
        `\`apply ${kw} to x\`（硬关键词作目标）应报错`);
    }
  });

  it('缺 to 报错：`apply f x`（无 to）不可编译', () => {
    assert.ok(!compiles('Rule r given x:\n  Return apply f x.'), '缺 to 的 apply 应报错');
  });
});

/** 剥离 origin（源码位置元数据，结构比较口径）。 */
function stripOrigin(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigin);
  if (o && typeof o === 'object') {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === 'origin') continue;
      r[k] = stripOrigin((o as Record<string, unknown>)[k]);
    }
    return r;
  }
  return o;
}
