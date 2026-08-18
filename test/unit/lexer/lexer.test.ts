import { describe, test, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { TokenKind, isCommentToken } from '../../../src/types.js';
import type { Token } from '../../../src/types.js';

function tokenize(source: string): readonly Token[] {
  const canonical = canonicalize(source);
  return lex(canonical);
}

function significant(tokens: readonly Token[]): readonly Token[] {
  return tokens.filter(token => token.channel !== 'trivia');
}

describe('词法分析器', () => {
  test('应该识别模块声明中的标识符序列', () => {
    const tokens = significant(
      tokenize(`
Module test.lexer.basic.
`)
    );
    const words = tokens
      .filter(t => t.kind === TokenKind.IDENT || t.kind === TokenKind.TYPE_IDENT)
      .map(t => (t.value as string).toLowerCase());

    assert.deepEqual(words.slice(0, 1), ['module']);
    assert.equal(tokens.some(t => t.kind === TokenKind.DOT), true, '模块名应该拆分出 DOT');
  });

  test('应该识别整数、浮点数与长整型字面量', () => {
    const tokens = significant(tokenize('Return 42 3.14 9l.'));
    const intToken = tokens.find(t => t.kind === TokenKind.INT);
    const floatToken = tokens.find(t => t.kind === TokenKind.FLOAT);
    const longToken = tokens.find(t => t.kind === TokenKind.LONG);

    assert.equal(intToken?.value, 42);
    assert.equal(floatToken?.value, 3.14);
    // Long literals now use string to preserve precision for values > Number.MAX_SAFE_INTEGER
    assert.equal(longToken?.value, '9');
  });

  test('应该识别字符串字面量并保留内容', () => {
    const tokens = significant(tokenize('Return "Aster test".'));
    const strToken = tokens.find(t => t.kind === TokenKind.STRING);

    assert.equal(strToken?.value, 'Aster test');
  });

  test('应该识别布尔与 null 关键字', () => {
    const tokens = significant(tokenize('Return true false null.'));
    const boolValues = tokens.filter(t => t.kind === TokenKind.BOOL).map(t => t.value);
    const nullToken = tokens.find(t => t.kind === TokenKind.NULL);

    assert.deepEqual(boolValues, [true, false]);
    assert.equal(nullToken?.value, null);
  });

  test('应该跟踪换行与缩进生成 INDENT/DEDENT', () => {
    const tokens = significant(
      tokenize(`
Rule sample, produce Int:
  Return 1.
`)
    );
    const indentCount = tokens.filter(t => t.kind === TokenKind.INDENT).length;
    const dedentCount = tokens.filter(t => t.kind === TokenKind.DEDENT).length;

    assert.equal(indentCount, 1, '函数体首行应该生成一次 INDENT');
    assert.equal(dedentCount, 1, '函数体结束前应该生成一次 DEDENT');
  });

  test('应该为 token 提供准确的位置信息', () => {
    const tokens = significant(
      tokenize(`
Return 1.
`)
    );
    const returnToken = tokens.find(t => (t.value as string | undefined)?.toLowerCase() === 'return');
    assert.ok(returnToken, '应该找到 Return token');
    assert.equal(returnToken!.start.line, 2);
    assert.equal(returnToken!.start.col, 1);
  });

  test('应该将注释标记为 trivia 渠道并保留文本', () => {
    const tokens = lex(`# comment line\nReturn 1.\n`);
    const comments = tokens.filter(t => t.kind === TokenKind.COMMENT);
    assert.equal(comments.length, 1);
    const comment = comments[0]!;
    assert.equal(comment.channel, 'trivia');
    assert.equal((comment.value as { text: string }).text, 'comment line');
  });

  test('应该在遇到非法字符时抛出诊断错误', () => {
    assert.throws(
      () => tokenize('Return %(1).'),
      /unexpected character/i,
      '非法字符 % 应该触发诊断'
    );
  });

  describe('边界场景', () => {
    it('应该正确识别注释语法并区分双斜线与井号', () => {
      const tokens = lex(
        `// trailing comment
# leading comment
`
      );
      const comments = tokens.filter(isCommentToken);
      assert.equal(comments.length, 2);
      assert.equal(comments[0]!.value.text, 'trailing comment');
      assert.equal(comments[1]!.value.text, 'leading comment');
      assert.equal(comments.every(token => token.channel === 'trivia'), true);
    });

    it('应该将除法符号与标识符区分开（含空格与无空格场景）', () => {
      const withSpaces = significant(lex('a / b'));
      assert.equal(withSpaces[0]!.kind, TokenKind.IDENT);
      assert.equal(withSpaces[1]!.kind, TokenKind.SLASH);
      assert.equal(withSpaces[2]!.kind, TokenKind.IDENT);

      const withoutSpaces = significant(lex('a/b'));
      assert.equal(withoutSpaces[0]!.kind, TokenKind.IDENT);
      assert.equal(withoutSpaces[1]!.kind, TokenKind.SLASH);
      assert.equal(withoutSpaces[2]!.kind, TokenKind.IDENT);
    });

    it('应该识别比较运算符并处理紧邻标识符的表达式', () => {
      const ops = significant(lex('< <= > >='));
      assert.deepEqual(
        ops.slice(0, 4).map(token => token.kind),
        [TokenKind.LT, TokenKind.LTE, TokenKind.GT, TokenKind.GTE]
      );

      const noSpaces = significant(lex('a<b'));
      assert.equal(noSpaces[0]!.kind, TokenKind.IDENT);
      assert.equal(noSpaces[1]!.kind, TokenKind.LT);
      assert.equal(noSpaces[2]!.kind, TokenKind.IDENT);

      const withSpaces = significant(lex('a < b'));
      assert.equal(withSpaces[0]!.kind, TokenKind.IDENT);
      assert.equal(withSpaces[1]!.kind, TokenKind.LT);
      assert.equal(withSpaces[2]!.kind, TokenKind.IDENT);
    });

    it('应该在奇数缩进时报错并允许 2 空格缩进', () => {
      assert.throws(
        () =>
          tokenize(`Rule broken, produce Int:
   Return 1.
`),
        error => {
          assert.match(String(error), /Indentation must be multiples of 2 spaces/i);
          return true;
        }
      );

      const okTokens = tokenize(`Rule fine, produce Int:
  Return 1.
`);
      const indentCount = okTokens.filter(token => token.kind === TokenKind.INDENT).length;
      const dedentCount = okTokens.filter(token => token.kind === TokenKind.DEDENT).length;
      assert.equal(indentCount, 1);
      assert.equal(dedentCount, 1);
    });

    it('应该在未闭合字符串时报错并保留转义字符', () => {
      assert.throws(
        () => tokenize('Return "missing.'),
        error => {
          assert.match(String(error), /Unterminated string literal/i);
          return true;
        }
      );

      const tokens = significant(tokenize('Return "quote: \\" newline: \\\\n".'));
      const stringToken = tokens.find(token => token.kind === TokenKind.STRING);
      assert.ok(stringToken, '应该生成字符串 token');
      assert.equal(stringToken!.value, 'quote: " newline: \\n');
    });
  });

  describe('数值字面量范围（双引擎 parity：issue #83 / #86 / core #81 #85）', () => {
    // Java 侧 Integer.parseInt / Long.parseLong 对超限输入抛 NumberFormatException，
    // 而 TS 的 parseInt / BigInt 会静默接受（parseInt 在 20 位以上还会丢精度）——
    // 同一份源码一个引擎崩、一个引擎跑。沿用 Decimal 位数上限（ADR 0025）的既定
    // 约定：两侧一律硬拒。

    it('Int 边界值 2147483647 → 接受', () => {
      const toks = significant(tokenize('Rule f produce:\n  Return 2147483647.\n'));
      assert.ok(toks.some(t => t.kind === TokenKind.INT && t.value === 2147483647));
    });

    it('超 Int32 的 3000000000 → 拒绝', () => {
      assert.throws(() => tokenize('Rule f produce:\n  Return 3000000000.\n'),
        /out of range for Int/);
    });

    it('20 位整数（TS 曾静默丢精度）→ 拒绝', () => {
      assert.throws(() => tokenize('Rule f produce:\n  Return 99999999999999999999.\n'),
        /out of range for Int/);
    });

    it('Long 边界值 9223372036854775807L → 接受', () => {
      const toks = significant(tokenize('Rule f produce:\n  Return 9223372036854775807L.\n'));
      assert.ok(toks.some(t => t.kind === TokenKind.LONG && t.value === '9223372036854775807'));
    });

    it('超 Int64 的 L 字面量 → 拒绝', () => {
      assert.throws(() => tokenize('Rule f produce:\n  Return 99999999999999999999L.\n'),
        /out of range for Long/);
    });

    it('溢出成 Infinity 的浮点字面量 → 拒绝', () => {
      assert.throws(() => tokenize(`Rule f produce:\n  Return ${'9'.repeat(400)}.0.\n`),
        /Infinity/);
    });

    it('正常浮点仍可解析', () => {
      const toks = significant(tokenize('Rule f produce:\n  Return 1.5.\n'));
      assert.ok(toks.some(t => t.kind === TokenKind.FLOAT && t.value === 1.5));
    });
  });
});

/**
 * 字符串转义解码（2026-08-17 审计）。
 *
 * 此前 lexer 对转义**完全不解码**——丢掉反斜杠、原样收下一个字符。
 * 而 Java 侧 StringEscapes 做标准解码，于是两边都「成功」、都不报错，
 * 但**运行期字符串值不同**：
 *     "a\nb"      TS → "anb"       Java → "a"+LF+"b"
 *     "aAb"  TS → "au0041b"   Java → "aAb"
 * 同一段 CNL 在两个引擎产出不同决策 —— 最危险的一类分歧（静默、无痕、结果不同）。
 */
describe('字符串转义解码（双引擎 parity）', () => {
  function stringValueOf(src: string): unknown {
    const tokens = significant(lex(canonicalize(src)));
    const strTok = tokens.find(t => t.kind === TokenKind.STRING);
    return strTok?.value;
  }

  test('\\n 必须解码为真正的换行，而非字母 n', () => {
    assert.equal(
      stringValueOf('Module m.\nRule r, produce:\n  Return "a\\nb".\n'),
      'a\nb',
      '此前产出 "anb"（丢反斜杠取字面 n），与 Java 的真换行不同'
    );
  });

  test('\\uXXXX 必须解码为对应码点', () => {
    assert.equal(
      stringValueOf('Module m.\nRule r, produce:\n  Return "a\\u0041b".\n'),
      'aAb',
      '此前产出 "au0041b"'
    );
  });

  test('常见转义与 Java StringEscapes 逐条一致', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['\\t', '\t'],
      ['\\r', '\r'],
      ['\\b', '\b'],
      ['\\f', '\f'],
      ['\\0', '\0'],
      ['\\\\', '\\'],
      ['\\"', '"'],
      ['\\/', '/'],
    ];
    for (const [escaped, expected] of cases) {
      assert.equal(
        stringValueOf(`Module m.\nRule r, produce:\n  Return "${escaped}".\n`),
        expected,
        `转义 ${escaped} 解码结果须与 Java 一致`
      );
    }
  });

  test('未知转义必须报错，不得静默按字面量处理', () => {
    assert.throws(
      () => stringValueOf('Module m.\nRule r, produce:\n  Return "a\\zb".\n'),
      /Unexpected character/,
      '此前静默产出 "azb"；Java 侧抛异常，两侧须一致'
    );
  });

  test('不完整的 \\u 转义必须报错', () => {
    assert.throws(
      () => stringValueOf('Module m.\nRule r, produce:\n  Return "a\\u00".\n'),
      /Unexpected character/,
      '\\u 后必须恰好 4 位十六进制'
    );
  });
});
