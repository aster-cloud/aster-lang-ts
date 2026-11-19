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
import { parseDocumentWith } from '../../../src/lsp/parse-document.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';
import { compile } from '../../../src/browser.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
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
  const p = buildCanonicalPreview(text, parseDocumentWith(text, lexicon, scopes), lexicon);
  assert.ok(p, '预览不应为 null');
  return p;
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

  it('★hi-IN：天城文写法的类型与字段换成规范名，偏移按 UTF-16，与带词汇编译源码的 Core IR 相同', () => {
    const text = [
      'मॉड्यूल m.',
      '',
      'परिभाषित ग्राहक रखता है आयु रूप में पूर्णांक.',
      '',
      'नियम देखें दिया गया c रूप में ग्राहक, उत्पन्न पूर्णांक:',
      '  लौटाएं c.आयु जोड़ c.आयु.',
      '',
    ].join('\n');
    const v = vocab('hi-IN', {
      structs: [{ canonical: 'Customer', localized: 'ग्राहक', kind: 'struct' }],
      fields: [{ canonical: 'age', localized: 'आयु', kind: 'field', parent: 'Customer' }],
    } as Partial<DomainVocabulary>);
    const p = assertFaithful(text, HI_IN, v);
    assert.equal(p.text, text.replace(/ग्राहक/g, 'Customer').replace(/आयु/g, 'age'));
    assert.deepEqual(p.mappings[0]!.source, rangeIn(text, 'ग्राहक'));
    assert.deepEqual(p.mappings[0]!.preview, rangeIn(p.text, 'Customer'));
    const ages = p.mappings.filter((m) => m.canonical === 'age');
    assert.equal(ages.length, 3, JSON.stringify(p.mappings));
    assert.deepEqual(ages[2]!.source, rangeIn(text, 'आयु', 2));
    assert.equal(p.text.slice(...ages[2]!.preview), 'age');
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
    name: 'de-DE',
    lexicon: DE_DE,
    doc: (word: string) => `Modul m.\n\nRegel gruss, liefert Text:\n  gib zurück ${word}.\n`,
    quote: ['"', '"'],
  },
  {
    name: 'zh-CN',
    lexicon: ZH_CN,
    doc: (word: string) => `模块 m。\n\n规则 greet，产出 文本：\n  返回 ${word}。\n`,
    quote: ['「', '」'],
  },
  {
    name: 'hi-IN',
    lexicon: HI_IN,
    doc: (word: string) => `मॉड्यूल m.\n\nनियम greet, उत्पन्न पाठ:\n  लौटाएं ${word}.\n`,
    quote: ['"', '"'],
  },
] as const;

for (const c of LITERAL_CASES) {
  describe(`canonicalPreview：字面量宏 ${c.name}`, () => {
    it(`★展开为 ${c.quote[0]}…${c.quote[1]}，role === 'LITERAL'；与带词汇编译源码的 Core IR 相同`, () => {
      const text = c.doc('greeting');
      const v = vocab(c.lexicon.id, { literals: [{ canonical: 'Hallo', localized: 'greeting', kind: 'literal' }] } as Partial<DomainVocabulary>);
      const p = assertFaithful(text, c.lexicon, v);
      assert.equal(p.text, c.doc(`${c.quote[0]}Hallo${c.quote[1]}`));
      assert.equal(p.mappings.length, 1);
      const m = p.mappings[0]!;
      assert.equal(m.role, 'LITERAL');
      assert.equal(m.canonical, 'Hallo');
      assert.deepEqual(m.source, rangeIn(text, 'greeting'));
      assert.equal(p.text.slice(...m.preview), `${c.quote[0]}Hallo${c.quote[1]}`);
    });

    it('★无需转义的宏值（空格、é、代理对、天城文）：预览与带词汇编译源码的 Core IR 相同', () => {
      const value = 'Grüße é 😀 नमस्ते';
      const v = vocab(c.lexicon.id, { literals: [{ canonical: value, localized: 'greeting', kind: 'literal' }] } as Partial<DomainVocabulary>);
      const p = assertFaithful(c.doc('greeting'), c.lexicon, v);
      assert.equal(p.text, c.doc(`${c.quote[0]}${value}${c.quote[1]}`));
    });

    // 编译器展开宏时按词法器转义 \ 与 "（aster-lang-ts#345），字符串内容不受引号归一影响（aster-lang-ts#347）：
    // 这些值写成字面量后读回的正是宏值，预览照常给出，且与带词汇编译源码的 Core IR 相同。
    // ASCII 引号的词法表里 a"b 即「宏值含结束引号」。
    const escaped: ReadonlyArray<readonly [string, string]> = [
      ['C:\\new', 'C:\\\\new'],
      ['a\\b', 'a\\\\b'],
      ['a"b', 'a\\"b'],
      ['“curly”', '“curly”'],
      ['a“b', 'a“b'],
      ["don't", "don't"],
      ["it's 'ok'", "it's 'ok'"],
      ['‘single’', '‘single’'],
    ];
    for (const [value, written] of escaped) {
      it(`★宏值 ${JSON.stringify(value)} 写成 ${c.quote[0]}${written}${c.quote[1]}：预览与带词汇编译源码的 Core IR 相同`, () => {
        const p = assertFaithful(c.doc('greeting'), c.lexicon, literal(c.lexicon.id, 'greeting', value));
        assert.equal(p.text, c.doc(`${c.quote[0]}${written}${c.quote[1]}`));
      });
    }

    // 写不成字面量的宏值（空、控制字符、「」『』«» 与当前 lexicon 的非 ASCII 引号）：编译器拒绝展开、大声抛错，
    // 与 Java Canonicalizer.expandToken 一致；预览所依赖的文档解析同样失败。
    const rejected = ['a\nb', 'a\tb', 'a\u0001b', '「x」', 'a『b', 'a«b', `a${c.quote[0] === '"' ? '」' : c.quote[1]}b`];
    for (const value of rejected) {
      it(`★宏值 ${JSON.stringify(value)} 写不成字面量：解析抛错（失败闭锁）`, () => {
        const v = vocab(c.lexicon.id, { literals: [{ canonical: value, localized: 'greeting', kind: 'literal' }] } as Partial<DomainVocabulary>);
        assert.throws(() => parseDocumentWith(c.doc('greeting'), c.lexicon, buildVocabularyScopes(v)), /Unsafe literal-macro content/);
      });
    }
  });
}

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

  it('★同一解析快照与 lexicon 复用上次结果；快照或 lexicon 变化时重算', () => {
    let handler: ((p: unknown) => CanonicalPreview | null) | undefined;
    const connection = { onRequest: (_m: string, fn: typeof handler) => { handler = fn; } };
    const uri = 'file:///canonical-preview-cache.aster';
    let version = 1;
    let lexicon: Lexicon = DE_DE;
    const documents = { get: () => TextDocument.create(uri, 'aster', version, DE_DOC) };
    const scopes = buildVocabularyScopes(DE_VOCAB);
    const snapshots = new Map<number, ReturnType<typeof parseDocumentWith> & { text: string }>();
    const getOrParse = (doc: TextDocument) => {
      if (!snapshots.has(doc.version)) snapshots.set(doc.version, { ...parseDocumentWith(doc.getText(), DE_DE, scopes), text: doc.getText() });
      return snapshots.get(doc.version)!;
    };
    registerCanonicalPreviewHandler(connection as never, documents, getOrParse, () => lexicon);
    const call = () => handler!({ textDocument: { uri } });
    const first = call();
    assert.ok(first);
    assert.equal(call(), first, '同一快照应复用同一结果');
    version = 2;
    const second = call();
    assert.notEqual(second, first, '新版本快照应重算');
    assert.deepEqual(second, first);
    lexicon = { ...DE_DE } as Lexicon;
    assert.notEqual(call(), second, 'lexicon 变化应重算');
  });
});

/** 递归去掉 origin（预览改变了行内长度，位置不参与比较）。 */
function stripOrigin(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripOrigin);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).filter(([k]) => k !== 'origin').map(([k, v]) => [k, stripOrigin(v)])
  );
}

/** ADR §8.2 忠实性：不带词汇编译预览文本与带词汇编译源码的 Core IR（去掉 origin）相同。 */
function assertFaithful(text: string, lexicon: Lexicon, v: DomainVocabulary): CanonicalPreview {
  const p = preview(text, lexicon, v);
  const withVocab = compile(text, { lexicon, vocabulary: v });
  assert.ok(withVocab.success && withVocab.core, `带词汇编译源码失败：${JSON.stringify(withVocab.parseErrors ?? withVocab)}`);
  const plain = compile(p.text, { lexicon });
  assert.ok(plain.success && plain.core, `不带词汇编译预览失败：\n${p.text}`);
  assert.deepEqual(stripOrigin(plain.core), stripOrigin(withVocab.core), `预览文本：\n${p.text}`);
  return p;
}

const literal = (locale: string, localized: string, canonical: string): DomainVocabulary =>
  vocab(locale, { literals: [{ canonical, localized, kind: 'literal' }] } as Partial<DomainVocabulary>);
const fn = (locale: string, localized: string, canonical: string): DomainVocabulary =>
  vocab(locale, { functions: [{ canonical, localized, kind: 'function' }] } as Partial<DomainVocabulary>);

describe('canonicalPreview：替换落在编译器实际使用的那个词上（被删冠词与触发词同形）', () => {
  const EN = (body: string): string => `Module m.\n\nRule greet, produce Text:\n${body}\n`;
  const DE = (body: string): string => `Modul m.\n\nRegel gruss, liefert Text:\n${body}\n`;

  it('★en `Return a a.`：规范化删掉第一个冠词 a，宏 a 展开的是第二个', () => {
    const text = EN('  Return a a.');
    const p = assertFaithful(text, EN_US, literal('en-US', 'a', 'hello'));
    assert.equal(p.text, EN('  Return a "hello".'));
    assert.equal(p.mappings.length, 1);
    const second = text.indexOf('a a.') + 2;
    assert.deepEqual(p.mappings[0]!.source, [second, second + 1]);
    assert.equal(p.text.slice(...p.mappings[0]!.preview), '"hello"');
  });

  it('★en `Return a a a.`、`Return the the.`、tab 与多余空格、跨两行', () => {
    assert.equal(assertFaithful(EN('  Return a a a.'), EN_US, literal('en-US', 'a', 'hello')).text, EN('  Return a a "hello".'));
    assert.equal(assertFaithful(EN('  Return the the.'), EN_US, literal('en-US', 'the', 'hello')).text, EN('  Return the "hello".'));
    assert.equal(assertFaithful(EN('\tReturn a  a.'), EN_US, literal('en-US', 'a', 'hello')).text, EN('\tReturn a  "hello".'));
    const two = EN('  Let y be a a.\n  Let z be a.\n  Return z.');
    assert.equal(assertFaithful(two, EN_US, literal('en-US', 'a', 'hello')).text, EN('  Let y be a "hello".\n  Let z be "hello".\n  Return z.'));
  });

  it('★de-DE `gib zurueck die die.` / `der der der` / `ein ein`：宏落在未被删的冠词形词上', () => {
    assert.equal(assertFaithful(DE('  gib zurueck die die.'), DE_DE, literal('de-DE', 'die', 'hallo')).text, DE('  gib zurueck die "hallo".'));
    assert.equal(assertFaithful(DE('  gib zurück der der der.'), DE_DE, literal('de-DE', 'der', 'hallo')).text, DE('  gib zurück der der "hallo".'));
    assert.equal(assertFaithful(DE('  gib zurueck ein ein.'), DE_DE, literal('de-DE', 'ein', 'hallo')).text, DE('  gib zurueck ein "hallo".'));
  });

  it('★经词汇解析的函数名与被删冠词同形：en `a a(1)`、de `die die(1)` 换掉的是调用目标', () => {
    const en = 'Module m.\n\nRule double given x as Int, produce Int:\n  Return x.\n\nRule g, produce Int:\n  Return a a(1).\n';
    assert.equal(assertFaithful(en, EN_US, fn('en-US', 'a', 'double')).text, en.replace('a a(1)', 'a double(1)'));
    const de = 'Modul m.\n\nRegel doppelt gegeben x als Ganzzahl, liefert Ganzzahl:\n  gib zurueck x.\n\nRegel g, liefert Ganzzahl:\n  gib zurueck die die(1).\n';
    assert.equal(assertFaithful(de, DE_DE, fn('de-DE', 'die', 'doppelt')).text, de.replace('die die(1)', 'die doppelt(1)'));
  });

  it('★同一行 10 个 `a a(1)` 以 plus 相连：每个调用目标都换掉，被删的冠词一个不动', () => {
    const calls = Array.from({ length: 10 }, () => 'a a(1)').join(' plus ');
    const en = `Module m.\n\nRule double given x as Int, produce Int:\n  Return x.\n\nRule g, produce Int:\n  Return ${calls}.\n`;
    const p = assertFaithful(en, EN_US, fn('en-US', 'a', 'double'));
    assert.equal(p.text, en.replace(calls, Array.from({ length: 10 }, () => 'a double(1)').join(' plus ')));
    assert.equal(p.mappings.length, 10);
  });

  it('★压力：同一行 50 个 `a a(1)`、宏与函数同形混排，预览仍忠实', () => {
    const calls = Array.from({ length: 50 }, () => 'a a(1)').join(' plus ');
    const en = `Module m.\n\nRule double given x as Int, produce Int:\n  Return x.\n\nRule g, produce Int:\n  Return ${calls}.\n`;
    const p = assertFaithful(en, EN_US, fn('en-US', 'a', 'double'));
    assert.equal(p.mappings.length, 50);
    const lits = Array.from({ length: 50 }, () => 'the the').join(' plus ');
    const txt = `Module m.\n\nRule greet, produce Text:\n  Return ${lits}.\n`;
    const q = assertFaithful(txt, EN_US, literal('en-US', 'the', 'hi'));
    assert.equal(q.text, txt.replace(lits, Array.from({ length: 50 }, () => 'the "hi"').join(' plus ')));
  });

  it('★证明不了的替换不静默略过：整份预览返回 null（探测预算耗尽时）', () => {
    const en = 'Module m.\n\nRule double given x as Int, produce Int:\n  Return x.\n\nRule g, produce Int:\n  Return a a(1) plus a a(1).\n';
    const v = fn('en-US', 'a', 'double');
    const doc = parseDocumentWith(en, EN_US, buildVocabularyScopes(v));
    assert.equal(buildCanonicalPreview(en, doc, EN_US, { probeBudget: 0 }), null);
    assert.notEqual(buildCanonicalPreview(en, doc, EN_US), null);
  });

  it('★同一行既有被删冠词形的函数名又有宏、CRLF 换行、zh 全角写法的函数名', () => {
    const both = 'Module m.\n\nRule double given x as Text, produce Text:\n  Return x.\n\nRule g, produce Text:\n  Return the the(the greeting).\n';
    const v = vocab('en-US', {
      functions: [{ canonical: 'double', localized: 'the', kind: 'function' }],
      literals: [{ canonical: 'hi', localized: 'greeting', kind: 'literal' }],
    } as Partial<DomainVocabulary>);
    assert.equal(assertFaithful(both, EN_US, v).text, both.replace('the the(the greeting)', 'the double(the "hi")'));
    const crlf = EN('  Return a a.').replace(/\n/g, '\r\n');
    assert.equal(assertFaithful(crlf, EN_US, literal('en-US', 'a', 'hello')).text, crlf.replace('a a.', 'a "hello".'));
    const zh = '模块 m。\n\n规则 double 给定 x 作为 整数，产出 整数：\n  返回 x。\n\n规则 g，产出 整数：\n  返回 ｄｂｌ(1)。\n';
    assert.equal(assertFaithful(zh, ZH_CN, fn('zh-CN', 'dbl', 'double')).text, zh.replace('ｄｂｌ', 'double'));
  });
});

