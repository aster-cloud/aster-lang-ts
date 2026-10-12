/**
 * LSP 文档解析：非英文文档必须用其 lexicon 做**词法分析**。
 *
 * ★生产缺陷：server.ts 的 getOrParse 调 `lex(can)` 不传 lexicon。canonicalize 只把
 *   「。：」等标点转成半角，关键字仍是中文；无 lexicon 的 lexer 见到「模」即抛
 *   "Unexpected character"，于是 zh/de 文档的 hover / 跳转 / 文档符号全部报错。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentText } from '../../../src/lsp/parse-document.js';
import { LexiconRegistry, initializeAllBundledLexicons } from '../../../src/config/lexicons/index.js';

initializeAllBundledLexicons();

describe('parseDocumentText', () => {
  it('★zh-CN 文档按 zh lexicon 词法分析并解析出模块名与函数', () => {
    const zh = LexiconRegistry.get('zh-CN');
    const text = '模块 demo.p。\n\n规则 twice 给定 x 作为 整数 产出 整数：\n  返回 x 乘以 2。\n';
    const r = parseDocumentText(text, zh, undefined, undefined);
    assert.ok(r.tokens.length > 0, '应产生 token（旧实现在 lex 阶段直接抛错）');
    assert.equal((r.ast as { name?: string } | null)?.name, 'demo.p');
    const funcs = ((r.ast as { decls?: Array<{ kind: string; name: string }> } | null)?.decls ?? [])
      .filter((d) => d.kind === 'Func').map((d) => d.name);
    assert.deepEqual(funcs, ['twice']);
  });

  it('en-US（无 lexicon）行为不变', () => {
    const text = 'Module demo.p.\n\nRule twice given x as Int, produce Int:\n  Return x times 2.\n';
    const r = parseDocumentText(text, undefined, undefined, undefined);
    assert.equal((r.ast as { name?: string } | null)?.name, 'demo.p');
  });
});
