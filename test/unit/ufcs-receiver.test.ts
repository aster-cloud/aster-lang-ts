import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import type { Module as AstModule } from '../../src/types.js';

/**
 * UFCS（接收者转参数）：`value.sum(1, 2)` → `sum(value, 1, 2)`。
 *
 * <p>这是 Java 引擎有意设计的调用约定（`AstBuilder.applyCallSuffix`，由
 * `AstBuilderTest.testMethodCallTransformsReceiver` 钉住），TS 侧此前缺失，
 * 导致同一段源码在两个引擎上**实际传参个数不同**——不是表示差异，是行为差异：
 *
 * <pre>
 *   io.verify(user, pass)
 *     Java → Call(Name "verify",    [io, user, pass])   3 参
 *     TS   → Call(Name "io.verify", [user, pass])       2 参   ← 分叉
 * </pre>
 *
 * <p>★触发条件是 lexer 的 IDENT / TYPE_IDENT 之分，**不是**「首字母是否大写」：
 * ASCII 小写或下划线开头 → IDENT → 走 UFCS；其余（大写、CJK…）→ TYPE_IDENT → 不拆分。
 */

function callOf(expr: string): { target: string; args: unknown[] } {
  const src = `Module p.\n\nRule r, produce:\n  Return ${expr}.\n`;
  const ast = parse(lex(canonicalize(src))).ast as AstModule;
  const ir = JSON.parse(JSON.stringify(lowerModule(ast)));
  const call = ir.decls[0].body.statements[0].expr;
  return { target: call.target?.name, args: call.args };
}

describe('UFCS 接收者转参数（与 Java 引擎对齐）', () => {
  it('★小写接收者：`value.sum(1, 2)` → `sum(value, 1, 2)`', () => {
    const { target, args } = callOf('value.sum(1, 2)');

    assert.strictEqual(target, 'sum',
      '调用目标应是方法名 `sum`（接收者已转为首个实参）。');
    assert.strictEqual(args.length, 3,
      `实参应为 3 个（接收者 + 2 个原参），实际 ${args.length}`
      + '\n★若为 2，说明未做 UFCS，与 Java 引擎的实际传参个数不一致。');
    assert.strictEqual((args[0] as { name: string }).name, 'value',
      '首个实参应是接收者 `value`。');
  });

  it('多段限定名：接收者只取**首段**（`a.b.c(1)` → 方法 `b.c`，接收者 `a`）', () => {
    // 与 Java `combineName(null, pendingMembers)` 一致：除首段外全部并入方法名。
    const { target, args } = callOf('a.b.c(1)');

    assert.strictEqual(target, 'b.c', '方法名应是除首段外的全部段。');
    assert.strictEqual((args[0] as { name: string }).name, 'a', '接收者应只取首段。');
    assert.strictEqual(args.length, 2);
  });

  it('★大写接收者不拆分：`Text.concat(a, b)` 保持限定名', () => {
    // 反向守卫。没有这条，「UFCS」可以退化成「所有带点的名字都拆」——
    // 那会把 Text.concat / Http.get / Map.get 这些**类型/模块限定名**一并拆坏，
    // 而上面那条正向用例照样绿。
    const { target, args } = callOf('Text.concat(1, 2)');

    assert.strictEqual(target, 'Text.concat',
      '大写开头是类型/模块限定名，必须整体作为调用目标，不得拆分。');
    assert.strictEqual(args.length, 2, '实参应仍为 2 个（没有多塞接收者）。');
  });

  it('★`Map.get` 同样不拆分（Map 有独立 lexer token，易被漏掉）', () => {
    const { target, args } = callOf('Map.get(1, 2)');

    assert.strictEqual(target, 'Map.get');
    assert.strictEqual(args.length, 2);
  });

  it('无点的普通调用不受影响', () => {
    const { target, args } = callOf('sum(1, 2)');

    assert.strictEqual(target, 'sum');
    assert.strictEqual(args.length, 2, '无接收者可转，实参个数不应变化。');
  });

  it('★拆出的接收者与方法名都必须带 origin（否则在 OriginMap 里不可达）', () => {
    // 与 `Let "_"` 内层 Call 缺 origin 是同一类问题：节点没有位置信息时，
    // ADR 0032 的 trace 锚点与 ADR 0037 的双向导航都定位不到它——不报错，
    // 只是这段代码从导航里静默消失。
    const src = 'Module p.\n\nRule r, produce:\n  Return value.sum(1).\n';
    const ast = parse(lex(canonicalize(src))).ast as AstModule;
    const call = JSON.parse(JSON.stringify(lowerModule(ast)))
      .decls[0].body.statements[0].expr;

    assert.ok(call.target?.origin, '方法名节点缺少 origin。');
    assert.ok(call.args[0]?.origin, '接收者节点缺少 origin。');
  });
});
