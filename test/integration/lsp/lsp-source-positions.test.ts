/**
 * 真实拉起 dist/src/lsp/server.js：LSP 返回的位置必须是**原文**坐标。
 *
 * ★canonicalize 删冠词（en: the/a，de: eine/die/der）会改变行内长度。旧实现把规范化文本
 *   上的列号直接用于原文：`Let the total be helper(x).` 里重命名 helper 改掉的是 ` be he`，
 *   光标在 helper 中间时甚至改成了 x；de 里 `eine größe` 改掉的是 `eine `。
 * 期望位置一律由原文 indexOf 计算，与实现无关。
 */
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LSPClient } from '../../../scripts/lsp-client-helper.js';

const SERVER = resolve('dist/src/lsp/server.js');
const URI = 'inmemory://policy/default.aster';
type Range = { start: { line: number; character: number }; end: { line: number; character: number } };

/** 原文里第 n 次出现 word 的 LSP 范围（独立于实现的期望值） */
function rangeOf(text: string, word: string, nth = 0): Range {
  const lines = text.split('\n');
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    let from = 0;
    for (let i = lines[line]!.indexOf(word, from); i !== -1; i = lines[line]!.indexOf(word, from)) {
      const before = lines[line]![i - 1] ?? ' ';
      const afterCh = lines[line]![i + word.length] ?? ' ';
      from = i + 1;
      if (/[\p{L}\p{N}_]/u.test(before) || /[\p{L}\p{N}_]/u.test(afterCh)) continue;
      if (seen++ === nth) return { start: { line, character: i }, end: { line, character: i + word.length } };
    }
  }
  throw new Error(`${word}#${nth} not found`);
}
const inside = (r: Range, k = 2) => ({ line: r.start.line, character: r.start.character + k });
const sortR = (rs: Range[]) => [...rs].sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character);
function applyEdits(text: string, edits: Array<{ range: Range; newText: string }>): string {
  const lines = text.split('\n');
  for (const e of [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
    const l = lines[e.range.start.line]!;
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character);
  }
  return lines.join('\n');
}

let workDir: string;
let client: LSPClient | null = null;
before(() => { workDir = mkdtempSync(join(tmpdir(), 'lsp-srcpos-')); });
after(() => { client?.close(); rmSync(workDir, { recursive: true, force: true }); });

async function open(locale: string, text: string): Promise<LSPClient> {
  client?.close();
  const c = new LSPClient();
  c.spawn(SERVER, { cwd: workDir });
  await c.request('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  c.notify('initialized', {});
  c.notify('workspace/didChangeConfiguration', { settings: { asterLanguageServer: { locale, index: { persist: false } } } });
  c.notify('textDocument/didOpen', { textDocument: { uri: URI, languageId: 'aster-cnl', version: 1, text } });
  await new Promise((r) => setTimeout(r, 300));
  client = c;
  return c;
}
const td = { uri: URI };

const EN = [
  'Module demo.p.', '',
  'Rule helper given x as Int, produce Int:', '  Return x plus 1.', '',
  'Rule twice given x as Int, produce Int:', '  Let the total be helper(x).', '  Return total.', '',
  'Rule quad given x as Int, produce Int:', '  Return twice(twice(x)).', '',
].join('\n');

describe('en：冠词所在行的位置', () => {
  it('★重命名改对字符，行保持完整；光标在 helper 中间时改的是 helper 而不是 x', async () => {
    const c = await open('en-US', EN);
    const call = rangeOf(EN, 'helper', 1); // Let the total be helper(x) 里的调用
    for (const k of [2, 4]) {
      const r = (await c.request('textDocument/rename', { textDocument: td, position: inside(call, k), newName: 'thrice' })) as { changes: Record<string, Array<{ range: Range; newText: string }>> };
      const edits = r.changes[URI]!;
      assert.deepEqual(sortR(edits.map((e) => e.range)), sortR([rangeOf(EN, 'helper', 0), call]), `k=${k}`);
      const after = applyEdits(EN, edits).split('\n')[6];
      assert.equal(after, '  Let the total be thrice(x).');
    }
  });

  it('★引用 / 高亮 / 跳转定义的范围都是原文坐标', async () => {
    const c = await open('en-US', EN);
    const call = rangeOf(EN, 'helper', 1);
    const expected = sortR([rangeOf(EN, 'helper', 0), call]);
    const refs = (await c.request('textDocument/references', { textDocument: td, position: inside(call), context: { includeDeclaration: true } })) as Array<{ range: Range }>;
    assert.deepEqual(sortR(refs.map((r) => r.range)), expected);
    const hl = (await c.request('textDocument/documentHighlight', { textDocument: td, position: inside(call) })) as Array<{ range: Range }>;
    assert.deepEqual(sortR(hl.map((h) => h.range)), expected);
    const def = (await c.request('textDocument/definition', { textDocument: td, position: inside(call) })) as { range: Range } | null;
    assert.deepEqual(def?.range.start, rangeOf(EN, 'helper', 0).start);
    // total 定义在冠词之后：高亮两处都要对上原文
    const total = rangeOf(EN, 'total', 1);
    const hl2 = (await c.request('textDocument/documentHighlight', { textDocument: td, position: inside(total) })) as Array<{ range: Range }>;
    assert.deepEqual(sortR(hl2.map((h) => h.range)), sortR([rangeOf(EN, 'total', 0), total]));
  });

  it('★关键字不可重命名（en 无 lexicon 时按 en-US 判定）', async () => {
    const c = await open('en-US', EN);
    for (const kw of ['Return', 'Rule']) {
      const at = inside(rangeOf(EN, kw, 0), 1);
      assert.equal(await c.request('textDocument/prepareRename', { textDocument: td, position: at }), null, `prepareRename ${kw}`);
      assert.equal(await c.request('textDocument/rename', { textDocument: td, position: at, newName: 'zzz' }), null, `rename ${kw}`);
    }
  });

  it('★hover 调用处显示被调函数，而不是外层函数', async () => {
    const c = await open('en-US', EN);
    for (const nth of [1, 2]) {
      const h = (await c.request('textDocument/hover', { textDocument: td, position: inside(rangeOf(EN, 'twice', nth)) })) as { contents: { value: string } };
      assert.match(h.contents.value, /twice/, `twice#${nth}: ${h.contents.value}`);
      assert.doesNotMatch(h.contents.value, /quad/);
    }
  });
});

const ZH = [
  '模块 demo.p。', '',
  '规则 加倍 给定 数值 作为 整数 产出 整数：', '  返回 数值 乘以 2。', '',
  '规则 四倍 给定 数值 作为 整数 产出 整数：', '  返回 加倍(加倍(数值))。', '',
].join('\n');

describe('zh', () => {
  it('★hover 调用处显示被调函数「加倍」', async () => {
    const c = await open('zh-CN', ZH);
    const h = (await c.request('textDocument/hover', { textDocument: td, position: inside(rangeOf(ZH, '加倍', 1), 1) })) as { contents: { value: string } };
    assert.match(h.contents.value, /加倍/);
    assert.doesNotMatch(h.contents.value, /四倍/);
  });

  /* T9b：引用若不带 lexicon，「规则」不被识别为关键字，会被当成标识符去找引用 */
  it('★在 zh 关键字上查引用返回空', async () => {
    const c = await open('zh-CN', ZH);
    const refs = (await c.request('textDocument/references', { textDocument: td, position: inside(rangeOf(ZH, '规则', 0), 1), context: { includeDeclaration: true } })) as unknown[];
    assert.deepEqual(refs, []);
  });
});

const DE = [
  'Modul demo.p.', '',
  'Regel helfer gegeben eine größe als Ganzzahl, liefert Ganzzahl:', '  gib zurueck größe plus 1.', '',
  'Regel doppelt gegeben eine zahl als Ganzzahl, liefert Ganzzahl:', '  gib zurueck helfer(zahl) mal 2.', '',
].join('\n');

describe('de：冠词所在行的位置', () => {
  it('★重命名「größe」改对字符（旧实现改掉的是「eine 」）', async () => {
    const c = await open('de-DE', DE);
    const r = (await c.request('textDocument/rename', { textDocument: td, position: inside(rangeOf(DE, 'größe', 0)), newName: 'menge' })) as { changes: Record<string, Array<{ range: Range; newText: string }>> };
    assert.deepEqual(sortR(r.changes[URI]!.map((e) => e.range)), sortR([rangeOf(DE, 'größe', 0), rangeOf(DE, 'größe', 1)]));
    assert.equal(applyEdits(DE, r.changes[URI]!).split('\n')[2], 'Regel helfer gegeben eine menge als Ganzzahl, liefert Ganzzahl:');
  });

  it('★引用 / 高亮 / 跳转定义（参数在冠词之后）', async () => {
    const c = await open('de-DE', DE);
    const use = rangeOf(DE, 'zahl', 1);
    const expected = sortR([rangeOf(DE, 'zahl', 0), use]);
    const refs = (await c.request('textDocument/references', { textDocument: td, position: inside(use), context: { includeDeclaration: true } })) as Array<{ range: Range }>;
    assert.deepEqual(sortR(refs.map((x) => x.range)), expected);
    const hl = (await c.request('textDocument/documentHighlight', { textDocument: td, position: inside(use) })) as Array<{ range: Range }>;
    assert.deepEqual(sortR(hl.map((h) => h.range)), expected);
    const def = (await c.request('textDocument/definition', { textDocument: td, position: inside(rangeOf(DE, 'helfer', 1)) })) as { range: Range } | null;
    assert.deepEqual(def?.range.start, rangeOf(DE, 'helfer', 0).start);
  });

  it('★hover 调用处显示被调函数 helfer', async () => {
    const c = await open('de-DE', DE);
    const h = (await c.request('textDocument/hover', { textDocument: td, position: inside(rangeOf(DE, 'helfer', 1)) })) as { contents: { value: string } };
    assert.match(h.contents.value, /helfer/);
    assert.doesNotMatch(h.contents.value, /doppelt/);
  });
});
