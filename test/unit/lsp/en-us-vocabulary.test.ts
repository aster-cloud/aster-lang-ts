/**
 * en-US 文档的租户领域词汇（issue #365）。
 *
 * ★LSP 中 en-US 以 lexicon === undefined 表示（「无 lexicon 即内置英文」），解析与诊断依赖这一点。
 *   buildCanonicalizeOptions 曾把 undefined 当成「缺参数」直接返回，于是 (tenant, domain, en-US)
 *   的词汇从未被查询：canonicalPreview 的 mappings 为空，词汇补全与悬停缺失。
 *   修复后按 en-US 查词汇，但传给 canonicalize / lex / parse 的 lexicon 仍为 undefined。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { vocabularyRegistry, initBuiltinVocabularies } from '../../../src/config/lexicons/identifiers/registry.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';
import { lookup } from '../../../src/config/lexicons/identifiers/scopes.js';
import { foldKey } from '../../../src/config/lexicons/identifiers/casefold.js';
import { buildCanonicalizeOptions } from '../../../src/lsp/canonicalize-options.js';
import { parseDocumentText } from '../../../src/lsp/parse-document.js';
import { registerCanonicalPreviewHandler } from '../../../src/lsp/canonical-preview.js';
import type { CanonicalPreview } from '../../../src/lsp/canonical-preview.js';
import { compile } from '../../../src/browser.js';

const TENANT = 'tenant-en365-unit';
const DOMAIN = 'insurance.en365unit';
const VOCAB = {
  id: DOMAIN, name: 'en-US #365', locale: 'en-US', version: '1.0.0',
  structs: [{ canonical: 'Driver', localized: 'Motorist', kind: 'struct' }],
  fields: [{ canonical: 'age', localized: 'years', kind: 'field', parent: 'Driver' }],
  functions: [], enumValues: [],
  literals: [{ canonical: 'gold', localized: 'topTier', kind: 'literal' }],
} as unknown as DomainVocabulary;

initBuiltinVocabularies();
vocabularyRegistry.registerCustom(TENANT, VOCAB);

const DOC = [
  'Module m.',
  '',
  'Define Motorist has years as Int.',
  '',
  'Rule total given f as Motorist, produce Int:',
  '  Return f.years plus f.years.',
  '',
  'Rule tier, produce Text:',
  '  Return topTier.',
  '',
].join('\n');

/** 不含任何词汇写法的 en-US 文档：带不带租户上下文，解析结果须逐字段相同 */
const PLAIN = [
  'Module demo.p.',
  '',
  'Define Point has x as Int, y as Int.',
  '',
  'Rule classify given n as Int, produce Text:',
  '  If n greater than 0 then Return "pos".',
  '  Return "other".',
  '',
  'Rule broken given n as Int produce:',
  '',
].join('\n');

describe('buildCanonicalizeOptions：en-US（lexicon undefined）', () => {
  it('★有完整租户上下文时按 en-US 查到词汇，options 的 lexicon 保持 undefined', () => {
    const opts = buildCanonicalizeOptions(undefined, TENANT, DOMAIN);
    assert.ok(opts && 'vocabulary' in opts, '应返回带词汇的 options（修复前返回 undefined）');
    assert.equal(opts.lexicon, undefined, '解析路径的 lexicon 不应被替换');
    assert.deepEqual(lookup(opts.vocabulary.types, 'Motorist').exact.map((c) => c.canonical), ['Driver']);
  });

  it('缺 tenantId / domain、或租户无 en-US 词汇时仍返回 undefined', () => {
    assert.equal(buildCanonicalizeOptions(undefined, undefined, DOMAIN), undefined);
    assert.equal(buildCanonicalizeOptions(undefined, TENANT, undefined), undefined);
    assert.equal(buildCanonicalizeOptions(undefined, 'other-tenant', DOMAIN), undefined, '租户隔离');
  });
});

describe('parseDocumentText：en-US', () => {
  it('★带租户上下文时取到 en-US 词汇', () => {
    const r = parseDocumentText(DOC, undefined, TENANT, DOMAIN);
    assert.ok(r.vocabulary, '修复前 vocabulary 缺省');
    assert.equal(r.vocabulary.literals.get(foldKey('topTier')), 'gold');
  });

  it('★不含词汇写法的文档：带不带租户上下文，can / tokens / ast / 诊断完全相同', () => {
    const plain = parseDocumentText(PLAIN, undefined, undefined, undefined);
    const tenant = parseDocumentText(PLAIN, undefined, TENANT, DOMAIN);
    assert.equal(tenant.can, plain.can);
    assert.deepEqual(tenant.tokens, plain.tokens);
    assert.deepEqual(tenant.ast, plain.ast);
    assert.deepEqual(tenant.parseDiagnostics, plain.parseDiagnostics);
    assert.ok(plain.parseDiagnostics.length > 0, '夹具应含一条解析错误，诊断路径也被比较');
  });
});

describe('aster/canonicalPreview：server 路径（getLexiconForDoc 返回 undefined）', () => {
  it('★en-US 文档的 mappings 含类型、字段与字面量宏，预览与带词汇编译的 Core IR 一致', () => {
    let handler: ((p: unknown) => CanonicalPreview | null) | undefined;
    const connection = { onRequest: (_m: string, fn: typeof handler) => { handler = fn; } };
    const uri = 'file:///en365.aster';
    const documents = { get: (u: string) => (u === uri ? TextDocument.create(uri, 'aster', 1, DOC) : undefined) };
    // 与 server.ts 的 getOrParse 同形：lexicon 为 en-US 的 undefined，租户上下文来自 initialize
    const getOrParse = (doc: TextDocument) => ({ ...parseDocumentText(doc.getText(), undefined, TENANT, DOMAIN), text: doc.getText() });
    registerCanonicalPreviewHandler(connection as never, documents, getOrParse, () => undefined);

    const p = handler!({ textDocument: { uri } });
    assert.ok(p, '预览不应为 null');
    const expected = DOC.replace(/Motorist/g, 'Driver').replace(/years/g, 'age').replace('topTier', '"gold"');
    assert.equal(p.text, expected);
    assert.deepEqual(p.mappings.map((m) => m.canonical), ['Driver', 'age', 'Driver', 'age', 'age', 'gold']);
    for (const m of p.mappings) assert.equal(p.text.slice(...m.preview), m.role === 'LITERAL' ? '"gold"' : m.canonical);
    const at = DOC.indexOf('Motorist');
    assert.deepEqual(p.mappings[0]!.source, [at, at + 'Motorist'.length]);

    const withVocab = compile(DOC, { vocabulary: VOCAB });
    const plain = compile(p.text);
    assert.ok(withVocab.success && plain.success, JSON.stringify([withVocab, plain]));
    assert.deepEqual(stripOrigin(plain.core), stripOrigin(withVocab.core));
  });
});

function stripOrigin(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripOrigin);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).filter(([k]) => k !== 'origin').map(([k, v]) => [k, stripOrigin(v)]),
  );
}
