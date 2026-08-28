import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate, serializeGuestValue } from '../../src/core/interpreter.js';

/**
 * Long 精确 64 位（issue aster-lang-ts#142）。
 *
 * ★真实缺陷：词法器专门用 BigInt 存字符串以保精度、并硬拒超 Int64 的字面量，
 * 但解释器求值时 `Number(expr.value)` 一步把精度丢回去：
 *
 *     9223372036854775807L  →  9223372036854776000   （差 193，静默错答案）
 *
 * 而 JVM 侧 `CoreModel.LongE public long value` 是精确 64 位——**同一源码两引擎
 * 运行值不同**。这是求值正确性问题，不是格式问题。
 */
function run(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}

function runErr(body: string): string {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, 'compile should succeed; the failure must come from evaluation');
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(!ev.success, 'expected evaluation to fail loudly');
  return String(ev.error ?? '');
}

describe('Long = 精确 64 位（BigInt 运行时表示）', () => {
  it('★Long.MAX_VALUE 逐位精确（此前得 9223372036854776000）', () => {
    assert.equal(run('Rule main produce Long:\n  Return 9223372036854775807L.'), 9223372036854775807n);
  });

  it('★MIN_VALUE 写成字面量会被词法层正确拒绝（不是缺陷）', () => {
    // -9223372036854775808L 在词法上是「一元负号 + 正字面量 9223372036854775808」，
    // 后者已超 Long.MAX → 词法层硬拒。这是既有的正确行为，测试钉住它以免日后被"修坏"。
    const c = compile('Module probe.\nRule main produce Long:\n  Return -9223372036854775808L.\n');
    const errs = JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? []);
    assert.match(errs, /out of range for Long/);
  });

  it('★可表达的最小负值仍逐位精确（经减法构造——前置负号在该语法位置不被接受）', () => {
    assert.equal(
      run('Rule main produce Long:\n  Return 0L minus 9223372036854775807L.'),
      -9223372036854775807n,
    );
  });

  it('★边界加法不溢出成浮点：MAX-1 + 1 == MAX', () => {
    // 这是最能暴露原缺陷的一条：两侧都在 2^53 之上，浮点会把它们塌成同一个值。
    assert.equal(run('Rule main produce Long:\n  Return 9223372036854775806L plus 1L.'), 9223372036854775807n);
  });

  it('★仅差 1 的两个大 Long 必须不相等（浮点下会塌成相等）', () => {
    assert.equal(
      run('Rule main produce Bool:\n  Return 9223372036854775806L equals to 9223372036854775807L.'),
      false,
    );
  });

  it('Long × Int 混算：整数 number 精确提升为 BigInt', () => {
    assert.equal(run('Rule main produce Long:\n  Return 100L times 3.'), 300n);
  });

  it('Long 除法向零截断（与 JVM long 除法一致）', () => {
    assert.equal(run('Rule main produce Long:\n  Return 10L integer divided by 3L.'), 3n);
    // 负数走 Let 绑定：`-10L` 直接作被除数在该语法位置不被解析器接受
    assert.equal(
      run('Rule main produce Long:\n  Let n be 0L minus 10L.\n  Return n integer divided by 3L.'),
      -3n,
    );
  });

  it('Long 取模', () => {
    assert.equal(run('Rule main produce Long:\n  Return 10L modulo 3L.'), 1n);
  });

  it('★除零响亮失败，不返回 Infinity', () => {
    assert.match(runErr('Rule main produce Long:\n  Return 1L integer divided by 0L.'), /Division by zero/);
  });

  it('★与非整数 Double 混算必须响亮失败，不静默降级', () => {
    // 静默把 Long 降成 double 正是本 issue 的病根，宁可失败。
    assert.match(
      runErr('Rule main produce Long:\n  Return 1L plus 1.5.'),
      /non-integer Double|expected Long\/Int/,
    );
  });

  it('★序列化为无引号十进制字面量（与 JVM Jackson 序列化 long 同形）', () => {
    // JSON.stringify(1n) 会抛 "Do not know how to serialize a BigInt"——
    // serializeGuestValue 必须在委托之前拦下，否则整条 dual-engine 链路崩。
    assert.equal(serializeGuestValue(9223372036854775807n), '9223372036854775807');
    assert.equal(serializeGuestValue(-9223372036854775808n), '-9223372036854775808');
  });

  it('★嵌套在结构里也能序列化（不走 JSON.stringify 兜底）', () => {
    assert.equal(serializeGuestValue([1n, 2n]), '[1,2]');
  });
});
