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
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
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

const HI_VOCAB = buildVocabularyScopes({
  id: 'vc-hi', name: 't', locale: 'hi-IN', version: '1',
  structs: [{ canonical: 'Customer', localized: 'ग्राहक', kind: IdentifierKind.STRUCT }],
  fields: [{ canonical: 'age', localized: 'आयु', kind: IdentifierKind.FIELD, parent: 'Customer' }],
  functions: [{ canonical: 'double', localized: 'दोगुना', kind: IdentifierKind.FUNCTION }],
  enumValues: [{ canonical: 'High', localized: 'उच्च', kind: IdentifierKind.ENUM_VALUE, parent: 'Level' }],
});

function completeAt(doc: Doc, line: number, character: number, lexicon: Lexicon, scopes = VOCAB): Item[] {
  let handler: ((params: unknown) => { items: Item[] }) | undefined;
  const connection = {
    onCompletion: (fn: (params: unknown) => { items: Item[] }) => { handler = fn; },
    onCompletionResolve() {},
    onRequest() {},
  };
  registerCompletionHandlers(connection as never, documentsOf(doc), getOrParseWith(lexicon, scopes) as never, () => lexicon);
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

  it('detail 的角色名按 lexicon 本地化（与名称解析悬停同一套 UI 文本），缺省为英文', () => {
    const detail = (label: string, lexicon?: Lexicon) =>
      vocabularyTermCompletions(VOCAB, label === 'Fahrer' ? 'type' : 'value', lexicon ? { lexicon } : {}).find((i) => i.label === label)?.detail;
    assert.equal(detail('prüfen'), 'check · function');
    assert.equal(detail('Hoch'), 'High · enum member');
    assert.equal(detail('Fahrer'), 'Driver · type');
    assert.equal(detail('prüfen', ZH_CN), 'check · 函数');
    assert.equal(detail('Hoch', ZH_CN), 'High · 枚举成员');
    assert.equal(detail('Fahrer', ZH_CN), 'Driver · 类型');
  });

  it('type 角色：写法或规范名与 takenLabels 相同的词汇项让位', () => {
    const labels = (taken: string[]) =>
      vocabularyTermCompletions(VOCAB, 'type', { takenLabels: new Set(taken) }).map((i) => i.label).sort();
    assert.deepEqual(labels(['driver']), ['Gemeinsam'], '规范名 Driver 已被占用');
    assert.deepEqual(labels(['fahrer']), ['Gemeinsam'], '写法 Fahrer 已被占用');
    assert.deepEqual(labels([]), ['Fahrer', 'Gemeinsam']);
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
    // 按折叠后的规范名去重：文档声明的 Driver 胜出，词汇项 Fahrer（规范名 Driver）被丢弃
    assert.equal(items.filter((i) => i.label === 'Fahrer').length, 0);
    assert.equal(items.filter((i) => i.label.toLowerCase() === 'driver').length, 1);
    // 规范名不冲突的词汇类型保留
    assert.equal(items.filter((i) => i.label === 'Gemeinsam').length, 1);
    assert.ok(!items.some((i) => i.label === 'prüfen'), '类型位置不给函数');
  });
});

describe('补全接线 hi-IN', () => {
  const HI_HEAD = ['मॉड्यूल m.', '', 'परिभाषित Driver रखता है name रूप में पाठ.', ''];

  it('表达式位置出现天城文函数名与枚举成员，不出现类型项', () => {
    const doc = docOf([...HI_HEAD, 'नियम f दिया गया x रूप में पूर्णांक, उत्पन्न पूर्णांक:', '  लौटाएं ']);
    const items = completeAt(doc, doc.lines.length - 1, doc.lines[doc.lines.length - 1]!.length, HI_IN, HI_VOCAB);
    assert.match(items.find((i) => i.label === 'दोगुना')?.detail ?? '', /^double · /);
    assert.equal(items.find((i) => i.label === 'उच्च')?.kind, CompletionItemKind.EnumMember);
    assert.ok(!items.some((i) => i.label === 'ग्राहक'), '表达式位置不给词汇类型');
  });

  it('类型位置并入天城文词汇类型，不给函数', () => {
    const doc = docOf([...HI_HEAD, 'परिभाषित Owner रखता है d रूप में ']);
    const items = completeAt(doc, doc.lines.length - 1, doc.lines[doc.lines.length - 1]!.length, HI_IN, HI_VOCAB);
    const t = items.find((i) => i.label === 'ग्राहक');
    assert.equal(t?.kind, CompletionItemKind.Class);
    assert.match(t?.detail ?? '', /^Customer · /);
    assert.ok(items.some((i) => i.label === 'पूर्णांक'), '本地化内置类型');
    assert.ok(!items.some((i) => i.label === 'दोगुना'), '类型位置不给函数');
  });
});
