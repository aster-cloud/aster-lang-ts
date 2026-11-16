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

/** 类型构造关键词（maybe / option of / result of）的规范拼写 */
const constructors = (lex: Lexicon): string[] => [SemanticTokenKind.MAYBE, SemanticTokenKind.OPTION_OF, SemanticTokenKind.RESULT_OF]
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
      const typeKinds: (number | undefined)[] = [CompletionItemKind.Class, CompletionItemKind.TypeParameter, CompletionItemKind.Module];
      assert.ok(items.every((i) => !typeKinds.includes(i.kind)), '表达式位置不应有 Class / TypeParameter / Module 项');
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

    it('typeCompletions 无 AST 时只给内置类型（Class）与类型构造词（Keyword）', () => {
      const items = typeCompletions(null, lang.lexicon);
      const ofKind = (k: number) => items.filter((i) => i.kind === k).map((i) => i.label).sort();
      assert.deepEqual(ofKind(CompletionItemKind.Class), builtins(lang.lexicon).sort());
      assert.deepEqual(ofKind(CompletionItemKind.Keyword), [...constructors(lang.lexicon), 'list of', 'map'].sort());
      assert.equal(items.length, builtins(lang.lexicon).length + constructors(lang.lexicon).length + 2);
    });

    it('★类型位置给本地化类型构造词（maybe / option of / result of，Keyword）', () => {
      const by = new Map(atEnd(lang, lang.field).map((i) => [i.label, i]));
      for (const c of [...constructors(lang.lexicon), 'list of', 'map']) {
        assert.equal(by.get(c)?.kind, CompletionItemKind.Keyword, `缺少类型构造词 ${c}`);
      }
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

describe('isTypePosition 本地化类型参数位置', () => {
  const at = (lexicon: Lexicon, text: string): boolean => {
    const lines = text.split('\n');
    const tokens = parseDocumentText(text, lexicon, undefined, undefined).tokens as never;
    return isTypePosition(tokens, { line: lines.length - 1, character: lines[lines.length - 1]!.length }, lexicon);
  };

  it('★de-DE：多词关键字 Option aus / Ergebnis aus 按 token 序列匹配，und 引出下一个类型参数', () => {
    const head = 'Modul m.\n\nDefiniere A hat x als ';
    assert.equal(at(DE_DE, head + 'Option aus '), true);
    assert.equal(at(DE_DE, head + 'Ergebnis aus '), true);
    assert.equal(at(DE_DE, head + 'Ergebnis aus Ganzzahl und '), true);
    assert.equal(at(DE_DE, head + 'vielleicht '), true);
    assert.equal(at(DE_DE, head + 'Paar of Ganzzahl und '), true);
    assert.equal(at(DE_DE, head + 'map Text auf '), true);
    assert.equal(at(DE_DE, head + 'Option '), false, '只写了多词关键字的前半');
    assert.equal(at(DE_DE, 'Modul m.\n\nRegel f gegeben x als Ganzzahl und '), false, '形参之间的 und 不是类型参数位置');
  });

  it('★zh-CN：结果 / 选项 / 可选 之后、结果 … 并且 之后是类型位置', () => {
    const head = '模块 m。\n\n定义 A 包含 x 作为 ';
    assert.equal(at(ZH_CN, head + '结果 '), true);
    assert.equal(at(ZH_CN, head + '结果 整数 并且 '), true);
    assert.equal(at(ZH_CN, head + '选项 '), true);
    assert.equal(at(ZH_CN, head + '可选 '), true);
    assert.equal(at(ZH_CN, '模块 m。\n\n规则 f 给定 x 作为 整数 并且 '), false, '形参之间的 并且 不是类型参数位置');
  });

  it('en-US 对照：option of / result of … and', () => {
    const head = 'Module m.\n\nDefine A has x as ';
    assert.equal(at(EN_US, head + 'option of '), true);
    assert.equal(at(EN_US, head + 'result of Int and '), true);
    assert.equal(at(EN_US, head + 'option '), false);
  });
});
