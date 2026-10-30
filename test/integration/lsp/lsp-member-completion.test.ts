/**
 * 成员（字段）补全的协议级测试：真实拉起 dist/src/lsp/server.js（stdio），按 aster-cloud 编辑器的方式
 * 发 `textDocument/completion`（含 triggerKind / triggerCharacter）。
 *
 * 生产复测第 5 轮（cloud#660）的失败情形：
 *   (a) de 行中 `fahrer.` 之后还有 ` plus 1.`，输入 `.` 自动触发或手动触发都没有字段；
 *   (b) en `d.` 之后继续输入字母（`d.a`，带前缀）没有字段；
 *   (c) zh 行尾 `司机.`（zh 句末是「。」，`.` 让该行无法解析）自动与手动都没有字段。
 * 字段项须带 textEdit：替换点号之后到光标的已输入前缀（cloud#660 按 textEdit 的范围插入）。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LSPClient } from '../../../scripts/lsp-client-helper.js';

const SERVER = resolve('dist/src/lsp/server.js');
const workDir = mkdtempSync(join(tmpdir(), 'lsp-member-completion-'));

interface Item {
  label: string;
  kind?: number;
  detail?: string;
  textEdit?:
    | { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }
    | { insert: object; replace: object; newText: string };
}
type Completion = Item[] | { items: Item[] } | null;

const FIELD = 5;
const INVOKED = { triggerKind: 1 };
const DOT = { triggerKind: 2, triggerCharacter: '.' };

const DE_HEAD = ['Modul demo.p.', '', 'Definiere Fahrer hat alter als Ganzzahl, stufe als Text.', '', 'Regel f gegeben fahrer als Fahrer, liefert Ganzzahl:'];
const EN_HEAD = ['Module demo.p.', '', 'Define Driver has name as Text, age as Int.', '', 'Rule f given d as Driver, produce Int:'];
const ZH_HEAD = ['模块 demo.p。', '', '定义 驾驶员 包含 年龄 作为 整数，姓名 作为 文本。', '', '规则 f 给定 司机 作为 驾驶员，产出 整数：'];

let client: LSPClient;
let seq = 0;

before(async () => {
  client = new LSPClient();
  client.spawn(SERVER, { cwd: workDir });
  await client.request('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  client.notify('initialized', {});
});

after(() => {
  client.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** 以 locale 打开 lines，在第 line 行 character 处请求补全 */
async function complete(locale: string, lines: readonly string[], line: number, character: number, context: object, via: LSPClient = client): Promise<Item[]> {
  via.notify('workspace/didChangeConfiguration', { settings: { asterLanguageServer: { locale, index: { persist: false } } } });
  const uri = `inmemory://policy/member-${seq++}.aster`;
  via.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'aster-cnl', version: 1, text: lines.join('\n') } });
  const res = (await via.request('textDocument/completion', { textDocument: { uri }, position: { line, character }, context })) as Completion;
  return Array.isArray(res) ? res : res?.items ?? [];
}

const fieldsOf = (items: Item[]) => items.filter((i) => i.kind === FIELD).map((i) => i.label).sort();

/** 字段项的 textEdit 替换 [line:from, line:to) 为自身 label */
function assertEdits(items: Item[], line: number, from: number, to: number): void {
  for (const i of items.filter((x) => x.kind === FIELD)) {
    assert.deepEqual(i.textEdit, { range: { start: { line, character: from }, end: { line, character: to } }, newText: i.label }, i.label);
  }
}

describe('成员补全：协议级', () => {
  it('基线：de 行尾 `fahrer.` 手动触发', async () => {
    const body = '  gib zurueck fahrer.';
    const items = await complete('de-DE', [...DE_HEAD, body, ''], 5, body.length, INVOKED);
    assert.deepEqual(fieldsOf(items), ['alter', 'stufe']);
    assert.equal(items.length, 2, '成员位置只给字段');
    assertEdits(items, 5, body.length, body.length);
  });

  it('★(a) de 行中 `fahrer.` 后跟 ` plus 1.`：输入 `.` 自动触发与手动触发都列 Driver 字段', async () => {
    const body = '  gib zurueck fahrer. plus 1.';
    const at = '  gib zurueck fahrer.'.length;
    for (const ctx of [DOT, INVOKED]) {
      const items = await complete('de-DE', [...DE_HEAD, body, ''], 5, at, ctx);
      assert.deepEqual(fieldsOf(items), ['alter', 'stufe'], JSON.stringify(ctx));
      assertEdits(items, 5, at, at);
    }
  });

  it('★(a) 行中带前缀：`fahrer.al` 后跟 ` plus 1.`', async () => {
    const body = '  gib zurueck fahrer.al plus 1.';
    const dot = '  gib zurueck fahrer.'.length;
    const items = await complete('de-DE', [...DE_HEAD, body, ''], 5, dot + 2, INVOKED);
    assert.deepEqual(fieldsOf(items), ['alter', 'stufe']);
    assertEdits(items, 5, dot, dot + 2);
  });

  it('★(b) en `d.a`（行尾、带前缀，无句号）：列 Driver 字段，textEdit 覆盖前缀 a', async () => {
    const body = '  Return d.a';
    const items = await complete('en-US', [...EN_HEAD, body, ''], 5, body.length, INVOKED);
    assert.deepEqual(fieldsOf(items), ['age', 'name']);
    assertEdits(items, 5, body.length - 1, body.length);
  });

  it('(b) en `d.ag` 后面还有句号', async () => {
    const body = '  Return d.ag.';
    const items = await complete('en-US', [...EN_HEAD, body, ''], 5, body.length - 1, INVOKED);
    assert.deepEqual(fieldsOf(items), ['age', 'name']);
    assertEdits(items, 5, body.length - 3, body.length - 1);
  });

  it('★(c) zh 行尾 `如果 司机.`：自动与手动触发都列 驾驶员 的字段', async () => {
    const body = '  如果 司机.';
    for (const ctx of [DOT, INVOKED]) {
      const items = await complete('zh-CN', [...ZH_HEAD, body, ''], 5, body.length, ctx);
      assert.deepEqual(fieldsOf(items), ['姓名', '年龄'].sort(), JSON.stringify(ctx));
      assertEdits(items, 5, body.length, body.length);
    }
  });

  it('(c) zh 模板写法：参数省略类型时没有可补全的字段（类型按规则推断为 文本，§4 不认推断类型）', async () => {
    // 生产复测里 `如果 驾驶员.` 的模板参数没写类型：解析器把它推断为 Text，不是 struct，
    // 因此这里不给字段是正确行为；模板写上 `作为 驾驶员` 后即可补全（见上一条）。
    const lines = ['模块 demo.p。', '', '定义 驾驶员 包含 年龄 作为 整数，姓名 作为 文本。', '', '规则 f 给定 驾驶员，产出 整数：', '  如果 驾驶员.', ''];
    const items = await complete('zh-CN', lines, 5, '  如果 驾驶员.'.length, DOT);
    assert.deepEqual(fieldsOf(items), []);
  });

  it('★(c) zh `返回 司机.` 行尾', async () => {
    const body = '  返回 司机.';
    const items = await complete('zh-CN', [...ZH_HEAD, body, ''], 5, body.length, DOT);
    assert.deepEqual(fieldsOf(items), ['姓名', '年龄'].sort());
  });

  it('★文档别处有未完成的行（语法错误）时，成员补全仍可用', async () => {
    const body = '  gib zurueck fahrer.';
    const lines = [...DE_HEAD, body, '', 'Regel g gegeben x als Ganzzahl, liefert Ganzzahl:', '  gib zurueck x plus', ''];
    const items = await complete('de-DE', lines, 5, body.length, DOT);
    assert.deepEqual(fieldsOf(items), ['alter', 'stufe']);
  });

  it('多段路径 `h.fahrer.` 行中', async () => {
    const lines = ['Module demo.p.', '', 'Define Driver has name as Text, age as Int.', '', 'Define Owner has driver as Driver.', '',
      'Rule f given h as Owner, produce Int:', '  Return h.driver. plus 1.', ''];
    const at = '  Return h.driver.'.length;
    const items = await complete('en-US', lines, 7, at, DOT);
    assert.deepEqual(fieldsOf(items), ['age', 'name']);
  });

  it('接收者类型未知：不给字段，回到普通补全', async () => {
    const lines = ['Module demo.p.', '', 'Rule f given n as Int, produce Int:', '  Return n.a', ''];
    const items = await complete('en-US', lines, 3, '  Return n.a'.length, INVOKED);
    assert.deepEqual(fieldsOf(items), []);
    assert.ok(items.length > 0);
  });

  it('小数 `1.` 不是成员访问', async () => {
    const lines = [...EN_HEAD, '  Return 1.', ''];
    const items = await complete('en-US', lines, 5, '  Return 1.'.length, DOT);
    assert.deepEqual(fieldsOf(items), []);
  });

  it('#259 光标在名字中间 `d.ag|e`、客户端未声明 insertReplaceSupport：TextEdit 覆盖整个名字', async () => {
    const body = '  Return d.age.';
    const dot = '  Return d.'.length;
    const items = await complete('en-US', [...EN_HEAD, body, ''], 5, dot + 2, INVOKED);
    assert.deepEqual(fieldsOf(items), ['age', 'name']);
    assertEdits(items, 5, dot, dot + 3);
  });
});

describe('成员补全：客户端支持 InsertReplaceEdit（#259）', () => {
  let irClient: LSPClient;
  before(async () => {
    irClient = new LSPClient();
    irClient.spawn(SERVER, { cwd: workDir });
    await irClient.request('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: { textDocument: { completion: { completionItem: { insertReplaceSupport: true } } } },
    });
    irClient.notify('initialized', {});
  });
  after(() => irClient.close());

  it('`d.ag|e`：insert 为点号后到光标，replace 延伸到名字末尾', async () => {
    const body = '  Return d.age.';
    const dot = '  Return d.'.length;
    const items = await complete('en-US', [...EN_HEAD, body, ''], 5, dot + 2, INVOKED, irClient);
    assert.deepEqual(fieldsOf(items), ['age', 'name']);
    for (const i of items.filter((x) => x.kind === FIELD)) {
      assert.deepEqual(i.textEdit, {
        insert: { start: { line: 5, character: dot }, end: { line: 5, character: dot + 2 } },
        replace: { start: { line: 5, character: dot }, end: { line: 5, character: dot + 3 } },
        newText: i.label,
      });
    }
  });

  it('光标在名字末尾：仍为普通 TextEdit', async () => {
    const body = '  Return d.ag.';
    const items = await complete('en-US', [...EN_HEAD, body, ''], 5, body.length - 1, INVOKED, irClient);
    assertEdits(items, 5, body.length - 3, body.length - 1);
  });
});
