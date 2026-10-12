/**
 * 真实拉起 dist/src/lsp/server.js（stdio），按 aster-cloud 编辑器的方式使用：
 * inmemory:// 文档、只推 locale 设置、不声明 workspace.configuration。
 *
 * ★锁住服务端接线：getOrParse 必须把文档 lexicon 交给解析（M5：传 undefined 会让
 *   zh 文档的符号/hover 全部失败），rename/references 必须读打开中的内存文本。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LSPClient } from '../../../scripts/lsp-client-helper.js';

/* ★必须在独立空目录里启动：未传 rootUri 时服务端把 cwd 当工作区，扫描其中的 .aster 文件并
 *   读回 cwd/.asteri 的持久化索引。在仓库根启动会把语料里的同名符号算进引用（CI 实测 7 != 2）。
 *   这与 aster-cloud 网关为每个连接分配独立工作目录是同一个隔离要求。 */
const SERVER = resolve('dist/src/lsp/server.js');
const workDir = mkdtempSync(join(tmpdir(), 'lsp-zh-nav-'));

const URI = 'inmemory://policy/default.aster';
const ZH_DOC = '模块 demo.p。\n\n定义 Req 包含\n  a 作为 整数。\n\n规则 helper 给定 x 作为 整数 产出 整数：\n  返回 x 加上 1。\n\n规则 twice 给定 r 作为 Req 产出 整数：\n  返回 helper(r.a) 乘以 2。\n';

let initCapabilities: { experimental?: { aster?: Record<string, boolean> } } = {};

async function open(locale: string, text: string): Promise<LSPClient> {
  const client = new LSPClient();
  client.spawn(SERVER, { cwd: workDir });
  const init = (await client.request('initialize', { processId: process.pid, rootUri: null, capabilities: {} })) as { capabilities: typeof initCapabilities };
  initCapabilities = init.capabilities;
  client.notify('initialized', {});
  // 持久化索引关掉：测试不在仓库目录写 .asteri/
  client.notify('workspace/didChangeConfiguration', { settings: { asterLanguageServer: { locale, index: { persist: false } } } });
  client.notify('textDocument/didOpen', { textDocument: { uri: URI, languageId: 'aster-cnl', version: 1, text } });
  await new Promise((r) => setTimeout(r, 300));
  return client;
}

describe('LSP zh + inmemory 文档（真实服务端进程）', () => {
  let client: LSPClient | null = null;
  after(() => { client?.close(); rmSync(workDir, { recursive: true, force: true }); });

  it('★文档符号 / hover / 跳转定义 / 重命名 / 引用 都返回真实结果', async () => {
    client = await open('zh-CN', ZH_DOC);

    // 客户端按这两个标志决定是否注册对应功能（见 server.ts experimental.aster）
    assert.deepEqual(initCapabilities.experimental?.aster, { localizedParsing: true, openDocumentNavigation: true });

    const symbols = (await client.request('textDocument/documentSymbol', { textDocument: { uri: URI } })) as Array<{ name: string }>;
    assert.deepEqual(symbols.map((s) => s.name), ['demo.p']);

    const hover = (await client.request('textDocument/hover', { textDocument: { uri: URI }, position: { line: 8, character: 4 } })) as { contents: { value: string } };
    assert.match(hover.contents.value, /twice/);

    const def = (await client.request('textDocument/definition', { textDocument: { uri: URI }, position: { line: 9, character: 6 } })) as { uri: string; range: { start: { line: number } } };
    assert.equal(def.uri, URI);
    assert.equal(def.range.start.line, 5);

    const rename = (await client.request('textDocument/rename', { textDocument: { uri: URI }, position: { line: 5, character: 4 }, newName: 'inc' })) as { changes: Record<string, unknown[]> };
    assert.equal(rename.changes[URI]?.length, 2, `helper 定义 + 调用应各改一处，实际: ${JSON.stringify(rename)}`);

    const refs = (await client.request('textDocument/references', { textDocument: { uri: URI }, position: { line: 5, character: 4 }, context: { includeDeclaration: true } })) as Array<{ uri: string }>;
    assert.equal(refs.length, 2);
    assert.ok(refs.every((r) => r.uri === URI));
  });

  /* ★标识符本身是中文 / 带变音的德文时，引用与重命名必须按 lexicon 的词法规则取词。
   *   旧实现 captureWordAt 只认 [A-Za-z0-9_.]：「加倍」上 prepareRename 成功、rename 回 null、
   *   引用回 []。文档里故意放一个字符串字面量「加倍」：按 token 精确匹配时不应被算进去，
   *   漏传 lexicon（退化成正则）时会多算一处，从而让测试变红。 */
  it('★zh 中文标识符：重命名与引用命中定义与调用，不含字符串字面量', async () => {
    client?.close();
    const ZH_CJK = '模块 demo.p。\n\n规则 加倍 给定 数值 作为 整数 产出 整数：\n  返回 数值 乘以 2。\n\n规则 四倍 给定 数值 作为 整数 产出 整数：\n  返回 加倍(加倍(数值))。\n\n规则 名称 给定 数值 作为 整数 产出 文本：\n  返回 「加倍」。\n';
    client = await open('zh-CN', ZH_CJK);
    const at = { line: 2, character: 4 }; // 定义处的「加倍」

    const prep = (await client.request('textDocument/prepareRename', { textDocument: { uri: URI }, position: at })) as { placeholder: string } | null;
    assert.equal(prep?.placeholder, '加倍');

    const rename = (await client.request('textDocument/rename', { textDocument: { uri: URI }, position: at, newName: '翻倍' })) as { changes: Record<string, Array<{ range: { start: { line: number } } }>> } | null;
    const lines = (rename?.changes[URI] ?? []).map((e) => e.range.start.line).sort();
    assert.deepEqual(lines, [2, 6, 6], `应改定义 1 处 + 调用 2 处，实际: ${JSON.stringify(rename)}`);

    const refs = (await client.request('textDocument/references', { textDocument: { uri: URI }, position: at, context: { includeDeclaration: true } })) as Array<{ range: { start: { line: number } } }>;
    assert.deepEqual(refs.map((r) => r.range.start.line).sort(), [2, 6, 6]);
  });

  it('★de 带变音的标识符可重命名', async () => {
    client?.close();
    const DE = 'Modul demo.p.\n\nRegel verdoppeln gegeben größe als Ganzzahl, liefert Ganzzahl:\n  gib zurueck größe mal 2.\n';
    client = await open('de-DE', DE);
    const rename = (await client.request('textDocument/rename', { textDocument: { uri: URI }, position: { line: 2, character: 27 }, newName: 'menge' })) as { changes: Record<string, unknown[]> } | null;
    assert.equal(rename?.changes[URI]?.length, 2, `参数与使用各一处，实际: ${JSON.stringify(rename)}`);
  });
});
