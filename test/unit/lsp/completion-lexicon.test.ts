import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerCompletionHandlers } from '../../../src/lsp/completion.js';
import { KW } from '../../../src/config/semantic.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

/**
 * 补全的关键词必须取自**该文档的 lexicon**，而不是硬编码的英文 `KW`。
 *
 * ★真实缺陷：`connection.onCompletion` 此前忽略入参、直接 `Object.values(KW)`——
 * 而 KW 是 `config/semantic.ts` 里写死的英文规范拼写（module / use / define…）。
 * 于是写 zh-CN 的用户敲出补全，拿到的是 `module, use, as`，
 * 而他实际要写的是 `模块, 引用, 作为`：**补全给的每一个词都是错的**，选中即产生解析错误。
 *
 * 同文件的诊断 / 跳转 / 代码操作三条路径都已正确接收 `getLexiconForDoc`，唯独补全漏了
 * ——属"同类调用在同一模块里不一致"，是识别此类遗漏的可靠信号。
 *
 * ★本测试走**真实的 registerCompletionHandlers 接线**（用 stub connection 捕获 handler），
 * 不复刻取词逻辑——否则测的是测试自己的副本，生产代码改坏了也不会红。
 */

/** 捕获 onCompletion 回调的最小 connection stub。 */
function makeStubConnection(): {
  connection: any;
  invoke: (uri: string) => { label: string }[];
} {
  let handler: ((params: any) => { label: string }[]) | undefined;
  const connection = {
    onCompletion(fn: (params: any) => { label: string }[]) { handler = fn; },
    onCompletionResolve() { /* 本测试不关心 */ },
    // registerCompletionHandlers 还会注册若干自定义请求；这里只需让它们可被调用。
    onRequest() { /* 本测试不关心 */ },
  };
  return {
    connection,
    invoke: (uri: string) => {
      assert.ok(handler, 'onCompletion 未被注册——接线断了');
      return handler!({ textDocument: { uri } });
    },
  };
}

function labelsFor(lexicon: Lexicon | undefined): string[] {
  const { connection, invoke } = makeStubConnection();
  registerCompletionHandlers(
    connection,
    { get: () => undefined },
    () => ({ text: '', tokens: [], ast: undefined }),
    () => lexicon,
  );
  return invoke('file:///probe.aster').map((i) => i.label);
}

describe('补全关键词随 lexicon 切换（多语言）', () => {
  it('★zh-CN 文档补全的是中文关键词，而非英文 KW', () => {
    const labels = labelsFor(ZH_CN);

    // 正向：中文规范拼写必须在
    for (const kw of ['模块', '引用', '定义']) {
      assert.ok(labels.includes(kw), `zh-CN 补全应包含「${kw}」，实际前 8 个：${labels.slice(0, 8).join(', ')}`);
    }
    // ★反向：不得再出现英文 KW —— 没有这一条，
    //   把实现写成「中英文全都给」也能让上面变绿，而那同样是错的
    //   （用户会在中文文档里选到 `module`，选中即解析失败）。
    assert.ok(!labels.includes('module'), 'zh-CN 补全不得包含英文 `module`');
    assert.ok(!labels.includes('define'), 'zh-CN 补全不得包含英文 `define`');
  });

  it('★de-DE 文档补全的是德文关键词', () => {
    const labels = labelsFor(DE_DE);
    assert.ok(labels.includes('Modul'), `de-DE 补全应含 Modul，实际：${labels.slice(0, 8).join(', ')}`);
    assert.ok(!labels.includes('module'), 'de-DE 补全不得包含英文 `module`');
  });

  it('无 lexicon 上下文时回退到英文 KW（不得变成空补全）', () => {
    const labels = labelsFor(undefined);
    assert.ok(labels.includes('module'), '回退路径应给出英文 KW');
    assert.ok(labels.length >= Object.values(KW).length, '回退不得丢关键词');
  });

  it('★别名一并纳入补全（ADR 0022 识别侧多对一）', () => {
    // 当前四个内置 lexicon 的 aliases 均为空，故用合成 lexicon 验证**接线**本身。
    // 不这么做的话，将来某个 lexicon 一加别名，补全会静默落后而无人发现。
    const withAlias = {
      ...ZH_CN,
      aliases: { ...(ZH_CN.aliases ?? {}), MODULE_IS: ['模組'] },
    } as unknown as Lexicon;

    const labels = labelsFor(withAlias);
    assert.ok(labels.includes('模組'), `别名「模組」应出现在补全里，实际前 8 个：${labels.slice(0, 8).join(', ')}`);
    // 规范拼写不得因加了别名而消失
    assert.ok(labels.includes('模块'), '加别名不得挤掉规范拼写');
  });

  it('补全项去重（关键词与别名可能重叠）', () => {
    const labels = labelsFor(ZH_CN);
    assert.equal(new Set(labels).size, labels.length, '补全列表存在重复项');
  });
});
