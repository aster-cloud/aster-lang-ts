/**
 * @module test/unit/parser/localized-diagnostic-keywords.test
 *
 * 语法诊断中引号里的关键词必须是作者所写语言的拼写。
 *
 * 背景：parseWithLexicon 先把 zh/de 关键词翻译成英文再解析，解析器的报错文案
 * （如 "Expected 'return' after 'then'"）因此带着作者从未写过的英文关键词。
 * 本测试锁住：引号内的规范关键词回译成 locale 拼写；英文保持不变；
 * 非关键词（标识符、标点）不被改写。与 aster-api 的 CnlErrorListener 行为一致。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

function messages(src: string, lexicon: Lexicon): string[] {
  const tokens = lex(canonicalize(src, lexicon), lexicon);
  return parseWithLexicon(tokens, lexicon).diagnostics.map(d => d.message);
}

describe('语法诊断关键词本地化', () => {
  it('zh：内联 if 缺返回时报「返回」「那么」而非英文', () => {
    const msgs = messages(
      '模块 m。\n\n规则 r 给定 x 作为 整数 产出 整数：\n  如果 x 小于 0 那么 x。\n  返回 x。',
      ZH_CN,
    );
    const joined = msgs.join(' | ');
    assert.ok(joined.includes("'返回'"), `应含 '返回'：${joined}`);
    assert.ok(!joined.includes("'return'"), `不应含 'return'：${joined}`);
    assert.ok(!joined.includes("'then'"), `不应含 'then'：${joined}`);
  });

  it('de：同一错误用德语关键词', () => {
    const ret = DE_DE.keywords.RETURN;
    const src = [
      `${DE_DE.keywords.MODULE_DECL} m.`,
      '',
      `${DE_DE.keywords.FUNC_TO} r ${DE_DE.keywords.FUNC_GIVEN} x ${DE_DE.keywords.IMPORT_ALIAS} ${DE_DE.keywords.INT_TYPE}, ${DE_DE.keywords.FUNC_PRODUCE} ${DE_DE.keywords.INT_TYPE}:`,
      `  ${DE_DE.keywords.IF} x < 0 ${DE_DE.keywords.THEN} x.`,
      `  ${ret} x.`,
    ].join('\n');
    const joined = messages(src, DE_DE).join(' | ');
    assert.ok(joined.includes(`'${ret}'`), `应含 '${ret}'：${joined}`);
    assert.ok(!joined.includes("'return'"), `不应含 'return'：${joined}`);
  });

  it('en：保持原文不变', () => {
    const joined = messages(
      'Module m.\n\nRule r given x as Int, produce Int:\n  If x less than 0 then x.\n  Return x.',
      EN_US,
    ).join(' | ');
    assert.ok(joined.includes("'return'"), `英文应保持 'return'：${joined}`);
  });
});
