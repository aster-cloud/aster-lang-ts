/**
 * `aster/canonicalPreview`（ADR 0058 §8.2）：经词汇解析的标识符换成规范名、字面量宏换成展开后的
 * 字面量，其余文字原样；mappings 的区间一律是 UTF-16 code unit（ADR §7.8）。
 *
 * 期望偏移一律由原文 / 预览文本的 indexOf 推出（JS 字符串下标即 UTF-16），与实现无关。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  buildCanonicalPreview,
  registerCanonicalPreviewHandler,
  CANONICAL_PREVIEW_METHOD,
} from '../../../src/lsp/canonical-preview.js';
import type { CanonicalPreview } from '../../../src/lsp/canonical-preview.js';
import { escapeStringLiteral } from '../../../src/frontend/string-escapes.js';
import { parseDocumentWith } from '../../../src/lsp/parse-document.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';
import { compile } from '../../../src/browser.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { RESOLVER_VERSION } from '../../../src/version.js';

function vocab(locale: string, extra: Partial<DomainVocabulary>): DomainVocabulary {
  return {
    id: `canonical-preview-${locale}`, name: 't', locale, version: '1',
    structs: [], fields: [], functions: [], enumValues: [], literals: [],
    ...extra,
  } as DomainVocabulary;
}

/** Driver ← Fahrer，字段 age ← alter（6 → 6、5 → 3：第二处起偏移须累计 -2）。 */
const DE_VOCAB = vocab('de-DE', {
  structs: [{ canonical: 'Driver', localized: 'Fahrer', kind: 'struct' }],
  fields: [{ canonical: 'age', localized: 'alter', kind: 'field', parent: 'Driver' }],
} as Partial<DomainVocabulary>);

function preview(text: string, lexicon: Lexicon, vocabulary?: DomainVocabulary): CanonicalPreview {
  const scopes = vocabulary ? buildVocabularyScopes(vocabulary) : undefined;
  return buildCanonicalPreview(text, parseDocumentWith(text, lexicon, scopes), lexicon);
}

/** 原文中第 nth 次出现 needle 的 [start, end)（UTF-16）。 */
function rangeIn(text: string, needle: string, nth = 0): [number, number] {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf(needle, at + 1);
  assert.ok(at >= 0, `找不到第 ${nth} 个 ${needle}`);
  return [at, at + needle.length];
}

const DE_DOC = [
  'Modul m.',
  '',
  'Definiere Fahrer hat alter als Ganzzahl.',
  '',
  'Regel summe gegeben f als Fahrer, liefert Ganzzahl:',
  '  gib zurueck f.alter plus f.alter.',
  '',
].join('\n');

describe('canonicalPreview：标识符替换与偏移', () => {
  it('★de-DE：Fahrer → Driver，mappings[0] 的 source / preview 区间正确', () => {
    const p = preview(DE_DOC, DE_DE, DE_VOCAB);
    const first = p.mappings[0]!;
    assert.deepEqual(first.source, rangeIn(DE_DOC, 'Fahrer'));
    assert.deepEqual(first.preview, rangeIn(p.text, 'Driver'));
    assert.equal(first.canonical, 'Driver');
    assert.equal(first.role, 'TYPE_DECL');
    assert.equal(p.text.slice(...first.preview), 'Driver');
  });

  it('★替换发生在第 3 行时偏移含前两行长度（含换行）', () => {
    const p = preview(DE_DOC, DE_DE, DE_VOCAB);
    const lineStart = 'Modul m.\n\n'.length;
    assert.equal(p.mappings[0]!.source[0], lineStart + 'Definiere '.length);
  });

  it('★同一行两次替换：第二处 preview 起点按第一处已替换长度累计', () => {
    const p = preview(DE_DOC, DE_DE, DE_VOCAB);
    const line6 = p.mappings.filter((m) => m.canonical === 'age' && m.source[0] > DE_DOC.indexOf('gib'));
    assert.equal(line6.length, 2, JSON.stringify(p.mappings));
    const [a, b] = line6;
    assert.deepEqual(a!.source, rangeIn(DE_DOC, 'alter', 1));
    assert.deepEqual(b!.source, rangeIn(DE_DOC, 'alter', 2));
    // 此前每处 alter → age 各缩短 2；本行前已有声明处 1 次、本行第一处 1 次
    assert.equal(a!.preview[0], a!.source[0] - 2);
    assert.equal(b!.preview[0], b!.source[0] - 4);
    assert.equal(p.text.slice(...b!.preview), 'age');
    assert.equal(p.text, DE_DOC.replace(/Fahrer/g, 'Driver').replace(/alter/g, 'age'));
  });

  it('★前一行含代理对字符时偏移按 UTF-16 计（比码点数多 1）', () => {
    const text = DE_DOC.replace('Modul m.\n', 'Modul m.\n// 😀\n');
    const p = preview(text, DE_DE, DE_VOCAB);
    const [start] = p.mappings[0]!.source;
    assert.equal(start, text.indexOf('Fahrer'));
    assert.equal(start, [...text.slice(0, start)].length + 1);
    assert.equal(p.mappings[0]!.preview[0], p.text.indexOf('Driver'));
  });

  it('无词汇：text 等于源码，mappings 为空', () => {
    const p = preview(DE_DOC, DE_DE);
    assert.equal(p.text, DE_DOC);
    assert.deepEqual(p.mappings, []);
  });

  it('resolverVersion 恒为 RESOLVER_VERSION', () => {
    assert.equal(preview(DE_DOC, DE_DE, DE_VOCAB).resolverVersion, RESOLVER_VERSION);
    assert.equal(preview(DE_DOC, DE_DE).resolverVersion, RESOLVER_VERSION);
  });
});

const LITERAL_CASES = [
  {
    name: 'en-US',
    lexicon: EN_US,
    doc: (word: string) => `Module m.\n\nRule greet, produce Text:\n  Return ${word}.\n`,
    quote: ['"', '"'],
  },
  {
    name: 'zh-CN',
    lexicon: ZH_CN,
    doc: (word: string) => `模块 m。\n\n规则 greet，产出 文本：\n  返回 ${word}。\n`,
    quote: ['「', '」'],
  },
] as const;

/** Core IR 中全部字符串字面量的值。 */
function stringLiterals(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => stringLiterals(n, out));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o.kind === 'String' && typeof o.value === 'string') out.push(o.value);
    Object.values(o).forEach((v) => stringLiterals(v, out));
  }
  return out;
}

for (const c of LITERAL_CASES) {
  describe(`canonicalPreview：字面量宏 ${c.name}`, () => {
    it(`★展开为 ${c.quote[0]}…${c.quote[1]}，role === 'LITERAL'`, () => {
      const text = c.doc('greeting');
      const v = vocab(c.lexicon.id, { literals: [{ canonical: 'Hallo', localized: 'greeting', kind: 'literal' }] } as Partial<DomainVocabulary>);
      const p = preview(text, c.lexicon, v);
      assert.equal(p.text, c.doc(`${c.quote[0]}Hallo${c.quote[1]}`));
      assert.equal(p.mappings.length, 1);
      const m = p.mappings[0]!;
      assert.equal(m.role, 'LITERAL');
      assert.equal(m.canonical, 'Hallo');
      assert.deepEqual(m.source, rangeIn(text, 'greeting'));
      assert.equal(p.text.slice(...m.preview), `${c.quote[0]}Hallo${c.quote[1]}`);
    });

    it('★宏值含 " \\ 换行 」 时预览经 compile 成功，Core IR 中该字面量值等于宏值', () => {
      const value = 'a"b\\c\nd」e\'f\tg\u0001h';
      const text = c.doc('greeting');
      const v = vocab(c.lexicon.id, { literals: [{ canonical: value, localized: 'greeting', kind: 'literal' }] } as Partial<DomainVocabulary>);
      const p = preview(text, c.lexicon, v);
      const r = compile(p.text, { lexicon: c.lexicon });
      assert.ok(r.success, `预览编译失败：${p.text}\n${JSON.stringify(r.parseErrors ?? r)}`);
      assert.deepEqual(stringLiterals(r.core), [value]);
    });
  });
}

describe('escapeStringLiteral', () => {
  it('readEscape 的逆：单字符转义、其余控制字符与结束引号写作 \\uXXXX', () => {
    assert.equal(escapeStringLiteral('\\"\'\n\r\t\b\f\0', '"'), '\\\\\\"\\\'\\n\\r\\t\\b\\f\\0');
    assert.equal(escapeStringLiteral('a\u0001b\u001f', '"'), 'a\\u0001b\\u001F');
    assert.equal(escapeStringLiteral('「x」', '」'), '「x\\u300D');
    assert.equal(escapeStringLiteral('😀é', '」'), '😀é');
  });
});

describe('registerCanonicalPreviewHandler', () => {
  function handlerFor(text: string | undefined) {
    let method: string | undefined;
    let handler: ((p: unknown) => CanonicalPreview | null) | undefined;
    const connection = { onRequest: (m: string, fn: typeof handler) => { method = m; handler = fn; } };
    const uri = 'file:///canonical-preview.aster';
    const documents = { get: (u: string) => (text !== undefined && u === uri ? TextDocument.create(uri, 'aster', 1, text) : undefined) };
    const scopes = buildVocabularyScopes(DE_VOCAB);
    const getOrParse = (doc: TextDocument) => ({ ...parseDocumentWith(doc.getText(), DE_DE, scopes), text: doc.getText() });
    registerCanonicalPreviewHandler(connection as never, documents, getOrParse, () => DE_DE);
    return { method, call: () => handler!({ textDocument: { uri } }) };
  }

  it('方法名为 aster/canonicalPreview，按文档 lexicon 与词汇生成预览', () => {
    const { method, call } = handlerFor(DE_DOC);
    assert.equal(CANONICAL_PREVIEW_METHOD, 'aster/canonicalPreview');
    assert.equal(method, CANONICAL_PREVIEW_METHOD);
    assert.equal(call()!.text, DE_DOC.replace(/Fahrer/g, 'Driver').replace(/alter/g, 'age'));
  });

  it('文档不存在返回 null', () => {
    assert.equal(handlerFor(undefined).call(), null);
  });
});
