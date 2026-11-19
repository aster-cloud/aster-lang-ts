// 引号归一只改写定界符（aster-cloud/aster-lang-ts#347）。
//
// 规则（与 aster-lang-core Canonicalizer.normalizeQuoteDelimiters 同一分段）：
//   1. 字符串之外，未转义的词法表开引号、ASCII "、左弯引号 “ 开启字符串；
//   2. "…" 只由 " 闭合，词法表引号对只由其闭引号闭合，内容里的弯引号与 ASCII 引号原样保留；
//   3. “…” 由 ” " “ 任一闭合（此前三者都被改写成闭引号），定界符换成目标引号，内容不动；
//   4. 字符串之外的其余弯引号照旧改写（英语等：” → "、‘ ’ → '；zh-CN：” → 」）。
//
// 此前整段替换弯引号：字符串里的 ‘x’ 静默变成 'x'，"说“好”" 被弯引号改成的 ASCII 引号截断。
// 与 aster-lang-core CanonicalizerTest 的 #347 用例逐条对应。字符一律写 Unicode 转义，防编辑器替换。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { TokenKind } from '../../../src/frontend/tokens.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

/** 规范化后词法分析得到的全部字符串 token 值。 */
function stringValues(source: string, lexicon: Lexicon): string[] {
  return lex(canonicalize(source, lexicon), lexicon)
    .filter(t => t.kind === TokenKind.STRING)
    .map(t => t.value as string);
}

describe('引号归一只改写定界符（#347）', () => {
  it('"…" 里的弯引号是内容，原样保留', () => {
    const input = 'Return "it’s ‘q’ and “hi”".';
    assert.equal(canonicalize(input, EN_US), input);
    assert.deepEqual(stringValues(input, EN_US), ['it’s ‘q’ and “hi”']);
  });

  it('“…” 仍是字符串定界符，内容里的单弯引号不改', () => {
    assert.equal(canonicalize('Return “a ‘b’ c”.', EN_US), 'Return "a ‘b’ c".');
  });

  it('“…" 与 “…“ 照旧是合法字符串（此前三种双引号都被改成 "）', () => {
    assert.equal(canonicalize('Return “abc".', EN_US), 'Return "abc".');
    assert.equal(canonicalize('Return “abc“.', EN_US), 'Return "abc".');
  });

  it('"abc” 的 ” 是内容：字符串不再闭合，交给词法器报未闭合', () => {
    const input = 'Return "abc”.';
    assert.equal(canonicalize(input, EN_US), input);
    assert.throws(() => lex(canonicalize(input, EN_US), EN_US), /Unterminated string/);
  });

  it('字符串之外的弯引号照旧改写', () => {
    assert.equal(canonicalize('Text with ‘smart’ ”q”', EN_US), 'Text with \'smart\' "q"');
  });

  it('zh-CN：「」里的弯引号与 ASCII 引号是内容', () => {
    const input = '返回 「他说“好”，a"b，it’s」。';
    assert.deepEqual(stringValues(input, ZH_CN), ['他说“好”，a"b，it’s']);
  });

  it('zh-CN：已转义的 \\" 照常读回 "', () => {
    assert.deepEqual(stringValues('返回 「a\\"b」。', ZH_CN), ['a"b']);
  });

  it('zh-CN：“…” 与 "…" 定界的字符串换成「」，内容不动', () => {
    assert.deepEqual(stringValues('返回 “中文 it’s”。', ZH_CN), ['中文 it’s']);
    assert.deepEqual(stringValues('返回 "a「b “c”"。', ZH_CN), ['a「b “c”']);
  });

  it('幂等：规范化结果再规范化不变', () => {
    for (const [input, lexicon] of [
      ['Return "it’s “hi”".', EN_US],
      ['Return “a ‘b’”.', EN_US],
      ['返回 「他说“好”」。', ZH_CN],
      ['返回 “中文”。', ZH_CN],
    ] as const) {
      const once = canonicalize(input, lexicon);
      assert.equal(canonicalize(once, lexicon), once, input);
    }
  });
});
