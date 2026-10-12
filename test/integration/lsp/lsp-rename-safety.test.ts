/**
 * 重命名 / 引用的安全性：只有光标落在**位置确定的标识符 token** 上才产生结果。
 *
 * ★冠词（en: the，de: eine）不是 token。旧实现取不到 token 时退回字符级取词拿到 `the`，
 *   再退回全文正则——在 the 上按 F2 会把全文每个 the 都改掉。
 * ★领域词汇：canonicalize 把「申请人」替换成规范名 Applicant。旧实现在原文里找不到
 *   Applicant 就推算位置，该 token 及其后同一行的位置全部错位；推算出的位置绝不能用于编辑。
 * 期望位置一律由原文 indexOf 计算。
 */
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LSPClient } from '../../../scripts/lsp-client-helper.js';
import { FINANCE_LOAN_ZH_CN } from '../../../src/config/lexicons/identifiers/domains/finance.loan.zh-CN.js';

const SERVER = resolve('dist/src/lsp/server.js');
const URI = 'inmemory://policy/default.aster';
type Range = { start: { line: number; character: number }; end: { line: number; character: number } };

function rangeOf(text: string, word: string, nth = 0): Range {
  const lines = text.split('\n');
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    for (let i = lines[line]!.indexOf(word); i !== -1; i = lines[line]!.indexOf(word, i + 1)) {
      const b = lines[line]![i - 1] ?? ' '; const a = lines[line]![i + word.length] ?? ' ';
      if (/[\p{L}\p{N}_]/u.test(b) || /[\p{L}\p{N}_]/u.test(a)) continue;
      if (seen++ === nth) return { start: { line, character: i }, end: { line, character: i + word.length } };
    }
  }
  throw new Error(`${word}#${nth} not found`);
}
const inside = (r: Range, k = 1) => ({ line: r.start.line, character: r.start.character + k });
const sortR = (rs: Range[]) => [...rs].sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character);

let workDir: string;
let client: LSPClient | null = null;
before(() => { workDir = mkdtempSync(join(tmpdir(), 'lsp-rename-safety-')); });
after(() => { client?.close(); rmSync(workDir, { recursive: true, force: true }); });

async function open(locale: string, text: string, initializationOptions: Record<string, unknown> = {}): Promise<LSPClient> {
  client?.close();
  const c = new LSPClient();
  c.spawn(SERVER, { cwd: workDir });
  await c.request('initialize', { processId: process.pid, rootUri: null, capabilities: {}, initializationOptions });
  c.notify('initialized', {});
  c.notify('workspace/didChangeConfiguration', { settings: { asterLanguageServer: { locale, index: { persist: false } } } });
  c.notify('textDocument/didOpen', { textDocument: { uri: URI, languageId: 'aster-cnl', version: 1, text } });
  await new Promise((r) => setTimeout(r, 300));
  client = c;
  return c;
}
const td = { uri: URI };

async function assertNotRenameable(c: LSPClient, at: { line: number; character: number }, label: string) {
  assert.equal(await c.request('textDocument/prepareRename', { textDocument: td, position: at }), null, `prepareRename ${label}`);
  assert.equal(await c.request('textDocument/rename', { textDocument: td, position: at, newName: 'NEU' }), null, `rename ${label}`);
  assert.deepEqual(await c.request('textDocument/references', { textDocument: td, position: at, context: { includeDeclaration: true } }), [], `references ${label}`);
}

const EN = [
  'Module demo.p.', '',
  'Rule helper given x as Int, produce Int:', '  Return x plus 1.', '',
  'Rule twice given x as Int, produce Int:', '  Let the sum be the total plus a helper(the total).', '  Return the sum.', '',
].join('\n');

describe('冠词上不产生重命名 / 引用', () => {
  it('★en：在 the 上 F2 不改任何东西（旧实现把每个 the 都改掉）', async () => {
    const c = await open('en-US', EN);
    await assertNotRenameable(c, inside(rangeOf(EN, 'the', 0)), 'the');
  });

  it('★de：在 eine 上 F2 不改任何东西', async () => {
    const DE = ['Modul demo.p.', '', 'Regel helfer gegeben eine größe als Ganzzahl, liefert Ganzzahl:', '  gib zurueck größe plus 1.', ''].join('\n');
    const c = await open('de-DE', DE);
    await assertNotRenameable(c, inside(rangeOf(DE, 'eine', 0)), 'eine');
  });

  /* A3：标识符恰好是同行被删冠词的子串（he ⊂ the）。对齐若不检查词边界，he 会被对到 the 里 */
  it('★标识符 he 出现在冠词 the 之后：高亮与重命名都落在 he 上', async () => {
    // 冠词 the 紧挨在 he 之前：对齐查找 he 时游标还在 the 之前，不检查词边界就会落进 the 里
    const T = ['Module demo.p.', '', 'Rule f given x as Int, produce Int:', '  Let the he be x plus 1.', '  Return he.', ''].join('\n');
    const c = await open('en-US', T);
    const use = rangeOf(T, 'he', 1);
    const expected = sortR([rangeOf(T, 'he', 0), use]);
    const hl = (await c.request('textDocument/documentHighlight', { textDocument: td, position: inside(use) })) as Array<{ range: Range }>;
    assert.deepEqual(sortR(hl.map((h) => h.range)), expected);
    const r = (await c.request('textDocument/rename', { textDocument: td, position: inside(use), newName: 'h2' })) as { changes: Record<string, Array<{ range: Range }>> };
    assert.deepEqual(sortR(r.changes[URI]!.map((e) => e.range)), expected);
  });
});

const ZH = [
  '模块 demo.p。', '',
  '规则 评估 给定 甲 作为 申请人，乙 作为 整数 产出 整数：', '  返回 乙。', '',
].join('\n');

describe('领域词汇（finance.loan）', () => {
  const init = { tenantId: 'tenant-test', domainVocabularies: [FINANCE_LOAN_ZH_CN] };

  it('★词汇词之后同一行的位置仍是原文坐标（旧实现全部塌缩到同一位置）', async () => {
    const c = await open('zh-CN', ZH, init);
    const use = rangeOf(ZH, '乙', 1);
    const hl = (await c.request('textDocument/documentHighlight', { textDocument: td, position: inside(use, 0) })) as Array<{ range: Range }>;
    assert.deepEqual(sortR(hl.map((h) => h.range)), sortR([rangeOf(ZH, '乙', 0), use]));
    const def = (await c.request('textDocument/definition', { textDocument: td, position: inside(use, 0) })) as { range: Range } | null;
    assert.deepEqual(def?.range.start, rangeOf(ZH, '乙', 0).start);
  });

  it('★词汇词本身不可重命名（它不是用户标识符，位置也不能基于推算）', async () => {
    const c = await open('zh-CN', ZH, init);
    await assertNotRenameable(c, inside(rangeOf(ZH, '申请人', 0)), '申请人');
  });

  /* 用户自己写的 Applicant 与词汇词「申请人」规范化后同名：重命名若只改逐字对齐的那处，
   *   会让两者从同一个名字变成两个名字（语义改变）。必须整体拒绝。 */
  it('★与词汇词同名的标识符：重命名整体拒绝，而不是只改一部分', async () => {
    const T = ['模块 demo.p。', '', '规则 评估 给定 甲 作为 申请人，乙 作为 Applicant 产出 整数：', '  返回 1。', ''].join('\n');
    const c = await open('zh-CN', T, init);
    const at = inside(rangeOf(T, 'Applicant', 0), 2);
    assert.equal(await c.request('textDocument/prepareRename', { textDocument: td, position: at }), null);
    assert.equal(await c.request('textDocument/rename', { textDocument: td, position: at, newName: 'Borrower' }), null);
  });
});

