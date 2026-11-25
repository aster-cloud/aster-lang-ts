/**
 * LSP 的名字转义支持（ADR 0064 §6）：快速修复「用作名字」、悬停说明、补全插入转义写法与语义着色。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CodeActionKind } from 'vscode-languageserver/node.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import {
  completionName,
  escapeAllOccurrences,
  escapedHoverLine,
  isKeywordHomograph,
} from '../../../src/lsp/name-escape.js';
import { registerCodeActionHandlers } from '../../../src/lsp/codeaction.js';
import { SEM_LEGEND } from '../../../src/lsp/tokens.js';

function applyEdits(text: string, edits: ReturnType<typeof escapeAllOccurrences>): string {
  const lines = text.split('\n');
  for (const e of [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
    const l = lines[e.range.start.line]!;
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character);
  }
  return lines.join('\n');
}

describe('名字转义的 LSP 支持（ADR 0064 §6）', () => {
  it('用作名字：整词出现都改成转义，字符串、注释、已有转义与更长的词不动', () => {
    const text = '规则 取值 给定 当 作为 整数，产出 整数：\n  令 当前 定义为 当。 # 当\n  返回 「当」 加上 `当` 加上 当。\n';
    const out = applyEdits(text, escapeAllOccurrences(text, '当'));
    assert.equal(out, '规则 取值 给定 `当` 作为 整数，产出 整数：\n  令 当前 定义为 `当`。 # 当\n  返回 「当」 加上 `当` 加上 `当`。\n');
  });

  it('含反引号或为空的词不给修复', () => {
    assert.deepEqual(escapeAllOccurrences('x', ''), []);
    assert.deepEqual(escapeAllOccurrences('`a`', '`a`'), []);
  });

  it('E901 / W802 / E808 诊断上提供快速修复', async () => {
    const text = 'Module m.\n\nDefine If with a as Int.\n';
    const handlers: Record<string, (p: unknown) => Promise<unknown>> = {};
    const connection = { onCodeAction: (h: (p: unknown) => Promise<unknown>) => { handlers.codeAction = h; } };
    const documents = { get: () => ({ uri: 'file:///t.aster', getText: () => text }) };
    registerCodeActionHandlers(connection as never, documents as never, () => ({ text, tokens: [], ast: {} }), () => null);
    const diag = { code: 'E901', message: '', range: { start: { line: 2, character: 7 }, end: { line: 2, character: 9 } } };
    const actions = (await handlers.codeAction!({ textDocument: { uri: 'file:///t.aster' }, context: { diagnostics: [diag] } })) as {
      title: string; kind: string; edit: { changes: Record<string, { newText: string }[]> };
    }[];
    const fix = actions.find(a => a.title === 'Use `If` as a name');
    assert.ok(fix, JSON.stringify(actions.map(a => a.title)));
    assert.equal(fix.kind, CodeActionKind.QuickFix);
    assert.deepEqual(fix.edit.changes['file:///t.aster']!.map(e => e.newText), ['`If`']);
  });

  it('悬停在转义名上说明它是名字', () => {
    const tokens = lex(canonicalize('Module m.\n\nRule f given `type` as Int, produce Int:\n  Return `type`.\n', EN_US), EN_US);
    assert.equal(escapedHoverLine(tokens, { line: 3, character: 10 }), 'escaped name `type` (a name, not a keyword)');
    assert.equal(escapedHoverLine(tokens, { line: 3, character: 4 }), null);
  });

  it('补全：与关键词同形的名字插入转义写法', () => {
    assert.equal(completionName('版本', ZH_CN), '`版本`');
    assert.equal(completionName('名称', ZH_CN), '名称');
    assert.equal(completionName('version', EN_US), '`version`');
    assert.equal(completionName('amount', EN_US), 'amount');
    assert.ok(isKeywordHomograph('Given', EN_US));
  });

  it('语义着色图例追加 operator 与 escaped，既有下标不变', () => {
    assert.deepEqual(SEM_LEGEND.tokenTypes.slice(0, 8), ['keyword', 'type', 'function', 'parameter', 'variable', 'enum', 'enumMember', 'property']);
    assert.equal(SEM_LEGEND.tokenTypes[8], 'operator');
    assert.deepEqual(SEM_LEGEND.tokenModifiers, ['declaration', 'escaped']);
  });
});
