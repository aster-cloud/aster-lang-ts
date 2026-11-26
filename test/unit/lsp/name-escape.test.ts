/**
 * LSP 的名字转义支持（ADR 0064 §6）：快速修复「用作名字」、悬停说明、补全插入转义写法与语义着色。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CodeActionKind } from 'vscode-languageserver/node.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { compile } from '../../../src/browser.js';
import {
  completionName,
  escapeAllOccurrences,
  escapedHoverLine,
  isKeywordHomograph,
  keywordSpellingAt,
} from '../../../src/lsp/name-escape.js';
import { computeDiagnostics } from '../../../src/lsp/diagnostics.js';
import { parseDocumentText } from '../../../src/lsp/parse-document.js';
import { registerCodeActionHandlers } from '../../../src/lsp/codeaction.js';
import { SEM_LEGEND } from '../../../src/lsp/tokens.js';

function applyEdits(text: string, edits: ReturnType<typeof escapeAllOccurrences>): string {
  const lines = text.split('\n');
  for (const e of [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
    const l = lines[e.range.start.line]!;
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character);
  }
  return lines.join('\n');
}

interface Fix { title: string; kind: string; edit: { changes: Record<string, { range: unknown; newText: string }[]> } }
type Diag = { code: string; message: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; data?: unknown };

/** 以文档词法表注册 codeAction 处理器，对给定诊断求快速修复。 */
async function codeActionsFor(text: string, diagnostics: readonly Diag[], lexicon?: Lexicon): Promise<Fix[]> {
  const handlers: Record<string, (p: unknown) => Promise<unknown>> = {};
  const connection = { onCodeAction: (h: (p: unknown) => Promise<unknown>) => { handlers.codeAction = h; } };
  const documents = { get: () => ({ uri: 'file:///t.aster', getText: () => text }) };
  registerCodeActionHandlers(connection as never, documents as never, () => ({ text, tokens: [], ast: {} }), () => null,
    lexicon ? () => lexicon : undefined);
  return (await handlers.codeAction!({ textDocument: { uri: 'file:///t.aster' }, context: { diagnostics } })) as Fix[];
}

/**
 * aster-cloud 发给 LSP 的 E901 marker：`compile()` 的 1 基 span 原样成为 Monaco marker，monaco-languageclient 转成 0 基 LSP 范围。
 * 断言它是零宽的——#401 的前提。
 */
function cloudE901(text: string, lexicon: Lexicon): Diag {
  const e = (compile(text, { lexicon }).parseErrors ?? []).find(x => x.code === 'E901');
  assert.ok(e?.span, '期望 compile() 报 E901');
  const range = {
    start: { line: e.span.start.line - 1, character: e.span.start.col - 1 },
    end: { line: e.span.end.line - 1, character: e.span.end.col - 1 },
  };
  assert.deepEqual(range.start, range.end, '编译器给 E901 的是零宽 span');
  return { code: 'E901', message: e.message, range, data: e.params };
}

describe('名字转义的 LSP 支持（ADR 0064 §6）', () => {
  it('用作名字：整词出现都改成转义，字符串、注释、已有转义与更长的词不动', () => {
    const text = '规则 取值 给定 当 作为 整数，产出 整数：\n  令 当前 定义为 当。 # 当\n  返回 「当」 加上 `当` 加上 当。\n';
    const out = applyEdits(text, escapeAllOccurrences(text, '当'));
    assert.equal(out, '规则 取值 给定 `当` 作为 整数，产出 整数：\n  令 当前 定义为 `当`。 # 当\n  返回 「当」 加上 `当` 加上 `当`。\n');
  });

  it('含反引号或为空的词不给修复', () => {
    assert.deepEqual(escapeAllOccurrences('x', ''), []);
    assert.deepEqual(escapeAllOccurrences('`a`', '`a`'), []);
  });

  it('E901 / W802 / E808 诊断上提供快速修复', async () => {
    const text = 'Module m.\n\nDefine If with a as Int.\n';
    const handlers: Record<string, (p: unknown) => Promise<unknown>> = {};
    const connection = { onCodeAction: (h: (p: unknown) => Promise<unknown>) => { handlers.codeAction = h; } };
    const documents = { get: () => ({ uri: 'file:///t.aster', getText: () => text }) };
    registerCodeActionHandlers(connection as never, documents as never, () => ({ text, tokens: [], ast: {} }), () => null);
    const diag = { code: 'E901', message: '', range: { start: { line: 2, character: 7 }, end: { line: 2, character: 9 } } };
    const actions = (await handlers.codeAction!({ textDocument: { uri: 'file:///t.aster' }, context: { diagnostics: [diag] } })) as {
      title: string; kind: string; edit: { changes: Record<string, { newText: string }[]> };
    }[];
    const fix = actions.find(a => a.title === 'Use `If` as a name');
    assert.ok(fix, JSON.stringify(actions.map(a => a.title)));
    assert.equal(fix.kind, CodeActionKind.QuickFix);
    assert.deepEqual(fix.edit.changes['file:///t.aster']!.map(e => e.newText), ['`If`']);
  });

  it('W802 / E808：范围内原文与 data 不一致或范围为空时，以 data 里的源码写法为准', async () => {
    const text = 'Module m.\n\nDefine If with a as Int.\n';
    const zero = { start: { line: 2, character: 7 }, end: { line: 2, character: 7 } };
    const full = { start: { line: 2, character: 7 }, end: { line: 2, character: 9 } };
    const titles = async (d: Diag) => (await codeActionsFor(text, [d], EN_US)).map(a => a.title);
    assert.deepEqual(await titles({ code: 'W802', message: '', range: zero, data: { keyword: 'Define' } }), ['Use `Define` as a name']);
    assert.deepEqual(await titles({ code: 'W802', message: '', range: full, data: { keyword: 'If' } }), ['Use `If` as a name']);
    assert.deepEqual(await titles({ code: 'E808', message: '', range: zero, data: { name: 'with' } }), ['Use `with` as a name']);
    assert.deepEqual(await titles({ code: 'E808', message: '', range: full, data: { name: 'Define' } }), ['Use `Define` as a name']);
  });

  it('零宽 E901（#401，cloud 实发的 marker）：zh 按起点取关键词，整词出现都改成转义', async () => {
    const text = [
      '模块 演示。', '',
      '规则 审批 给定 申请金额 作为 整数，产出 文本：',
      '  如果 申请金额 大于 100：',
      '    返回 「拒绝」。',
      '  令 返回值 定义为 「通过」。',
      '  申请金额 并且 返回 作为 文本。', '',
    ].join('\n');
    const diag: Diag = { code: 'E901', message: '', range: { start: { line: 6, character: 10 }, end: { line: 6, character: 10 } } };
    const fix = (await codeActionsFor(text, [diag], ZH_CN)).find(a => a.title === 'Use `返回` as a name');
    assert.ok(fix);
    assert.equal(fix.kind, CodeActionKind.QuickFix);
    const edits = fix.edit.changes['file:///t.aster']!;
    assert.deepEqual(edits.map(e => e.range), [
      { start: { line: 4, character: 4 }, end: { line: 4, character: 6 } },
      { start: { line: 6, character: 10 }, end: { line: 6, character: 12 } },
    ]);
    assert.ok(edits.every(e => e.newText === '`返回`'));
  });

  for (const [id, lexicon, text, word] of [
    ['zh-CN', ZH_CN, '模块 演示。\n\n定义 软件 包含 返回 作为 整数。\n', '返回'],
    ['de-DE', DE_DE, 'Modul demo.\n\nDefiniere Software mit wenn als Ganzzahl.\n', 'wenn'],
    ['en-US', EN_US, 'Module demo.\n\nRule get given If as Int, produce Int:\n  Return If.\n', 'If'],
    ['hi-IN', HI_IN, 'मॉड्यूल demo.\n\nपरिभाषित Software सहित यदि रूप में पूर्णांक.\n', 'यदि'],
  ] as const) {
    it(`零宽 E901（compile() 的 span 经 cloud 转成的范围）：${id} 给出「Use \`${word}\` as a name」，改写后不再报 E901`, async () => {
      const diag = cloudE901(text, lexicon);
      const fix = (await codeActionsFor(text, [diag], lexicon)).find(a => a.title === `Use \`${word}\` as a name`);
      assert.ok(fix, `${id}: 未给出快速修复`);
      const edits = fix.edit.changes['file:///t.aster']! as ReturnType<typeof escapeAllOccurrences>;
      assert.ok(edits.length > 0 && edits.every(e => e.newText === `\`${word}\``));
      const fixed = applyEdits(text, edits);
      assert.equal((compile(fixed, { lexicon }).parseErrors ?? []).filter(e => e.code === 'E901').length, 0, fixed);
    });
  }

  it('LSP 自己发布的 E901 也是零宽，codeAction 照样给出修复', async () => {
    const text = '模块 演示。\n\n定义 软件 包含 返回 作为 整数。\n';
    const doc = { uri: 'file:///t401.aster', version: 1, getText: () => text } as never;
    const parsed = parseDocumentText(text, ZH_CN, undefined, undefined);
    const published = (await computeDiagnostics(doc, () => ({ text, ...parsed }), ZH_CN)).filter(d => d.code === 'E901');
    assert.equal(published.length, 1);
    assert.deepEqual(published[0]!.range.start, published[0]!.range.end);
    const actions = await codeActionsFor(text, published as unknown as Diag[], ZH_CN);
    assert.ok(actions.some(a => a.title === 'Use `返回` as a name'), JSON.stringify(actions.map(a => a.title)));
  });

  it('零宽 E901 的多词关键词（de `Gib zurück`）：识别整个短语，转义不能含空格（E902），不给半个词的错误修复', async () => {
    for (const spelled of ['Gib zurück', 'Gib zurueck', 'GIB  ZURUECK']) {
      const text = `Modul demo.\n\nDefiniere Software mit ${spelled} als Ganzzahl.\n`;
      assert.equal(keywordSpellingAt(text, { line: 2, character: 23 }, DE_DE), spelled);
    }
    const text = 'Modul demo.\n\nDefiniere Software mit Gib zurück als Ganzzahl.\n';
    const diag = cloudE901(text, DE_DE);
    assert.equal(diag.range.start.character, 23);
    assert.deepEqual(await codeActionsFor(text, [diag], DE_DE), []);
    assert.deepEqual(escapeAllOccurrences(text, 'Gib zurück', DE_DE), []);
  });

  it('keywordSpellingAt：不在词首或不在词上时为空串；单词关键词只取该整词', () => {
    const text = '定义 软件 包含 返回值 作为 整数。\nRule get given If, x.\n';
    assert.equal(keywordSpellingAt(text, { line: 0, character: 10 }, ZH_CN), '');
    assert.equal(keywordSpellingAt(text, { line: 0, character: 9 }, ZH_CN), '返回值');
    assert.equal(keywordSpellingAt(text, { line: 0, character: 2 }, ZH_CN), '');
    assert.equal(keywordSpellingAt(text, { line: 1, character: 15 }, EN_US), 'If');
    assert.equal(keywordSpellingAt(text, { line: 1, character: 15 }), 'If');
    assert.equal(keywordSpellingAt(text, { line: 9, character: 0 }, ZH_CN), '');
  });

  it('悬停在转义名上说明它是名字', () => {
    const tokens = lex(canonicalize('Module m.\n\nRule f given `type` as Int, produce Int:\n  Return `type`.\n', EN_US), EN_US);
    assert.equal(escapedHoverLine(tokens, { line: 3, character: 10 }), 'escaped name `type` (a name, not a keyword)');
    assert.equal(escapedHoverLine(tokens, { line: 3, character: 4 }), null);
  });

  it('补全：与关键词同形的名字插入转义写法', () => {
    assert.equal(completionName('版本', ZH_CN), '`版本`');
    assert.equal(completionName('名称', ZH_CN), '名称');
    assert.equal(completionName('version', EN_US), '`version`');
    assert.equal(completionName('amount', EN_US), 'amount');
    assert.ok(isKeywordHomograph('Given', EN_US));
  });

  it('语义着色图例追加 operator 与 escaped，既有下标不变', () => {
    assert.deepEqual(SEM_LEGEND.tokenTypes.slice(0, 8), ['keyword', 'type', 'function', 'parameter', 'variable', 'enum', 'enumMember', 'property']);
    assert.equal(SEM_LEGEND.tokenTypes[8], 'operator');
    assert.deepEqual(SEM_LEGEND.tokenModifiers, ['declaration', 'escaped']);
  });
});

describe('名字转义的 LSP 处理器（ADR 0064 §6）', () => {
  it('成员补全：与关键词同形的字段插入转义写法', async () => {
    const { memberCompletions, clearMemberRepairCache } = await import('../../../src/lsp/member-completion.js');
    const { parseDocumentText } = await import('../../../src/lsp/parse-document.js');
    clearMemberRepairCache();
    const text = ['Module demo.p.', '', 'Define S has `version` as Int, amount as Int.', '', 'Rule f given s as S, produce Int:', '  Return s.', ''].join('\n');
    const items = memberCompletions({ text, ...parseDocumentText(text, EN_US, undefined, undefined) }, { line: 5, character: '  Return s.'.length }, EN_US);
    const byLabel = new Map((items ?? []).map(i => [i.label, (i.textEdit as { newText: string }).newText]));
    assert.equal(byLabel.get('version'), '`version`');
    assert.equal(byLabel.get('amount'), 'amount');
  });

  it('语义着色：反引号是 operator，名字带 escaped 修饰符，声明跨度不覆盖反引号', async () => {
    const { registerTokensHandlers } = await import('../../../src/lsp/tokens.js');
    const { parse } = await import('../../../src/parser.js');
    const text = 'Module m.\n\nRule f given `type` as Int, produce Int:\n  Return `type`.\n';
    const tokens = lex(canonicalize(text, EN_US), EN_US);
    const ast = parse(tokens).ast;
    let handler: ((p: unknown) => { data: number[] }) | undefined;
    const connection = {
      onRequest: () => undefined,
      onDocumentHighlight: () => undefined,
      languages: { semanticTokens: { on: (h: (p: unknown) => { data: number[] }) => { handler = h; } }, inlayHint: { on: () => undefined } },
    };
    registerTokensHandlers(connection as never, { get: () => ({ uri: 'u', getText: () => text }) as never },
      () => ({ text, tokens, ast }), () => '', () => '', () => null, () => new Map());
    assert.ok(handler);
    const data = handler({ textDocument: { uri: 'u' } }).data;
    // 解码 5 元组为绝对位置
    const decoded: { line: number; char: number; len: number; type: string; mods: number }[] = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i < data.length; i += 5) {
      line += data[i]!;
      char = data[i]! === 0 && i > 0 ? char + data[i + 1]! : data[i + 1]!;
      decoded.push({ line, char, len: data[i + 2]!, type: SEM_LEGEND.tokenTypes[data[i + 3]!]!, mods: data[i + 4]! });
    }
    const escapedBit = 1 << SEM_LEGEND.tokenModifiers.indexOf('escaped');
    const onLine3 = decoded.filter(t => t.line === 3);
    assert.ok(onLine3.some(t => t.char === 9 && t.len === 1 && t.type === 'operator'), JSON.stringify(onLine3));
    assert.ok(onLine3.some(t => t.char === 10 && t.len === 4 && (t.mods & escapedBit) !== 0), JSON.stringify(onLine3));
    assert.ok(onLine3.some(t => t.char === 14 && t.len === 1 && t.type === 'operator'), JSON.stringify(onLine3));
    const param = decoded.filter(t => t.line === 2 && t.type === 'parameter');
    assert.ok(param.length > 0 && param.every(t => t.char === 14), JSON.stringify(param));
  });
});
