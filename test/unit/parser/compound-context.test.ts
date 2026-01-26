/**
 * @module tests/unit/parser/compound-context.test
 *
 * Parser 复合上下文测试 - 验证复合关键词模式的上下文跟踪。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createParserContext } from '../../../src/parser/context.js';
import { TokenKind } from '../../../src/frontend/tokens.js';
import { KW } from '../../../src/frontend/tokens.js';
import type { Token } from '../../../src/types.js';

/**
 * 创建模拟 token 数组用于测试
 */
function createMockTokens(): Token[] {
  const pos = { line: 1, col: 1 };
  return [
    { kind: TokenKind.EOF, start: pos, end: pos, value: null },
  ];
}

describe('Parser Compound Context', () => {
  it('应正确跟踪复合模式上下文', () => {
    const ctx = createParserContext(createMockTokens());

    // 初始状态：不在任何复合上下文中
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), false);

    // 进入 match 上下文
    ctx.pushCompoundContext(KW.MATCH);
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), true);

    // 退出 match 上下文
    ctx.popCompoundContext();
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), false);
  });

  it('应支持嵌套上下文', () => {
    const ctx = createParserContext(createMockTokens());

    // 进入 match 上下文
    ctx.pushCompoundContext(KW.MATCH);
    // 进入 if 上下文（嵌套）
    ctx.pushCompoundContext(KW.IF);

    // 两个上下文都应处于活动状态
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), true);
    assert.strictEqual(ctx.inCompoundContext(KW.IF), true);

    // 退出 if 上下文
    ctx.popCompoundContext();
    assert.strictEqual(ctx.inCompoundContext(KW.IF), false);
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), true);

    // 退出 match 上下文
    ctx.popCompoundContext();
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), false);
  });

  it('应正确处理空栈弹出', () => {
    const ctx = createParserContext(createMockTokens());

    // 空栈弹出不应抛出异常
    ctx.popCompoundContext();
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), false);
  });

  it('compoundContextStack 应可直接访问', () => {
    const ctx = createParserContext(createMockTokens());

    // 验证初始状态
    assert.strictEqual(ctx.compoundContextStack.length, 0);

    // 添加上下文
    ctx.pushCompoundContext(KW.MATCH);
    assert.strictEqual(ctx.compoundContextStack.length, 1);
    assert.strictEqual(ctx.compoundContextStack[0], KW.MATCH);

    // 嵌套上下文
    ctx.pushCompoundContext(KW.IF);
    assert.strictEqual(ctx.compoundContextStack.length, 2);
    assert.strictEqual(ctx.compoundContextStack[1], KW.IF);
  });

  it('应在多次进入同一上下文时正确跟踪', () => {
    const ctx = createParserContext(createMockTokens());

    // 进入 match 上下文两次
    ctx.pushCompoundContext(KW.MATCH);
    ctx.pushCompoundContext(KW.MATCH);

    assert.strictEqual(ctx.compoundContextStack.length, 2);
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), true);

    // 退出一次
    ctx.popCompoundContext();
    assert.strictEqual(ctx.compoundContextStack.length, 1);
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), true);

    // 再退出一次
    ctx.popCompoundContext();
    assert.strictEqual(ctx.compoundContextStack.length, 0);
    assert.strictEqual(ctx.inCompoundContext(KW.MATCH), false);
  });
});
