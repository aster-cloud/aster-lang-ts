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
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
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

const EMPTY_VOCAB = buildVocabularyScopes({ id: 'empty', name: 't', locale: 'en-US', version: '1', structs: [], fields: [], functions: [], enumValues: [] });

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

describe('构造字段补全（`T with …` 的字段名位置，#248）', () => {
  /** 在 DECLS 之后的函数体里写一行 line，光标放在 line 末尾（或 line 中 at 处） */
  function completeInBody(line: string, at = line.length): Item[] {
    const doc = docOf([...DECLS, '规则 f 给定 n 作为 整数，产出 整数：', line, '']);
    return completeAt(doc, DECLS.length + 1, at);
  }

  it('★`司机 包含 ` 之后：列 Driver 的全部字段，本地化写法', () => {
    const items = completeInBody('  令 y 定义为 司机 包含 ');
    assert.deepEqual(labels(items), ['alter', 'name']);
    assert.ok(items.every((i) => i.kind === CompletionItemKind.Field));
    assert.equal(items.find((i) => i.label === 'alter')?.detail, 'age');
  });

  it('★已赋值的字段不再出现：`… alter 将 设为 n，` 之后只剩 name', () => {
    assert.deepEqual(labels(completeInBody('  令 y 定义为 司机 包含 alter 将 设为 n，')), ['name']);
  });

  it('正在输入字段名前缀时同样补全（由客户端按前缀过滤）', () => {
    assert.deepEqual(labels(completeInBody('  令 y 定义为 司机 包含 alter 将 设为 n，na')), ['name']);
  });

  it('值里有括号嵌套的构造：按外层类型补全', () => {
    const items = labels(completeInBody('  令 h 定义为 车主 包含 fahrer 将 设为 (司机 包含 alter 将 设为 1，name 将 设为 "a")，'));
    assert.deepEqual(items, ['jahre']);
  });

  it('光标在嵌套构造的字段位置：按内层类型补全', () => {
    const line = '  令 h 定义为 车主 包含 fahrer 将 设为 (司机 包含 ';
    assert.deepEqual(labels(completeInBody(line)), ['alter', 'name']);
  });

  it('不在构造里（函数调用实参的逗号之后）：不给字段，回到普通补全', () => {
    const items = labels(completeInBody('  返回 检查(n，'));
    assert.ok(!items.includes('alter') && !items.includes('jahre'), `不应给字段：${items}`);
    assert.ok(items.includes('返回'));
  });

  it('值位置（`将 设为` 之后）不给字段', () => {
    const items = labels(completeInBody('  令 y 定义为 司机 包含 alter 将 设为 '));
    assert.ok(!items.includes('name'), `值位置不应给字段：${items}`);
  });

  it('类型不是源码 Data（未知类型）：不给字段', () => {
    const items = labels(completeInBody('  令 y 定义为 未知 包含 '));
    assert.ok(!items.includes('alter'), `${items}`);
  });

  it('en 文档：`Driver with age set to 1, ` 之后只剩 name', () => {
    const lines = ['Module m.', '', 'Define Driver has age as Int, name as Text.', '', 'Rule f given n as Int, produce Driver:',
      '  Return Driver with age set to n, ', ''];
    const doc = docOf(lines);
    let handler: ((params: unknown) => Item[]) | undefined;
    const connection = { onCompletion: (fn: (params: unknown) => Item[]) => { handler = fn; }, onCompletionResolve() {}, onRequest() {} };
    registerCompletionHandlers(connection as never, documentsOf(doc), getOrParseWith(EN_US, EMPTY_VOCAB) as never, () => undefined);
    const items = handler!({ textDocument: { uri: doc.uri }, position: { line: 5, character: lines[5]!.length } });
    assert.deepEqual(labels(items), ['name']);
  });
});

describe('成员位置识别（cloud#660 第 5 轮）', () => {
  it('★行中：`x.` 后还有内容，按接收者类型补全，textEdit 为光标处空范围', () => {
    const line = '  返回 x. 加 1。';
    const at = '  返回 x.'.length;
    const doc = docOf([...DECLS, '规则 f 给定 x 作为 司机，产出 整数：', line, '']);
    const items = completeAt(doc, DECLS.length + 1, at) as Array<Item & { textEdit?: unknown }>;
    assert.deepEqual(labels(items), ['alter', 'name']);
    assert.deepEqual(items.find((i) => i.label === 'alter')?.textEdit, {
      range: { start: { line: DECLS.length + 1, character: at }, end: { line: DECLS.length + 1, character: at } }, newText: 'alter',
    });
  });

  it('★带前缀：`x.al` 的 textEdit 覆盖前缀 al，词汇本地化写法', () => {
    const line = '  返回 x.al';
    const doc = docOf([...DECLS, '规则 f 给定 x 作为 司机，产出 整数：', line, '']);
    const items = completeAt(doc, DECLS.length + 1, line.length) as Array<Item & { textEdit?: { range: { start: { character: number } } } }>;
    assert.deepEqual(labels(items), ['alter', 'name']);
    assert.equal(items[0]!.textEdit?.range.start.character, line.length - 2);
  });

  it('★未完成的块头 `如果 x.`（zh 句末为「。」）：按参数类型补全', () => {
    for (const line of ['  如果 x.', '  如果 x.al']) {
      const doc = docOf([...DECLS, '规则 f 给定 x 作为 司机，产出 整数：', line, '']);
      assert.deepEqual(labels(completeAt(doc, DECLS.length + 1, line.length)), ['alter', 'name'], line);
    }
  });

  it('块头后已有缩进的块体：仍可推断', () => {
    const doc = docOf([...DECLS, '规则 f 给定 x 作为 司机，产出 整数：', '  如果 x.', '    返回 1。', '  返回 0。', '']);
    assert.deepEqual(labels(completeAt(doc, DECLS.length + 1, '  如果 x.'.length)), ['alter', 'name']);
  });

  it('接收者是数字或光标不在成员位置：不给字段', () => {
    const doc = docOf([...DECLS, '规则 f 给定 x 作为 司机，产出 整数：', '  返回 1.', '']);
    assert.ok(!labels(completeAt(doc, DECLS.length + 1, '  返回 1.'.length)).includes('alter'));
  });
});

describe('语法不完整时降级', () => {
  it('★文档其它位置有语法错误：完整声明里的接收者类型仍可信，照常给字段补全（cloud#660 第 5 轮）', () => {
    // 解析器只丢弃未完成的声明；x 所在的函数完整，其参数类型不受影响。诊断仍按原规则降级（见 resolution-diagnostics）。
    const items = labels(completeAfter('x 作为 司机', ['  返回 x.'], ['规则 坏 给定 h 作为 车主，产出 整数：', '  返回 h.fahrer.al']));
    assert.deepEqual(items, ['alter', 'name']);
  });

  it('★未完成的那一行本身：`h.fahrer.al` 按 fahrer 的类型 Driver 补全（前缀 al）', () => {
    const doc = docOf([...DECLS, '规则 坏 给定 h 作为 车主，产出 整数：', '  返回 h.fahrer.al', '']);
    assert.deepEqual(labels(completeAt(doc, DECLS.length + 1, '  返回 h.fahrer.al'.length)), ['alter', 'name']);
  });

  it('半行输入不抛异常', () => {
    for (const tail of ['  返回 x.al', '  返回 x', '  令 y 定义为 司机 包含', '  返回 .']) {
      const doc = docOf([...DECLS, '规则 f 给定 x 作为 司机，产出 整数：', tail, '']);
      completeAt(doc, DECLS.length + 1, tail.length);
    }
  });
});
