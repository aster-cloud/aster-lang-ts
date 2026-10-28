/**
 * `x.` 之后的字段补全（ADR 0051 §5「LSP」：FIELD_REF 按接收者类型过滤）。
 *
 * 接收者类型取 R2 的 §4 显式声明规则（参数 / 构造 / 源码函数调用 / 已知类型的点分路径），
 * 只列该 struct 的字段，按文档词汇给出本地化写法，无本地化时给规范名。
 * 语法不完整时 R2 跳过，降级为不提供字段补全（回到普通补全），且不抛异常。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompletionItemKind } from 'vscode-languageserver/node.js';
import { registerCompletionHandlers } from '../../../src/lsp/completion.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DECLS, docOf, documentsOf, getOrParseWith } from './resolution-fixture.js';
import type { Doc } from './resolution-fixture.js';

interface Item { label: string; kind?: number; detail?: string }

function completeAt(doc: Doc, line: number, character: number): Item[] {
  let handler: ((params: unknown) => Item[]) | undefined;
  const connection = {
    onCompletion: (fn: (params: unknown) => Item[]) => { handler = fn; },
    onCompletionResolve() {},
    onRequest() {},
  };
  registerCompletionHandlers(connection as never, documentsOf(doc), getOrParseWith(ZH_CN) as never, () => ZH_CN);
  assert.ok(handler, 'onCompletion 未注册');
  return handler!({ textDocument: { uri: doc.uri }, position: { line, character } });
}

/** 在 DECLS 之后加一个函数，body 为 lines；返回补全位置为 body 第 0 行末尾。 */
function completeAfter(params: string, body: readonly string[], extra: readonly string[] = []): Item[] {
  const doc = docOf([...DECLS, `规则 f 给定 ${params}，产出 整数：`, ...body, '', ...extra]);
  return completeAt(doc, DECLS.length + 1, body[0]!.length);
}

const labels = (items: Item[]) => items.map((i) => i.label).sort();

describe('x. 之后的字段补全', () => {
  it('★参数 x 为 司机：只列 Driver 的字段，本地化写法优先、无本地化给规范名', () => {
    const items = completeAfter('x 作为 司机', ['  返回 x.']);
    assert.deepEqual(labels(items), ['alter', 'name']);
    assert.ok(items.every((i) => i.kind === CompletionItemKind.Field));
    assert.equal(items.find((i) => i.label === 'alter')?.detail?.includes('age'), true, '本地化项应注明规范名');
  });

  it('★不混入其它 struct 的字段与关键词', () => {
    const items = labels(completeAfter('x 作为 司机', ['  返回 x.']));
    assert.ok(!items.includes('jahre') && !items.includes('fahrer'), `混入了 Owner 的字段：${items}`);
    assert.ok(!items.includes('返回'), `混入了关键词：${items}`);
  });

  it('★多段路径 h.fahrer.：按 fahrer 的声明类型 Driver 补全', () => {
    assert.deepEqual(labels(completeAfter('h 作为 车主', ['  返回 h.fahrer.'])), ['alter', 'name']);
  });

  it('接收者为 Owner：本地化 jahre / fahrer', () => {
    assert.deepEqual(labels(completeAfter('h 作为 车主', ['  返回 h.'])), ['fahrer', 'jahre']);
  });

  it('构造得到的局部名：令 y 定义为 司机 包含 … 后 y. 补全 Driver 的字段', () => {
    const doc = docOf([
      ...DECLS,
      '规则 f 给定 n 作为 整数，产出 整数：',
      '  令 y 定义为 司机 包含 alter 将 设为 n，name 将 设为 "a"。',
      '  返回 y.',
      '',
    ]);
    assert.deepEqual(labels(completeAt(doc, DECLS.length + 2, '  返回 y.'.length)), ['alter', 'name']);
  });

  it('接收者类型未知：不提供字段补全，回到普通补全', () => {
    const doc = docOf([...DECLS, '规则 f 给定 n 作为 整数，产出 整数：', '  令 y 定义为 n。', '  返回 y.', '']);
    const items = labels(completeAt(doc, DECLS.length + 2, '  返回 y.'.length));
    assert.ok(!items.includes('alter'), `类型未知不应给字段：${items}`);
    assert.ok(items.includes('返回'), '应回到普通（关键词）补全');
  });
});

describe('语法不完整时降级', () => {
  it('★文档其它位置有语法错误：R2 跳过，不提供字段补全，不抛异常', () => {
    const items = labels(completeAfter('x 作为 司机', ['  返回 x.'], ['规则 坏 给定 h 作为 车主，产出 整数：', '  返回 h.fahrer.al']));
    assert.ok(!items.includes('alter'), `语法不完整时不应给字段补全：${items}`);
    assert.ok(items.includes('返回'));
  });

  it('半行输入不抛异常', () => {
    for (const tail of ['  返回 x.al', '  返回 x', '  令 y 定义为 司机 包含', '  返回 .']) {
      const doc = docOf([...DECLS, '规则 f 给定 x 作为 司机，产出 整数：', tail, '']);
      completeAt(doc, DECLS.length + 1, tail.length);
    }
  });
});
