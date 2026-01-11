import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Token, Position } from '../../../src/types.js';
import { TokenKind, type Core } from '../../../src/types.js';
import { buildIdIndex, exprTypeText } from '../../../src/lsp/utils.js';

function makePos(line: number, col: number): Position {
  return { line, col };
}

function makeToken(kind: TokenKind, value: string, startCol?: number, endCol?: number): Token {
  const token: any = { kind, value };
  if (startCol !== undefined) {
    token.start = makePos(1, startCol);
  }
  if (endCol !== undefined) {
    token.end = makePos(1, endCol);
  }
  return token as Token;
}

const DEFAULT_ORIGIN = {
  start: makePos(1, 1),
  end: makePos(1, 1),
  file: 'test.aster',
};

function makeExpr(kind: string, name?: string): Core.Expression {
  switch (kind) {
    case 'String':
      return { kind: 'String', value: name ?? '文本', origin: DEFAULT_ORIGIN } as Core.String;
    case 'Int':
      return { kind: 'Int', value: Number.parseInt(name ?? '1', 10), origin: DEFAULT_ORIGIN } as Core.Int;
    case 'Long':
      return { kind: 'Long', value: name ?? '1', origin: DEFAULT_ORIGIN } as Core.Long;
    case 'Double':
      return { kind: 'Double', value: Number.parseFloat(name ?? '1.1'), origin: DEFAULT_ORIGIN } as Core.Double;
    case 'Float':
      return { kind: 'Float', value: Number.parseFloat(name ?? '1.2'), origin: DEFAULT_ORIGIN } as unknown as Core.Expression;
    case 'Bool':
      return { kind: 'Bool', value: name === 'true', origin: DEFAULT_ORIGIN } as Core.Bool;
    case 'Null':
      return { kind: 'Null', origin: DEFAULT_ORIGIN } as Core.Null;
    case 'Call':
      return {
        kind: 'Call',
        target: { kind: 'Name', name: name ?? '函数', origin: DEFAULT_ORIGIN } as Core.Name,
        args: [],
        origin: DEFAULT_ORIGIN,
      } as Core.Call;
    case 'Construct':
      return { kind: 'Construct', typeName: name ?? '类型', fields: [], origin: DEFAULT_ORIGIN } as Core.Construct;
    case 'Ok':
      return { kind: 'Ok', expr: makeExpr(name ?? 'String'), origin: DEFAULT_ORIGIN } as Core.Ok;
    case 'Err':
      return { kind: 'Err', expr: makeExpr(name ?? 'String'), origin: DEFAULT_ORIGIN } as Core.Err;
    case 'Some':
      return { kind: 'Some', expr: makeExpr(name ?? 'String'), origin: DEFAULT_ORIGIN } as Core.Some;
    case 'Name':
      return { kind: 'Name', name: name ?? '标识符', origin: DEFAULT_ORIGIN } as Core.Name;
    default:
      return { kind, origin: DEFAULT_ORIGIN } as Core.Expression;
  }
}

describe('buildIdIndex', () => {
  it('应该正确收集 IDENT 和 TYPE_IDENT token', () => {
    const tokens = [
      makeToken(TokenKind.IDENT, 'foo', 1, 2),
      makeToken(TokenKind.TYPE_IDENT, 'Bar', 3, 4),
      makeToken(TokenKind.STRING, '文本', 5, 6),
    ];
    const index = buildIdIndex(tokens);
    const foo = index.get('foo');
    const bar = index.get('Bar');

    assert.strictEqual(index.size, 2);
    assert.ok(foo);
    assert.ok(bar);
    assert.deepStrictEqual(foo?.[0], { start: makePos(1, 1), end: makePos(1, 2) });
    assert.deepStrictEqual(bar?.[0], { start: makePos(1, 3), end: makePos(1, 4) });
  });

  it('应该过滤 trivia token', () => {
    const trivia = makeToken(TokenKind.IDENT, '跳过', 1, 2);
    (trivia as any).channel = 'trivia';
    const tokens = [trivia, makeToken(TokenKind.IDENT, '有效', 3, 4)];
    const index = buildIdIndex(tokens);

    assert.strictEqual(index.size, 1);
    assert.ok(index.has('有效'));
    assert.ok(!index.has('跳过'));
  });

  it('应该处理缺少 start 或 end 的 token', () => {
    const noStart = makeToken(TokenKind.IDENT, 'ghost', undefined, 4);
    const noEnd = makeToken(TokenKind.TYPE_IDENT, 'Phantom', 5);
    const valid = makeToken(TokenKind.IDENT, 'stable', 6, 7);

    const tokens = [noStart, noEnd, valid];
    const index = buildIdIndex(tokens);

    assert.strictEqual(index.size, 1);
    assert.ok(index.has('stable'));
  });

  it('应该保持标识符出现顺序', () => {
    const tokens = [
      makeToken(TokenKind.IDENT, 'alpha', 1, 2),
      makeToken(TokenKind.TYPE_IDENT, 'Beta', 2, 3),
      makeToken(TokenKind.IDENT, 'gamma', 4, 5),
    ];
    const index = buildIdIndex(tokens);

    assert.deepStrictEqual(Array.from(index.keys()), ['alpha', 'Beta', 'gamma']);
  });

  it('应该处理重复标识符（产生多个Span）', () => {
    const tokens = [
      makeToken(TokenKind.IDENT, 'dup', 1, 2),
      makeToken(TokenKind.IDENT, 'dup', 3, 4),
      makeToken(TokenKind.IDENT, 'dup', 5, 6),
    ];
    const index = buildIdIndex(tokens);
    const spans = index.get('dup');

    assert.ok(spans);
    assert.strictEqual(spans?.length, 3);
    assert.deepStrictEqual(spans?.[0], { start: makePos(1, 1), end: makePos(1, 2) });
    assert.deepStrictEqual(spans?.[1], { start: makePos(1, 3), end: makePos(1, 4) });
    assert.deepStrictEqual(spans?.[2], { start: makePos(1, 5), end: makePos(1, 6) });
  });

  it('应该处理空 token 列表', () => {
    const index = buildIdIndex([]);
    assert.strictEqual(index.size, 0);
  });

  it('应该处理只有非标识符 token 的列表', () => {
    const tokens = [
      makeToken(TokenKind.STRING, '文本', 1, 2),
      makeToken(TokenKind.INT, '1', 3, 4),
    ];
    const index = buildIdIndex(tokens);
    assert.strictEqual(index.size, 0);
  });
});

describe('exprTypeText', () => {
  it('应该正确处理 Call 表达式', () => {
    const textConcat = makeExpr('Call', 'Text.concat');
    const addCall = makeExpr('Call', '+');
    const unknownCall = makeExpr('Call', 'mystery');

    assert.strictEqual(exprTypeText(textConcat), 'Text');
    assert.strictEqual(exprTypeText(addCall), 'Int');
    assert.strictEqual(exprTypeText(unknownCall), 'Unknown');
  });

  it('应该正确处理 Construct 表达式', () => {
    const construct = makeExpr('Construct', 'User');
    assert.strictEqual(exprTypeText(construct), 'User');
  });

  it('应该正确处理 Ok 表达式', () => {
    const okExpr = makeExpr('Ok', 'String');
    assert.strictEqual(exprTypeText(okExpr), 'Result<Text, Unknown>');
  });

  it('应该正确处理 Err 表达式', () => {
    const errExpr = makeExpr('Err', 'String');
    assert.strictEqual(exprTypeText(errExpr), 'Result<Unknown, Text>');
  });

  it('应该正确处理 Some 表达式', () => {
    const someExpr = makeExpr('Some', 'String');
    assert.strictEqual(exprTypeText(someExpr), 'Option<Text>');
  });

  it('应该正确处理各种数值字面量', () => {
    const intExpr = makeExpr('Int');
    const longExpr = makeExpr('Long');
    const floatExpr = makeExpr('Float');
    const doubleExpr = makeExpr('Double');

    assert.strictEqual(exprTypeText(intExpr), 'Int');
    assert.strictEqual(exprTypeText(longExpr), 'Long');
    assert.strictEqual(exprTypeText(floatExpr), 'Unknown');
    assert.strictEqual(exprTypeText(doubleExpr), 'Double');
  });

  it('应该正确处理 Text、Char、Bool 字面量', () => {
    const textExpr = makeExpr('String');
    const charExpr = { kind: 'Char', value: 'c', origin: DEFAULT_ORIGIN } as unknown as Core.Expression;
    const boolExpr = makeExpr('Bool', 'true');

    assert.strictEqual(exprTypeText(textExpr), 'Text');
    assert.strictEqual(exprTypeText(charExpr), 'Unknown');
    assert.strictEqual(exprTypeText(boolExpr), 'Bool');
  });

  it('应该处理未知表达式类型', () => {
    const lambdaExpr = { kind: 'Lambda', origin: DEFAULT_ORIGIN } as Core.Expression;
    const nullExpr = makeExpr('Null');
    const nameExpr = makeExpr('Name', 'x');

    assert.strictEqual(exprTypeText(lambdaExpr), 'Unknown');
    assert.strictEqual(exprTypeText(nullExpr), 'Unknown');
    assert.strictEqual(exprTypeText(nameExpr), 'Unknown');
  });
});
