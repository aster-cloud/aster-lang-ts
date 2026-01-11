/**
 * @module test/unit/lexer/newline-handling.test
 *
 * 测试词法分析器对不同换行格式的处理：
 * - LF (`\n`) - Unix/Linux/macOS 标准换行
 * - CRLF (`\r\n`) - Windows 换行
 * - CR-only (`\r`) - 经典 Mac OS 换行
 *
 * 这些测试直接调用 lex()，绕过 canonicalizer（因为 canonicalizer 会统一转换换行符）
 */

import { describe, test, it } from 'node:test';
import assert from 'node:assert/strict';
import { lex } from '../../../src/frontend/lexer.js';
import { TokenKind } from '../../../src/types.js';
import type { Token } from '../../../src/types.js';

/**
 * 过滤掉 trivia 渠道的 token（如注释）
 */
function significant(tokens: readonly Token[]): readonly Token[] {
  return tokens.filter(token => token.channel !== 'trivia');
}

/**
 * 获取指定类型的 token
 */
function getTokensOfKind(
  tokens: readonly Token[],
  kind: TokenKind
): readonly Token[] {
  return tokens.filter(t => t.kind === kind);
}

describe('词法分析器换行格式处理', () => {
  describe('LF (\\n) - Unix 换行', () => {
    test('应该正确递增行号', () => {
      const source = 'a\nb\nc';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');
      const cToken = tokens.find(t => t.value === 'c');

      assert.ok(aToken, '应该找到 token a');
      assert.ok(bToken, '应该找到 token b');
      assert.ok(cToken, '应该找到 token c');

      assert.equal(aToken!.start.line, 1, 'a 应该在第 1 行');
      assert.equal(bToken!.start.line, 2, 'b 应该在第 2 行');
      assert.equal(cToken!.start.line, 3, 'c 应该在第 3 行');
    });

    test('应该在换行后重置列号', () => {
      const source = 'abc\nde';
      const tokens = significant(lex(source));

      const abcToken = tokens.find(t => t.value === 'abc');
      const deToken = tokens.find(t => t.value === 'de');

      assert.ok(abcToken, '应该找到 token abc');
      assert.ok(deToken, '应该找到 token de');

      assert.equal(abcToken!.start.col, 1, 'abc 应该从第 1 列开始');
      assert.equal(deToken!.start.col, 1, 'de 应该从第 1 列开始（换行后重置）');
    });

    test('应该生成 NEWLINE token', () => {
      const source = 'a\nb';
      const tokens = lex(source);
      const newlines = getTokensOfKind(tokens, TokenKind.NEWLINE);

      assert.equal(newlines.length, 1, '应该有 1 个 NEWLINE token');
    });
  });

  describe('CRLF (\\r\\n) - Windows 换行', () => {
    test('应该正确递增行号（不重复计数）', () => {
      const source = 'a\r\nb\r\nc';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');
      const cToken = tokens.find(t => t.value === 'c');

      assert.ok(aToken, '应该找到 token a');
      assert.ok(bToken, '应该找到 token b');
      assert.ok(cToken, '应该找到 token c');

      assert.equal(aToken!.start.line, 1, 'a 应该在第 1 行');
      assert.equal(bToken!.start.line, 2, 'b 应该在第 2 行（CRLF 只算一次换行）');
      assert.equal(cToken!.start.line, 3, 'c 应该在第 3 行');
    });

    test('应该在换行后重置列号', () => {
      const source = 'abc\r\nde';
      const tokens = significant(lex(source));

      const abcToken = tokens.find(t => t.value === 'abc');
      const deToken = tokens.find(t => t.value === 'de');

      assert.ok(abcToken, '应该找到 token abc');
      assert.ok(deToken, '应该找到 token de');

      assert.equal(abcToken!.start.col, 1, 'abc 应该从第 1 列开始');
      assert.equal(deToken!.start.col, 1, 'de 应该从第 1 列开始（CRLF 换行后重置）');
    });

    test('应该生成 NEWLINE token', () => {
      const source = 'a\r\nb';
      const tokens = lex(source);
      const newlines = getTokensOfKind(tokens, TokenKind.NEWLINE);

      assert.equal(newlines.length, 1, 'CRLF 应该生成 1 个 NEWLINE token');
    });
  });

  describe('CR-only (\\r) - 经典 Mac 换行', () => {
    test('应该正确递增行号', () => {
      const source = 'a\rb\rc';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');
      const cToken = tokens.find(t => t.value === 'c');

      assert.ok(aToken, '应该找到 token a');
      assert.ok(bToken, '应该找到 token b');
      assert.ok(cToken, '应该找到 token c');

      assert.equal(aToken!.start.line, 1, 'a 应该在第 1 行');
      assert.equal(bToken!.start.line, 2, 'b 应该在第 2 行（CR-only 视为换行）');
      assert.equal(cToken!.start.line, 3, 'c 应该在第 3 行');
    });

    test('应该在换行后重置列号', () => {
      const source = 'abc\rde';
      const tokens = significant(lex(source));

      const abcToken = tokens.find(t => t.value === 'abc');
      const deToken = tokens.find(t => t.value === 'de');

      assert.ok(abcToken, '应该找到 token abc');
      assert.ok(deToken, '应该找到 token de');

      assert.equal(abcToken!.start.col, 1, 'abc 应该从第 1 列开始');
      assert.equal(deToken!.start.col, 1, 'de 应该从第 1 列开始（CR 换行后重置）');
    });

    test('应该生成 NEWLINE token', () => {
      const source = 'a\rb';
      const tokens = lex(source);
      const newlines = getTokensOfKind(tokens, TokenKind.NEWLINE);

      assert.equal(newlines.length, 1, 'CR-only 应该生成 1 个 NEWLINE token');
    });
  });

  describe('混合换行格式', () => {
    test('应该正确处理 LF 和 CRLF 混合', () => {
      const source = 'a\nb\r\nc\nd';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');
      const cToken = tokens.find(t => t.value === 'c');
      const dToken = tokens.find(t => t.value === 'd');

      assert.equal(aToken!.start.line, 1);
      assert.equal(bToken!.start.line, 2);
      assert.equal(cToken!.start.line, 3);
      assert.equal(dToken!.start.line, 4);
    });

    test('应该正确处理 CR 和 LF 混合', () => {
      const source = 'a\rb\nc';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');
      const cToken = tokens.find(t => t.value === 'c');

      assert.equal(aToken!.start.line, 1);
      assert.equal(bToken!.start.line, 2);
      assert.equal(cToken!.start.line, 3);
    });

    test('应该正确处理三种换行格式混合', () => {
      // 按顺序: LF, CRLF, CR
      const source = 'a\nb\r\nc\rd';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');
      const cToken = tokens.find(t => t.value === 'c');
      const dToken = tokens.find(t => t.value === 'd');

      assert.equal(aToken!.start.line, 1, 'a 在第 1 行');
      assert.equal(bToken!.start.line, 2, 'b 在第 2 行（LF 后）');
      assert.equal(cToken!.start.line, 3, 'c 在第 3 行（CRLF 后）');
      assert.equal(dToken!.start.line, 4, 'd 在第 4 行（CR 后）');
    });
  });

  describe('边界场景', () => {
    test('应该处理文件以换行符开头', () => {
      const source = '\na';
      const tokens = significant(lex(source));
      const aToken = tokens.find(t => t.value === 'a');

      assert.ok(aToken);
      assert.equal(aToken!.start.line, 2, '换行后的 a 应该在第 2 行');
    });

    test('应该处理文件以换行符结尾', () => {
      const source = 'a\n';
      const tokens = significant(lex(source));
      const aToken = tokens.find(t => t.value === 'a');

      assert.ok(aToken);
      assert.equal(aToken!.start.line, 1);
    });

    test('应该处理连续多个 LF', () => {
      const source = 'a\n\n\nb';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');

      assert.equal(aToken!.start.line, 1);
      assert.equal(bToken!.start.line, 4, 'b 应该在第 4 行（3 个 LF 后）');
    });

    test('应该处理连续多个 CRLF', () => {
      const source = 'a\r\n\r\n\r\nb';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');

      assert.equal(aToken!.start.line, 1);
      assert.equal(bToken!.start.line, 4, 'b 应该在第 4 行（3 个 CRLF 后）');
    });

    test('应该处理连续多个 CR', () => {
      const source = 'a\r\r\rb';
      const tokens = significant(lex(source));

      const aToken = tokens.find(t => t.value === 'a');
      const bToken = tokens.find(t => t.value === 'b');

      assert.equal(aToken!.start.line, 1);
      assert.equal(bToken!.start.line, 4, 'b 应该在第 4 行（3 个 CR 后）');
    });

    test('应该正确处理字符串中的换行（不递增行号）', () => {
      // 字符串内的换行应该被保留但不影响词法分析的行号
      const source = '"line1\nline2"\na';
      const tokens = significant(lex(source));

      const stringToken = tokens.find(t => t.kind === TokenKind.STRING);
      const aToken = tokens.find(t => t.value === 'a');

      assert.ok(stringToken);
      // 字符串内的换行会被词法分析器的 next() 处理
      // 所以 a 的行号会受到影响
      assert.equal(aToken!.start.line, 3, 'a 应该在字符串换行后的正确位置');
    });

    test('应该正确处理空输入', () => {
      const tokens = lex('');
      assert.equal(tokens.length, 1, '空输入应该只有 EOF');
      assert.equal(tokens[0]!.kind, TokenKind.EOF);
    });

    test('应该正确处理只有换行的输入', () => {
      const lfOnly = lex('\n\n');
      const crlfOnly = lex('\r\n\r\n');
      const crOnly = lex('\r\r');

      // 每个应该有 NEWLINE tokens + EOF
      assert.ok(lfOnly.some(t => t.kind === TokenKind.NEWLINE));
      assert.ok(crlfOnly.some(t => t.kind === TokenKind.NEWLINE));
      assert.ok(crOnly.some(t => t.kind === TokenKind.NEWLINE));
    });
  });
});

describe('Token 区间一致性断言', () => {
  /**
   * 验证 token 的 start 和 end 位置是否合理：
   * - end.line >= start.line
   * - 如果在同一行，end.col >= start.col
   */
  function assertValidTokenSpan(token: Token): void {
    assert.ok(
      token.end.line >= token.start.line,
      `Token ${TokenKind[token.kind]} 的 end.line (${token.end.line}) 不应小于 start.line (${token.start.line})`
    );

    if (token.end.line === token.start.line) {
      assert.ok(
        token.end.col >= token.start.col,
        `Token ${TokenKind[token.kind]} 在同一行时，end.col (${token.end.col}) 不应小于 start.col (${token.start.col})`
      );
    }
  }

  /**
   * 验证连续 token 的位置关系（考虑 trivia 和不同行）
   */
  function assertTokenSequence(tokens: readonly Token[]): void {
    for (const token of tokens) {
      assertValidTokenSpan(token);
    }
  }

  test('单行代码的 token 区间应该有效', () => {
    const tokens = lex('a + b');
    assertTokenSequence(tokens);
  });

  test('多行代码的 token 区间应该有效', () => {
    const tokens = lex('a\nb\nc');
    assertTokenSequence(tokens);
  });

  test('带缩进的代码的 token 区间应该有效', () => {
    const source = `a
  b
    c
  d
e`;
    const tokens = lex(source);
    assertTokenSequence(tokens);
  });

  test('CRLF 换行的 token 区间应该有效', () => {
    const tokens = lex('a\r\nb\r\nc');
    assertTokenSequence(tokens);
  });

  test('CR-only 换行的 token 区间应该有效', () => {
    const tokens = lex('a\rb\rc');
    assertTokenSequence(tokens);
  });

  test('混合换行的 token 区间应该有效', () => {
    const tokens = lex('a\nb\r\nc\rd');
    assertTokenSequence(tokens);
  });

  test('带注释的代码的 token 区间应该有效', () => {
    const tokens = lex(`# comment
a
// another comment
b`);
    assertTokenSequence(tokens);
  });

  test('带字符串的代码的 token 区间应该有效', () => {
    const tokens = lex('"hello" + "world"');
    assertTokenSequence(tokens);
  });

  test('复杂表达式的 token 区间应该有效', () => {
    const tokens = lex('a + b * c - d / e');
    assertTokenSequence(tokens);
  });
});

describe('空行缩进处理 - CR/CRLF 格式', () => {
  /**
   * 测试空行（带空格）不会产生错误的 INDENT/DEDENT token
   * 这是 Codex 审查发现的 bug：line 211 只检查 \n，不处理 \r
   */
  test('LF 空行带空格不应产生 INDENT/DEDENT', () => {
    // 第一行 a，第二行是空行（带2个空格），第三行 b
    const source = 'a\n  \nb';
    const tokens = significant(lex(source));

    const indents = tokens.filter(t => t.kind === TokenKind.INDENT);
    const dedents = tokens.filter(t => t.kind === TokenKind.DEDENT);

    assert.equal(indents.length, 0, '空行不应产生 INDENT');
    assert.equal(dedents.length, 0, '空行不应产生 DEDENT');
  });

  test('CRLF 空行带空格不应产生 INDENT/DEDENT', () => {
    // 第一行 a，第二行是空行（带2个空格），第三行 b
    const source = 'a\r\n  \r\nb';
    const tokens = significant(lex(source));

    const indents = tokens.filter(t => t.kind === TokenKind.INDENT);
    const dedents = tokens.filter(t => t.kind === TokenKind.DEDENT);

    assert.equal(indents.length, 0, 'CRLF 空行不应产生 INDENT');
    assert.equal(dedents.length, 0, 'CRLF 空行不应产生 DEDENT');
  });

  test('CR-only 空行带空格不应产生 INDENT/DEDENT', () => {
    // 第一行 a，第二行是空行（带2个空格），第三行 b
    const source = 'a\r  \rb';
    const tokens = significant(lex(source));

    const indents = tokens.filter(t => t.kind === TokenKind.INDENT);
    const dedents = tokens.filter(t => t.kind === TokenKind.DEDENT);

    assert.equal(indents.length, 0, 'CR-only 空行不应产生 INDENT');
    assert.equal(dedents.length, 0, 'CR-only 空行不应产生 DEDENT');
  });

  test('混合换行格式的空行处理', () => {
    // LF 空行 + CRLF 空行 + CR 空行
    const source = 'a\n  \nb\r\n  \r\nc\r  \rd';
    const tokens = significant(lex(source));

    const aToken = tokens.find(t => t.value === 'a');
    const bToken = tokens.find(t => t.value === 'b');
    const cToken = tokens.find(t => t.value === 'c');
    const dToken = tokens.find(t => t.value === 'd');

    assert.ok(aToken && bToken && cToken && dToken, '应该找到所有标识符');

    // 验证行号正确递增
    assert.equal(aToken!.start.line, 1);
    assert.equal(bToken!.start.line, 3); // 跳过空行
    assert.equal(cToken!.start.line, 5); // 跳过空行
    assert.equal(dToken!.start.line, 7); // 跳过空行
  });
});

describe('运算符 token 位置', () => {
  /**
   * 测试 / token 的位置信息是否正确
   * 这是 Codex 审查发现的 bug：/ 没有在 next() 前保存 start 位置
   */
  test('/ token 应该有正确的 start 位置', () => {
    const source = 'a / b';
    const tokens = lex(source);

    const slashToken = tokens.find(t => t.kind === TokenKind.SLASH);
    assert.ok(slashToken, '应该找到 SLASH token');
    assert.equal(slashToken!.start.col, 3, '/ 应该从第 3 列开始');
    assert.equal(slashToken!.start.line, 1, '/ 应该在第 1 行');
  });

  test('多个 / token 应该有正确的位置', () => {
    const source = 'a / b / c';
    const tokens = lex(source);

    const slashTokens = tokens.filter(t => t.kind === TokenKind.SLASH);
    assert.equal(slashTokens.length, 2, '应该有 2 个 SLASH token');

    assert.equal(slashTokens[0]!.start.col, 3, '第一个 / 应该从第 3 列开始');
    assert.equal(slashTokens[1]!.start.col, 7, '第二个 / 应该从第 7 列开始');
  });

  test('/ 和 // 应该正确区分', () => {
    const source = 'a / b // comment';
    const tokens = lex(source);

    const slashTokens = tokens.filter(t => t.kind === TokenKind.SLASH);
    const commentTokens = tokens.filter(t => t.kind === TokenKind.COMMENT);

    assert.equal(slashTokens.length, 1, '应该只有 1 个 SLASH token');
    assert.equal(commentTokens.length, 1, '应该有 1 个 COMMENT token');

    assert.equal(slashTokens[0]!.start.col, 3, '/ 应该从第 3 列开始');
    assert.equal(commentTokens[0]!.start.col, 7, '// 应该从第 7 列开始');
  });

  test('换行后 / token 位置应该重置', () => {
    const source = 'a / b\nc / d';
    const tokens = lex(source);

    const slashTokens = tokens.filter(t => t.kind === TokenKind.SLASH);
    assert.equal(slashTokens.length, 2, '应该有 2 个 SLASH token');

    assert.equal(slashTokens[0]!.start.line, 1, '第一个 / 在第 1 行');
    assert.equal(slashTokens[0]!.start.col, 3, '第一个 / 在第 3 列');

    assert.equal(slashTokens[1]!.start.line, 2, '第二个 / 在第 2 行');
    assert.equal(slashTokens[1]!.start.col, 3, '第二个 / 在第 3 列');
  });
});
