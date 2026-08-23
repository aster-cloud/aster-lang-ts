import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';

// builtin 参数个数校验（aster-lang-ts#123）。
//
// 此前 TS 侧**完全不校验参数个数**，漏参会让 JS 的 `undefined` 一路渗进业务结果，
// 给出**静默错答案**而非报错：
//   Text.toUpper()   → "UNDEFINED"    （String(undefined).toUpperCase()）
//   Text.length()    → 9              （"undefined".length）
//   Text.concat("a") → "aundefined"   （字符串拼接）
// compile 与 evaluate 全部 success。而 truffle 侧有 92 处 checkArity 一律抛错——
// 同一段规则两引擎结果不同，直接违反「两引擎逐字节一致 + 可回放」这条第一约束。
//
// 参数个数表由 Builtins.java 的 checkArity 调用机械提取，与 JVM 侧同源。

initializeAllBundledLexicons();

/** 求值一个表达式，返回 `{ ok, value | error }`。 */
function run(expr: string): { ok: boolean; value?: unknown; error?: string } {
  const c = compile(`Module probe.\n\nRule f produce Text:\n  Return ${expr}.\n`, {
    lexicon: EN_US,
  });
  if (!c.success || !c.core) return { ok: false, error: 'compile failed' };
  const out = evaluate(c.core, 'f', {}) as { success: boolean; value?: unknown; error?: string };
  // exactOptionalPropertyTypes：error 可能是 undefined，需显式兜底而非直接透传。
  return out.success ? { ok: true, value: out.value } : { ok: false, error: out.error ?? '(无错误信息)' };
}

describe('builtin 参数个数校验', () => {
  // ★这四条正是 issue #123 里记录的静默错答案，逐条锁死。
  const silentWrongAnswers: ReadonlyArray<readonly [string, string]> = [
    ['Text.toUpper()', 'Text.toUpper: expected 1 args, got 0 args'],
    ['Text.length()', 'Text.length: expected 1 args, got 0 args'],
    ['Text.concat("a")', 'Text.concat: expected 2 args, got 1 args'],
    ['List.get(List.empty())', 'List.get: expected 2 args, got 1 args'],
  ];

  for (const [expr, expected] of silentWrongAnswers) {
    it(`${expr} 报错而非静默返回错答案`, () => {
      const r = run(expr);
      assert.equal(r.ok, false, `${expr} 应当失败，实际返回 ${JSON.stringify(r.value)}`);
      assert.equal(r.error, expected);
    });
  }

  it('多传参数同样被拒', () => {
    const r = run('Text.toUpper("a", "b")');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'Text.toUpper: expected 1 args, got 2 args');
  });

  // 可选尾参：truffle 里是 checkArity(name, args, min, max)，两端都必须放行。
  it('可变参数 builtin 在区间内均可用', () => {
    assert.deepEqual(run('Text.substring("abcdef", 1)'), { ok: true, value: 'bcdef' });
    assert.deepEqual(run('Text.substring("abcdef", 1, 3)'), { ok: true, value: 'bc' });
  });

  it('可变参数 builtin 越界仍被拒', () => {
    const r = run('Text.substring("abcdef")');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'Text.substring: expected 2-3 args, got 1 args');
  });

  // 零参 builtin 不能因为"传 0 个"就被误判。
  it('零参 builtin 正常工作', () => {
    assert.deepEqual(run('List.length(List.empty())'), { ok: true, value: 0 });
  });

  it('正常调用不受影响', () => {
    assert.deepEqual(run('Text.toUpper("hi")'), { ok: true, value: 'HI' });
    assert.deepEqual(run('Text.concat("a", "b")'), { ok: true, value: 'ab' });
    assert.deepEqual(run('Text.length("abc")'), { ok: true, value: 3 });
  });

  // 构造器走 evalExpr 的独立分支，不经过 evalStdlibCall——不能被本校验误伤。
  it('Some/Ok/Err 构造器不受参数个数表影响', () => {
    assert.deepEqual(run('Maybe.withDefault(Some(7), 0)'), { ok: true, value: 7 });
    assert.deepEqual(run('Result.unwrap(Ok(5))'), { ok: true, value: 5 });
  });

  // ★这条锁的是**本引擎的**时序，不是"与 truffle 一致"——两者恰好相反：
  // truffle 的 CallNode 先求值全部实参再进 BuiltinDef（checkArity 在 def 体内），
  // 故同一段源码 JVM 会先报 List.sum 的类型错。二者都拒绝该程序，但错误信息不同。
  // 时序对齐是独立议题（见 issue），此处只诚实记录现状，不假称 parity。
  it('本引擎在求值实参之前校验（与 truffle 时序相反，属已知差异）', () => {
    const r = run('Text.concat("a", "b", List.sum(1))');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'Text.concat: expected 2 args, got 3 args');
  });

  // 表只覆盖本引擎真正实现的 builtin：仅 JVM 有的名字必须如实报"不存在"，
  // 而不是抢先报 arity 错，把"没这个函数"说成"你参数写错了"。
  it('本引擎未实现的 builtin 如实报 Undefined function', () => {
    for (const expr of ['Text.redact("abc")', 'Text.redact()', 'IO.readLine()', 'PII.unwrap(1)']) {
      const r = run(expr);
      assert.equal(r.ok, false, `${expr} 应失败`);
      assert.match(r.error ?? '', /Undefined function/, `${expr} 应报"不存在"而非 arity 错，实际: ${r.error}`);
    }
  });
});
