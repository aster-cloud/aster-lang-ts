import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { controlCompletions, controlCompletionsAt } from '../../../src/lsp/completion.js';

test('@control(" 处补全全部注册表键', () => {
  const items = controlCompletions('@control("');
  assert.ok(items);
  assert.deepEqual(items!.map((i) => i.label).sort(), ['EU_AI_ACT:ART14', 'GDPR:ART17', 'GDPR:ART22', 'GDPR:ART6', 'SOX:404']);
});

test('按已输入前缀过滤，detail 为英文标题', () => {
  const items = controlCompletions('  @control( "GDPR:ART2');
  assert.deepEqual(items!.map((i) => i.label), ['GDPR:ART22']);
  assert.equal(items![0]!.detail, 'Automated individual decision-making');
});

test('非 @control 字符串上下文返回 null', () => {
  assert.equal(controlCompletions('@id("'), null);
  assert.equal(controlCompletions('Rule main'), null);
});

test('补全请求缺少 params 或 position 时不抛错并返回 null', () => {
  const docs = { get: () => undefined };
  assert.equal(controlCompletionsAt(docs, undefined), null);
  assert.equal(controlCompletionsAt(docs, { textDocument: { uri: 'file:///a' } }), null);
  assert.equal(controlCompletionsAt(docs, { textDocument: { uri: 'file:///a' }, position: { line: 0, character: 0 } }), null);
});

test('无光标位置时不带 textEdit（向后兼容）', () => {
  const items = controlCompletions('@control("GDPR:ART2');
  assert.equal(items![0]!.textEdit, undefined);
});

test('textEdit 覆盖引号内已输入前缀，选中后得到完整键而非重复前缀', () => {
  const line = '@control("GDPR:ART2';
  const doc = TextDocument.create('file:///p.aster', 'aster', 1, `Module p.\n${line}")\n`);
  const position = { line: 1, character: line.length };
  const items = controlCompletionsAt({ get: () => doc }, { textDocument: { uri: doc.uri }, position });
  assert.deepEqual(items!.map((i) => i.label), ['GDPR:ART22']);
  const edit = items![0]!.textEdit as { range: { start: { line: number; character: number }; end: unknown }; newText: string };
  assert.deepEqual(edit.range, { start: { line: 1, character: '@control("'.length }, end: position });
  assert.equal(edit.newText, 'GDPR:ART22');
  const applied = TextDocument.applyEdits(doc, [edit as never]);
  assert.equal(applied.split('\n')[1], '@control("GDPR:ART22")');
});

test('空前缀时 textEdit 为光标处零宽插入', () => {
  const items = controlCompletions('  @control( "', { line: 3, character: 13 });
  const edit = items![0]!.textEdit as { range: unknown };
  assert.deepEqual(edit.range, { start: { line: 3, character: 13 }, end: { line: 3, character: 13 } });
});
