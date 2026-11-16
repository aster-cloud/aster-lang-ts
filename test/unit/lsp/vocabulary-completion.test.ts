/**
 * 词汇术语补全（ADR 0058 §8.1）：类型位置并入词汇类型，表达式位置给本地化函数与枚举成员。
 * ADR 0051 回归：结构体与字段共用本地化词时，表达式位置不出现类型项。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompletionItemKind } from 'vscode-languageserver/node.js';
import { registerCompletionHandlers } from '../../../src/lsp/completion.js';
import { vocabularyTermCompletions } from '../../../src/lsp/vocabulary-completion.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { docOf, documentsOf, getOrParseWith } from './resolution-fixture.js';
import type { Doc } from './resolution-fixture.js';

interface Item { label: string; kind?: number; detail?: string; insertText?: string }

const VOCAB = buildVocabularyScopes({
  id: 'vc', name: 't', locale: 'de-DE', version: '1',
  structs: [
    { canonical: 'Driver', localized: 'Fahrer', kind: IdentifierKind.STRUCT },
    { canonical: 'Shared', localized: 'Gemeinsam', kind: IdentifierKind.STRUCT },
  ],
  fields: [{ canonical: 'shared', localized: 'Gemeinsam', kind: IdentifierKind.FIELD, parent: 'Driver' }],
  functions: [{ canonical: 'check', localized: 'prüfen', kind: IdentifierKind.FUNCTION }],
  enumValues: [{ canonical: 'High', localized: 'Hoch', kind: IdentifierKind.ENUM_VALUE, parent: 'Level' }],
});

function completeAt(doc: Doc, line: number, character: number, lexicon: Lexicon): Item[] {
  let handler: ((params: unknown) => { items: Item[] }) | undefined;
  const connection = {
    onCompletion: (fn: (params: unknown) => { items: Item[] }) => { handler = fn; },
    onCompletionResolve() {},
    onRequest() {},
  };
  registerCompletionHandlers(connection as never, documentsOf(doc), getOrParseWith(lexicon, VOCAB) as never, () => lexicon);
  return handler!({ textDocument: { uri: doc.uri }, position: { line, character } }).items;
}

const HEAD = ['Modul m.', '', 'Definiere Driver hat name als Text.', ''];

describe('vocabularyTermCompletions', () => {
  it('无词汇时返回空数组', () => {
    assert.deepEqual(vocabularyTermCompletions(undefined, 'type'), []);
    assert.deepEqual(vocabularyTermCompletions(undefined, 'value'), []);
  });

  it('value 角色给函数与枚举成员，detail 含规范名', () => {
    const items = vocabularyTermCompletions(VOCAB, 'value');
    const fn = items.find((i) => i.label === 'prüfen');
    assert.equal(fn?.kind, CompletionItemKind.Function);
    assert.equal(fn?.insertText, 'prüfen');
    assert.match(fn?.detail ?? '', /^check · /);
    const member = items.find((i) => i.label === 'Hoch');
    assert.equal(member?.kind, CompletionItemKind.EnumMember);
    assert.match(member?.detail ?? '', /^High · /);
    assert.ok(!items.some((i) => i.label === 'Fahrer'), '类型不进 value 角色');
  });

  it('type 角色只给类型', () => {
    const labels = vocabularyTermCompletions(VOCAB, 'type').map((i) => i.label);
    assert.deepEqual(labels.sort(), ['Fahrer', 'Gemeinsam']);
  });
});

describe('补全接线', () => {
  it('表达式位置出现本地化函数名与枚举成员，不出现类型项（ADR 0051）', () => {
    const doc = docOf([...HEAD, 'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:', '  Gib zurück ']);
    const items = completeAt(doc, doc.lines.length - 1, doc.lines[doc.lines.length - 1]!.length, DE_DE);
    const fn = items.find((i) => i.label === 'prüfen');
    assert.match(fn?.detail ?? '', /^check/);
    assert.ok(items.some((i) => i.label === 'Hoch'));
    assert.ok(!items.some((i) => i.label === 'Fahrer'));
    assert.ok(!items.some((i) => i.label === 'Gemeinsam' && i.kind === CompletionItemKind.Class));
  });

  it('类型位置并入词汇类型，与已声明类型按折叠名去重', () => {
    const doc = docOf([...HEAD, 'Definiere Owner hat d als ']);
    const items = completeAt(doc, doc.lines.length - 1, doc.lines[doc.lines.length - 1]!.length, DE_DE);
    assert.equal(items.filter((i) => i.label === 'Fahrer').length, 1);
    assert.equal(items.filter((i) => i.label.toLowerCase() === 'driver').length, 1);
    assert.ok(!items.some((i) => i.label === 'prüfen'), '类型位置不给函数');
  });
});
