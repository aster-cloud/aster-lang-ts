/**
 * 真实拉起 dist/src/lsp/server.js（stdio），按 aster-cloud 编辑器的方式使用：
 * inmemory:// 文档、只推 locale 设置、不声明 workspace.configuration。
 *
 * ★锁住服务端接线：getOrParse 必须把文档 lexicon 交给解析（M5：传 undefined 会让
 *   zh 文档的符号/hover 全部失败），rename/references 必须读打开中的内存文本。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { LSPClient } from '../../../scripts/lsp-client-helper.js';

const URI = 'inmemory://policy/default.aster';
const ZH_DOC = '模块 demo.p。\n\n定义 Req 包含\n  a 作为 整数。\n\n规则 helper 给定 x 作为 整数 产出 整数：\n  返回 x 加上 1。\n\n规则 twice 给定 r 作为 Req 产出 整数：\n  返回 helper(r.a) 乘以 2。\n';

async function open(locale: string, text: string): Promise<LSPClient> {
  const client = new LSPClient();
  client.spawn('dist/src/lsp/server.js');
  await client.request('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  client.notify('initialized', {});
  // 持久化索引关掉：测试不在仓库目录写 .asteri/
  client.notify('workspace/didChangeConfiguration', { settings: { asterLanguageServer: { locale, index: { persist: false } } } });
  client.notify('textDocument/didOpen', { textDocument: { uri: URI, languageId: 'aster-cnl', version: 1, text } });
  await new Promise((r) => setTimeout(r, 300));
  return client;
}

describe('LSP zh + inmemory 文档（真实服务端进程）', () => {
  let client: LSPClient | null = null;
  after(() => client?.close());

  it('★文档符号 / hover / 跳转定义 / 重命名 / 引用 都返回真实结果', async () => {
    client = await open('zh-CN', ZH_DOC);

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
});
