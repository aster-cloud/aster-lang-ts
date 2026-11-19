/**
 * en-US 文档同样应用租户领域词汇（issue #365）：真实拉起 dist/src/lsp/server.js（stdio）。
 *
 * ★en-US 时 server 的 currentLexicon 为 undefined（「无 lexicon 即内置英文」），而
 *   buildCanonicalizeOptions 曾在 lexicon 缺省时直接返回，(tenant, domain, en-US) 的词汇从未被查询：
 *   canonicalPreview 的 mappings 为空，词汇术语补全、悬停 `written → canonical` 全部缺失；
 *   同一请求在 de-DE 上正常。这里两条路径都锁：从未推送 locale（初始状态）与显式推送 en-US。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LSPClient } from '../../../scripts/lsp-client-helper.js';

const SERVER = resolve('dist/src/lsp/server.js');
const workDir = mkdtempSync(join(tmpdir(), 'lsp-en-us-vocabulary-'));
const clients: LSPClient[] = [];

after(() => {
  for (const c of clients) c.close();
  rmSync(workDir, { recursive: true, force: true });
});

const DOMAIN = 'insurance.en365';
/** Driver ← Motorist、age ← years（Driver 的字段）、Applicant ← Customer、函数 double ← twice */
const VOCAB = {
  id: DOMAIN, name: 'en-US vocabulary #365', locale: 'en-US', version: '1.0.0',
  structs: [
    { canonical: 'Driver', localized: 'Motorist', kind: 'struct' },
    { canonical: 'Applicant', localized: 'Customer', kind: 'struct' },
  ],
  fields: [{ canonical: 'age', localized: 'years', kind: 'field', parent: 'Driver' }],
  functions: [{ canonical: 'double', localized: 'twice', kind: 'function' }],
  enumValues: [], literals: [],
};
const INIT = { tenantId: 'tenant-en365', domainVocabularies: [VOCAB] };

const DOC = [
  'Module m.',
  '',
  'Define Motorist has years as Int.',
  '',
  'Rule total given f as Motorist, produce Int:',
  '  Return f.years plus f.years.',
  '',
].join('\n');

interface Mapping { source: [number, number]; preview: [number, number]; canonical: string; role: string }
interface Preview { text: string; mappings: Mapping[] }
interface Item { label: string; kind?: number; detail?: string }

let seq = 0;

/** 以 initializationOptions 拉起 server；pushLocale 为 true 时显式推送 en-US，否则保持初始（从未推送）状态 */
async function open(pushLocale: boolean, text = DOC): Promise<{ c: LSPClient; uri: string }> {
  const c = new LSPClient();
  clients.push(c);
  c.spawn(SERVER, { cwd: workDir });
  await c.request('initialize', { processId: process.pid, rootUri: null, capabilities: {}, initializationOptions: INIT });
  c.notify('initialized', {});
  if (pushLocale) {
    c.notify('workspace/didChangeConfiguration', { settings: { asterLanguageServer: { locale: 'en-US', index: { persist: false } } } });
  }
  const uri = `inmemory://policy/en365-${seq++}.aster`;
  c.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'aster-cnl', version: 1, text } });
  await new Promise((r) => setTimeout(r, 300));
  return { c, uri };
}

async function complete(c: LSPClient, uri: string, line: number, character: number): Promise<Item[]> {
  const res = (await c.request('textDocument/completion', {
    textDocument: { uri }, position: { line, character }, context: { triggerKind: 1 },
  })) as Item[] | { items: Item[] } | null;
  return Array.isArray(res) ? res : res?.items ?? [];
}

for (const pushLocale of [false, true]) {
  describe(`en-US 租户词汇（${pushLocale ? '显式推送 locale=en-US' : '从未推送 locale'}）`, () => {
    it('★aster/canonicalPreview：Motorist → Driver、years → age，mappings 区间正确', async () => {
      const { c, uri } = await open(pushLocale);
      const p = (await c.request('aster/canonicalPreview', { textDocument: { uri } })) as Preview | null;
      assert.ok(p, '预览不应为 null');
      assert.equal(p.text, DOC.replace(/Motorist/g, 'Driver').replace(/years/g, 'age'));
      assert.equal(p.mappings.length, 5, JSON.stringify(p.mappings));
      const first = p.mappings[0]!;
      const at = DOC.indexOf('Motorist');
      assert.deepEqual(first.source, [at, at + 'Motorist'.length]);
      assert.equal(first.canonical, 'Driver');
      assert.equal(first.role, 'TYPE_DECL');
      assert.equal(p.text.slice(...first.preview), 'Driver');
      for (const m of p.mappings) assert.equal(p.text.slice(...m.preview), m.canonical);
    });

    it('★词汇术语补全：表达式位置给词汇函数 twice，类型位置给词汇类型 Customer', async () => {
      const { c, uri } = await open(pushLocale);
      const values = await complete(c, uri, 5, '  Return '.length);
      const twice = values.find((i) => i.label === 'twice');
      assert.ok(twice, `表达式位置缺词汇函数：${values.map((i) => i.label).join(', ')}`);
      assert.match(twice.detail ?? '', /^double · /);
      const types = await complete(c, uri, 4, 'Rule total given f as '.length);
      const customer = types.find((i) => i.label === 'Customer');
      assert.ok(customer, `类型位置缺词汇类型：${types.map((i) => i.label).join(', ')}`);
      assert.match(customer.detail ?? '', /^Applicant · /);
    });

    it('★成员补全经词汇：参数类型写作 Motorist 解析到 Driver，f. 之后的字段 age 以写法 years 列出', async () => {
      const text = DOC
        .replace('Define Motorist has years as Int.', 'Define Driver has age as Int.')
        .replace('  Return f.years plus f.years.', '  Return f.');
      const { c, uri } = await open(pushLocale, text);
      const items = await complete(c, uri, 5, '  Return f.'.length);
      assert.deepEqual(items.filter((i) => i.kind === 5).map((i) => i.label), ['years']);
    });

    it('★悬停：years 显示 years → age', async () => {
      const { c, uri } = await open(pushLocale);
      const character = '  Return f.'.length + 1;
      const h = (await c.request('textDocument/hover', { textDocument: { uri }, position: { line: 5, character } })) as
        { contents: { value: string } } | null;
      assert.ok(h, '悬停不应为空');
      assert.match(h.contents.value, /years → age/);
    });
  });
}

describe('en-US 无租户词汇时行为不变', () => {
  it('无 initializationOptions：canonicalPreview 原样、mappings 为空', async () => {
    const c = new LSPClient();
    clients.push(c);
    c.spawn(SERVER, { cwd: workDir });
    await c.request('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
    c.notify('initialized', {});
    const uri = `inmemory://policy/en365-${seq++}.aster`;
    c.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'aster-cnl', version: 1, text: DOC } });
    const p = (await c.request('aster/canonicalPreview', { textDocument: { uri } })) as Preview | null;
    assert.ok(p);
    assert.equal(p.text, DOC);
    assert.deepEqual(p.mappings, []);
  });
});
