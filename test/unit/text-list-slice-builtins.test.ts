import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// 补齐 TS interpreter 与 truffle 对等的 Text.substring / Text.replace / List.slice。
//
// 这三个此前**只有 JVM 引擎有**（truffle Builtins.java:265/294/393），TS 侧缺失。
// 而 aster-lang.dev 的 stdlib 文档表格列出了它们、演练场又在浏览器里跑 TS 引擎，
// 于是用户照着文档抄就撞 "Undefined function 'Text.substring'"。
//
// ★越界行为必须与 Java 一致：Java 的 String.substring / List.subList 越界**抛异常**，
//   而 JS 的 String.substring / Array.slice 会静默钳制（"hello".substring(2,99) === "llo"）。
//   若直接套 JS 语义，同一段源码在两套引擎上会给出不同结果——静默的错误答案比
//   报错更危险，故这里显式抛错。下方"越界"用例就是锁这一点的。
function run(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}
/** 期望求值失败，并返回错误信息供断言。 */
function runErr(body: string): string {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, 'compile 应成功（越界是运行期错误，不是语法错误）');
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.equal(ev.success, false, '越界应当报错，而不是像 JS 那样静默钳制');
  return String(ev.error ?? '');
}
const T = (expr: string): string => `Rule main given seed as Int, produce Text:\n  Return ${expr}.`;
const L = (expr: string): string => `Rule main given seed as Int, produce List:\n  Return ${expr}.`;
const I = (expr: string): string => `Rule main given seed as Int, produce Int:\n  Return ${expr}.`;

describe('Text.substring / Text.replace / List.slice 双引擎对等补齐', () => {
  // 与 Java 实测逐条对齐："hello".substring(1)="ello"、substring(1,3)="el"
  it('Text.substring 省略 end', () => assert.equal(run(T('Text.substring("hello", 1)')), 'ello'));
  it('Text.substring 带 end', () => assert.equal(run(T('Text.substring("hello", 1, 3)')), 'el'));

  // Java: "hello".replace("l","L") = "heLLo"（替换**全部**出现处、按字面量非正则）。
  // JS 的 String.replace(string, …) 只替换第一处 → 必须 split/join 或 replaceAll。
  it('Text.replace 替换全部出现处', () => assert.equal(run(T('Text.replace("hello", "l", "L")')), 'heLLo'));
  it('Text.replace 按字面量而非正则', () =>
    assert.equal(run(T('Text.replace("a.b.c", ".", "-")')), 'a-b-c'));

  it('List.slice 带 end', () =>
    assert.equal(run(I('List.sum(List.slice(List.range(1, 6), 1, 3))')), 5)); // [2,3]
  it('List.slice 省略 end', () =>
    assert.equal(run(I('List.sum(List.slice(List.range(1, 6), 2))')), 12)); // [3,4,5]
  it('List.slice 返回新表且长度正确', () =>
    assert.equal(run(I('List.length(List.slice(List.range(1, 6), 1, 3))')), 2));

  // ★越界：Java 抛 StringIndexOutOfBounds / IndexOutOfBounds，故 TS 也必须抛。
  //   若实现退化成 JS 的静默钳制，下面三条会因 ev.success===true 而失败。
  it('Text.substring end 越界抛错（不静默钳制）', () =>
    assert.match(runErr(T('Text.substring("hello", 2, 99)')), /out of range/i));
  it('Text.substring 负索引抛错', () =>
    assert.match(runErr(T('Text.substring("hello", 0 minus 1)')), /out of range/i));
  it('List.slice end 越界抛错（不静默钳制）', () =>
    assert.match(runErr(L('List.slice(List.range(1, 4), 1, 99)')), /out of range/i));
});
