/**
 * onCompletion 返回 CompletionList（aster-lang-ts#275）：
 *   - 成员补全的修补推断因耗时预算提前截断、未定出类型时 isIncomplete 为 true，客户端继续输入会重新请求；
 *   - 其余结果（关键词、字段、@control 键）都是完整结果，isIncomplete 为 false。
 * 走真实的 registerCompletionHandlers 接线（stub connection 捕获 handler）。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { CompletionList } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { registerCompletionHandlers } from '../../../src/lsp/completion.js';
import type { MemberCompletionOptions } from '../../../src/lsp/member-completion.js';
import { clearMemberRepairCache } from '../../../src/lsp/member-completion.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { parseDocumentText, parseDocumentWith } from '../../../src/lsp/parse-document.js';

const URI = 'file:///t.aster';
const HEAD = ['Module demo.p.', '', 'Define Driver has name as Text, age as Int.', '', 'Rule f given d as Driver, produce Int:'];

function complete(lines: readonly string[], line: number, character: number, options: MemberCompletionOptions = {}): CompletionList {
  const doc = TextDocument.create(URI, 'aster', 1, lines.join('\n'));
  let handler: ((params: unknown) => CompletionList) | undefined;
  const connection = {
    onCompletion: (fn: (params: unknown) => CompletionList) => { handler = fn; },
    onCompletionResolve() {},
    onRequest() {},
  };
  const getOrParse = (d: TextDocument) => ({ text: d.getText(), ...parseDocumentText(d.getText(), EN_US, undefined, undefined) });
  registerCompletionHandlers(connection as never, { get: () => doc }, getOrParse as never, () => EN_US, options);
  assert.ok(handler, 'onCompletion 未注册');
  return handler!({ textDocument: { uri: URI }, position: { line, character } });
}

const ticking = (step: number) => {
  let t = 0;
  return () => (t += step);
};
/** 每份修补都解析成空模块：定不出类型 */
const failingParse: typeof parseDocumentWith = (_t, lexicon, vocabulary) => parseDocumentWith('Module demo.p.\n', lexicon, vocabulary);

beforeEach(() => clearMemberRepairCache());

describe('#275 onCompletion 返回 CompletionList', () => {
  const broken = [...HEAD, '  If d. plus 1', '  Return 1.', ''];
  const at = '  If d.'.length;

  it('预算提前截断、未定出类型：isIncomplete 为 true（仍给关键词兜底）', () => {
    const list = complete(broken, 5, at, { parse: failingParse, now: ticking(1000), repairBudgetMs: 150, repairBudgetFromLines: 0 });
    assert.equal(list.isIncomplete, true);
    assert.ok(list.items.length > 0);
  });

  it('修补全部尝试完仍定不出类型（未截断）：isIncomplete 为 false', () => {
    const list = complete(broken, 5, at, { parse: failingParse, now: ticking(0), repairBudgetFromLines: 0 });
    assert.equal(list.isIncomplete, false);
  });

  it('定出字段：完整结果，isIncomplete 为 false', () => {
    const list = complete([...HEAD, '  Return d.', ''], 5, '  Return d.'.length);
    assert.deepEqual(list.items.map((i) => i.label).sort(), ['age', 'name']);
    assert.equal(list.isIncomplete, false);
  });

  it('非成员位置的关键词补全：isIncomplete 为 false', () => {
    const list = complete([...HEAD, '  Return 1.', ''], 5, 2);
    assert.ok(list.items.some((i) => i.label === EN_US.keywords[Object.keys(EN_US.keywords)[0] as keyof typeof EN_US.keywords]));
    assert.equal(list.isIncomplete, false);
  });

  it('@control 键补全：isIncomplete 为 false', () => {
    const line = '  @control("';
    const list = complete([...HEAD, line, '  Return 1.', ''], 5, line.length);
    assert.equal(list.isIncomplete, false);
  });
});
