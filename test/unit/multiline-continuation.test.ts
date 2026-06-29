import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';

// 等缩进多行表达式续行（ADR 0026）—— TS 引擎。续行（与语句起始行同缩进、二元运算符打头/结尾）
// 解析到与单行**完全相同**的 Core IR（零新节点）；双引擎一致由 tier1-parity（multiline_continuation
// 样本）锁。安全性（Codex 审查 019f157b）：只跨等缩进 NEWLINE，不碰 INDENT/DEDENT，块结构零风险。
initializeAllBundledLexicons();

function run(body: string, entry: string, ctx: Record<string, unknown>): unknown {
  const c = compile(`Module probe.\n${body}\n`, { lexicon: EN_US });
  assert.ok(c.success && c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, entry, ctx);
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}
function compiles(body: string): boolean {
  return compile(`Module probe.\n${body}\n`, { lexicon: EN_US }).success;
}
/** 剥 origin 的结构指纹，用于比较多行版 ≡ 单行版 Core IR。 */
function fingerprint(body: string): string {
  const c = compile(`Module probe.\n${body}\n`, { lexicon: EN_US });
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  return JSON.stringify(stripOrigin(c.core));
}
function stripOrigin(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigin);
  if (o && typeof o === 'object') {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === 'origin' || k === 'span') continue;
      r[k] = stripOrigin((o as Record<string, unknown>)[k]);
    }
    return r;
  }
  return o;
}

describe('ADR 0026 — 等缩进多行续行求值正确', () => {
  it('加法链跨行：a plus 10 plus 20 (a=5) = 35', () => {
    assert.equal(run('Rule total given a as Int, produce Int:\n  Return a\n  plus 10\n  plus 20.', 'total', { a: 5 }), 35);
  });
  it('字符串拼接跨行', () => {
    assert.equal(run('Rule g given name as Text, produce Text:\n  Return "Hello, "\n  plus name\n  plus "!".', 'g', { name: 'world' }), 'Hello, world!');
  });
  it('行尾运算符续行：a plus\\n 10', () => {
    assert.equal(run('Rule t given a as Int, produce Int:\n  Return a plus\n  10.', 't', { a: 5 }), 15);
  });
  it('乘法链跨行', () => {
    assert.equal(run('Rule s given a as Int, produce Int:\n  Return a\n  times 2\n  times 3.', 's', { a: 4 }), 24);
  });
  it('比较+逻辑跨行', () => {
    assert.equal(run('Rule r given x as Int, produce Bool:\n  Return x at least 1\n  and x at most 9.', 'r', { x: 5 }), true);
  });
});

describe('ADR 0026 — 多行版 ≡ 单行版 Core IR（纯解析层）', () => {
  it('加法链：多行与单行结构一致', () => {
    const ml = fingerprint('Rule total given a as Int, produce Int:\n  Return a\n  plus 10\n  plus 20.');
    const sl = fingerprint('Rule total given a as Int, produce Int:\n  Return a plus 10 plus 20.');
    assert.equal(ml, sl);
  });
});

describe('ADR 0026 — 边界（本批仅等缩进）', () => {
  it('更深缩进续行仍拒（本批不支持）', () => {
    assert.equal(compiles('Rule t given a as Int, produce Int:\n  Return a\n    plus 1.'), false);
  });
  it('不跨行续接第二个比较（不扩大 TS/Java 链式比较分歧）', () => {
    // Codex 审查 019f157b §5：Java comparisonExpr 单比较非链式。续行若跨行续接第二个比较会
    // 与 Java 分歧 → 故 `a < b\n< c` 多行链式比较不被续行接受（首个比较的行首/行尾续行仍支持）。
    assert.equal(compiles('Rule r given a as Int, produce Bool:\n  Return a less than 5\n  less than 10.'), false);
    // 但首个比较的行首续行仍可：`a\n< b`。
    assert.equal(run('Rule r given a as Int, produce Bool:\n  Return a\n  less than 10.', 'r', { a: 5 }), true);
  });

  it('块边界不被续行误并：两条独立语句', () => {
    const c = compile('Module probe.\nRule r given a as Int, produce Int:\n  Let m be a plus 1.\n  Return m.\n', { lexicon: EN_US });
    assert.ok(c.success && c.core);
    const fn = (c.core!.decls as Array<{ name?: string; body?: { statements: unknown[] } }>).find(d => d.name === 'r');
    assert.equal(fn?.body?.statements.length, 2, '应为两条独立语句');
  });
  it('续行不影响行内运算符链（无换行时行为不变）', () => {
    // 回归保护：单行运算符链照常工作，续行逻辑只在 NEWLINE 后命中，不干扰行内解析。
    assert.equal(run('Rule r given a as Int, produce Int:\n  Return a plus 1 plus 2 plus 3.', 'r', { a: 0 }), 6);
    // 注：前缀 operatorCall `+(a,b)` 是 Java-grammar-only 形（TS 本就不支持，见 Codex 审查
    // 019f157b 的双引擎差异），与本续行特性无关——续行只在 expr 循环内、NEWLINE 后触发。
  });
});
