/**
 * Phase 1（ADR 0017）—— 天城文 Devanagari 词法支持测试（TS 引擎）。
 *
 * 与 aster-lang-core 的 DevanagariLexerTest 对齐（双引擎 parity）：
 *   1. abugida 组合记号（matra ◌ॉ ◌ू、virama ◌्）必须算标识符字符——否则天城文词
 *      在记号处碎裂（मॉड्यूल → 碎片）。修复在 lexer.ts isLetter() english 分支加
 *      Devanagari 范围 0x0900–0x097F。
 *   2. danda「।」（lexicon punctuation.statementEnd）须排除在字母范围外（0x0964/0x0965），
 *      由 lexer 的标点分支识别为 DOT，不被吞进标识符。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lex } from '../../../src/frontend/lexer.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { TokenKind } from '../../../src/types.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

// 最小 Hindi lexicon：danda 句末符 + 少量天城文关键词。继承 EN_US 的 keywords 形状
// 后覆盖 punctuation.statementEnd 为 danda，并保持 whitespaceMode 'english'。
const HI_IN: Lexicon = {
  ...EN_US,
  id: 'hi-IN',
  name: 'हिन्दी',
  punctuation: {
    ...EN_US.punctuation,
    statementEnd: '।', // Devanagari danda
  },
};

describe('天城文 Devanagari 词法', () => {
  test('含元音符号/virama 的天城文词应为单个标识符（不碎裂）', () => {
    // मॉड्यूल = म + ◌ॉ + ड + ◌् + य + ◌ू + ल（多个组合记号）
    const toks = lex('मॉड्यूल pricing', HI_IN);
    const devIdents = toks.filter(
      (t) =>
        t.kind === TokenKind.IDENT &&
        [...String(t.value)].some((c) => {
          const cc = c.charCodeAt(0);
          return cc >= 0x0900 && cc <= 0x097f;
        }),
    );
    assert.equal(devIdents.length, 1, `天城文词应是单个 IDENT，实际: ${JSON.stringify(toks.map((t) => [t.kind, t.value]))}`);
    assert.equal(
      toks.some((t) => t.value === 'मॉड्यूल'),
      true,
      'मॉड्यूल 应完整成 IDENT',
    );
  });

  test('danda「।」应识别为句末 DOT，不被吞进标识符', () => {
    const toks = lex('pricing।', HI_IN);
    assert.equal(toks[0]?.kind, TokenKind.IDENT, `第一个应是 pricing IDENT: ${JSON.stringify(toks)}`);
    assert.equal(toks[1]?.kind, TokenKind.DOT, `danda 应是 DOT: ${JSON.stringify(toks)}`);
    assert.equal(toks[1]?.value, '।');
  });

  test('天城文词 + danda：词完整且 danda 分开', () => {
    const toks = lex('मॉड्यूल।', HI_IN);
    assert.equal(toks.some((t) => t.value === 'मॉड्यूल'), true, '词应完整');
    assert.equal(toks.some((t) => t.kind === TokenKind.DOT && t.value === '।'), true, 'danda 应分开成 DOT');
  });

  test('回归：ASCII「.」仍是 DOT（不破坏 en/de 行为）', () => {
    const toks = lex('foo.', EN_US);
    assert.equal(toks[1]?.kind, TokenKind.DOT, `ASCII 句号仍应是 DOT: ${JSON.stringify(toks)}`);
  });
});
