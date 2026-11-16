/**
 * 类型位置补全（ADR 0058 §8.1）：类型位置给本文档声明与按 lexicon 本地化的内置类型，
 * 表达式 / 语句位置不给类型项。走真实的 registerCompletionHandlers 接线。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompletionItemKind } from 'vscode-languageserver/node.js';
import { registerCompletionHandlers } from '../../../src/lsp/completion.js';
import { isTypePosition, typeCompletions } from '../../../src/lsp/type-completion.js';
import { parseDocumentText } from '../../../src/lsp/parse-document.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { SemanticTokenKind } from '../../../src/config/token-kind.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { docOf, documentsOf, getOrParseWith } from './resolution-fixture.js';
import type { Doc } from './resolution-fixture.js';

interface Item { label: string; kind?: number; detail?: string }

function completeAt(doc: Doc, line: number, character: number, lexicon: Lexicon): Item[] {
  let handler: ((params: unknown) => { isIncomplete: boolean; items: Item[] }) | undefined;
  const connection = {
    onCompletion: (fn: (params: unknown) => { isIncomplete: boolean; items: Item[] }) => { handler = fn; },
    onCompletionResolve() {},
    onRequest() {},
  };
  registerCompletionHandlers(connection as never, documentsOf(doc), getOrParseWith(lexicon) as never, () => lexicon);
  assert.ok(handler, 'onCompletion 未注册');
  return handler!({ textDocument: { uri: doc.uri }, position: { line, character } }).items;
}

interface Lang {
  readonly name: string;
  readonly lexicon: Lexicon;
  readonly head: readonly string[];
  readonly field: string;
  readonly param: string;
  readonly ret: string;
  readonly expr: string;
  readonly importAs: string;
  readonly shared: readonly string[];
  readonly localizedText: string;
}

const LANGS: readonly Lang[] = [
  {
    name: 'en-US', lexicon: EN_US,
    head: ['Module m.', '', 'Use foo.bar as L.', '', 'Type Score as Int.', '', 'Define Driver has name as Text.', ''],
    field: 'Define Owner has d as ',
    param: 'Rule f given x as ',
    ret: 'Rule f given x as Int, produce ',
    expr: '  Return ',
    importAs: 'Use foo.baz as ',
    shared: ['Define Fahrer has fahrer as Int.', 'Type fahrer as Int.'],
    localizedText: 'Text',
  },
  {
    name: 'de-DE', lexicon: DE_DE,
    head: ['Modul m.', '', 'verwende foo.bar als L.', '', 'Type Score als Ganzzahl.', '', 'Definiere Driver hat name als Text.', ''],
    field: 'Definiere Owner hat d als ',
    param: 'Regel f gegeben x als ',
    ret: 'Regel f gegeben x als Ganzzahl, liefert ',
    expr: '  gib zurueck ',
    importAs: 'verwende foo.baz als ',
    shared: ['Definiere Fahrer hat fahrer als Ganzzahl.', 'Type fahrer als Ganzzahl.'],
    localizedText: 'Text',
  },
  {
    name: 'zh-CN', lexicon: ZH_CN,
    head: ['模块 m。', '', '引用 foo.bar 作为 L。', '', 'Type Score 作为 整数。', '', '定义 Driver 包含 name 作为 文本。', ''],
    field: '定义 Owner 包含 d 作为 ',
    param: '规则 f 给定 x 作为 ',
    ret: '规则 f 给定 x 作为 整数，产出 ',
    expr: '  返回 ',
    importAs: '引用 foo.baz 作为 ',
    shared: ['定义 司机 包含 司机 作为 整数。', 'Type 司机 作为 整数。'],
    localizedText: '文本',
  },
];

const builtins = (lex: Lexicon): string[] => [SemanticTokenKind.TEXT, SemanticTokenKind.INT_TYPE, SemanticTokenKind.FLOAT_TYPE, SemanticTokenKind.BOOL_TYPE]
  .map((k) => lex.keywords[k]!);

/** 把 tail 作为末行放在 head 之后，光标置于行末。 */
function atEnd(lang: Lang, tail: string, extra: readonly string[] = []): Item[] {
  const doc = docOf([...lang.head, ...extra, tail]);
  return completeAt(doc, lang.head.length + extra.length, tail.length, lang.lexicon);
}

for (const lang of LANGS) {
  describe(`类型位置补全 ${lang.name}`, () => {
    it('★字段类型位置：本文档 Driver、别名 Score、导入别名 L、本地化内置类型', () => {
      const items = atEnd(lang, lang.field);
      const by = new Map(items.map((i) => [i.label, i]));
      assert.equal(by.get('Driver')?.kind, CompletionItemKind.Class);
      assert.equal(by.get('Score')?.kind, CompletionItemKind.TypeParameter);
      assert.equal(by.get('Score')?.detail, 'Int', '别名 detail 为目标类型文本');
      assert.equal(by.get('L')?.kind, CompletionItemKind.Module);
      assert.equal(by.get('L')?.detail, 'foo.bar');
      for (const b of builtins(lang.lexicon)) assert.equal(by.get(b)?.kind, CompletionItemKind.Class, `缺少内置类型 ${b}`);
    });

    it('参数类型位置与返回类型位置同样给出类型', () => {
      for (const tail of [lang.param, lang.ret]) {
        const labels = atEnd(lang, tail).map((i) => i.label);
        assert.ok(labels.includes('Driver') && labels.includes('Score') && labels.includes('L'), `${tail}：${labels}`);
      }
    });

    it('★表达式位置不给类型项，仍给关键词', () => {
      const items = atEnd(lang, lang.expr, [lang.ret.replace(/ *$/, '') + ' ' + lang.lexicon.keywords[SemanticTokenKind.INT_TYPE] + '：']);
      const labels = items.map((i) => i.label);
      assert.ok(!labels.includes('Driver') && !labels.includes('Score') && !labels.includes('L'), `不应给声明类型：${labels}`);
      assert.ok(items.every((i) => i.kind === CompletionItemKind.Keyword), '表达式位置不应有 Class / TypeParameter / Module 项');
      assert.ok(labels.includes(lang.lexicon.keywords[SemanticTokenKind.RETURN]!), '应回到关键词补全');
    });

    it('导入别名 as 之后不是类型位置', () => {
      const labels = atEnd(lang, lang.importAs).map((i) => i.label);
      assert.ok(!labels.includes('Driver'), `导入别名位置不应给类型：${labels}`);
    });

    it('★结构体名与字段名共用同一词、且与别名折叠同名：类型位置只出现一次，kind=Class', () => {
      const items = atEnd(lang, lang.field, lang.shared);
      const shared = lang.shared[0]!.split(' ')[1]!;
      const hits = items.filter((i) => i.label.toLowerCase() === shared.toLowerCase());
      assert.equal(hits.length, 1, `实际：${JSON.stringify(hits)}`);
      assert.equal(hits[0]!.kind, CompletionItemKind.Class);
    });

    it('typeCompletions 无 AST 时只给内置类型', () => {
      assert.deepEqual(typeCompletions(null, lang.lexicon).map((i) => i.label).sort(), builtins(lang.lexicon).sort());
    });
  });
}

describe('isTypePosition 边界', () => {
  const tokensOf = (text: string) => parseDocumentText(text, EN_US, undefined, undefined).tokens as never;
  const at = (text: string): boolean => {
    const lines = text.split('\n');
    return isTypePosition(tokensOf(text), { line: lines.length - 1, character: lines[lines.length - 1]!.length }, EN_US);
  };

  it('正在输入的类型前缀仍属类型位置；as 紧贴光标时仍在输入关键词', () => {
    assert.equal(at('Define A has x as Te'), true);
    assert.equal(at('Define A has x as'), false);
  });

  it('逗号后是新字段名、Let 的 be 之后是表达式，都不是类型位置', () => {
    assert.equal(at('Define A has x as Int, '), false);
    assert.equal(at('Rule f given x as Int, produce Int:\n  Let y be '), false);
  });

  it('类型参数列表内：of / and / maybe / map ... to', () => {
    assert.equal(at('Define A has x as Pair of '), true);
    assert.equal(at('Define A has x as Pair of Int and '), true);
    assert.equal(at('Define A has x as maybe '), true);
    assert.equal(at('Define A has x as map Text to '), true);
    assert.equal(at('Define A has x as list of '), true);
  });

  it('上一条语句的 as 不外溢；空文档不是类型位置', () => {
    assert.equal(at('Define A has x as Int.\n'), false);
    assert.equal(at(''), false);
  });

  it('★Let 注解类型位置：Let x as 之后是类型', () => {
    assert.equal(at('Rule f given y as Int, produce Int:\n  Let x as '), true);
  });
});
