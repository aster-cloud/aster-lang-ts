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
import {
  applyEscapes,
  lspSourceChecker,
  MAX_COMPILES,
  MAX_EXPANSION_ROUNDS,
  nameEscapeEdits,
  type SourceChecker,
} from '../../../src/lsp/name-escape-fix.js';
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

  it('W802 / E808：范围内原文与 data 不一致时以 data 里的源码写法为准；data 的词不在诊断位置上时不给修复', async () => {
    const zh = '模块 演示。\n\n定义 软件 包含 版本 作为 整数。\n';
    const titles = async (text: string, d: Diag, lexicon: Lexicon) => (await codeActionsFor(text, [d], lexicon)).map(a => a.title);
    // W802 的范围是整个字段声明（`版本 作为 整数`），范围内原文不是那个词：取 data.keyword
    const field = { start: { line: 2, character: 9 }, end: { line: 2, character: 17 } };
    assert.deepEqual(await titles(zh, { code: 'W802', message: '', range: field, data: { name: 'version', keyword: '版本', kind: 'IMPORT_VERSION' } }, ZH_CN),
      ['Use `版本` as a name']);
    // 零宽 E808：起点处的词与 data.name 一致
    const zero = { start: { line: 2, character: 9 }, end: { line: 2, character: 9 } };
    assert.deepEqual(await titles(zh, { code: 'E808', message: '', range: zero, data: { name: '版本' } }, ZH_CN), ['Use `版本` as a name']);
    // data 的词（`Define`）只在 DEFINE 关键词处出现，不在诊断位置上：旧实现会把关键词也转义（#404），现在不给修复
    const en = 'Module m.\n\nDefine If with a as Int.\n';
    const atIf = { start: { line: 2, character: 7 }, end: { line: 2, character: 7 } };
    assert.deepEqual(await titles(en, { code: 'W802', message: '', range: atIf, data: { keyword: 'Define' } }, EN_US), []);
  });

  it('零宽 E901（#401，cloud 实发的 marker）：zh 按起点取关键词，只转义名字位置（RETURN 语句不动，#404）', async () => {
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
      { start: { line: 6, character: 10 }, end: { line: 6, character: 12 } },
    ]);
    assert.ok(edits.every(e => e.newText === '`返回`'));
  });

  for (const [id, lexicon, text, word] of [
    ['zh-CN', ZH_CN, '模块 演示。\n\n定义 软件 包含 返回 作为 整数。\n', '返回'],
    ['de-DE', DE_DE, 'Modul demo.\n\nDefiniere Software mit wenn als Ganzzahl.\n', 'wenn'],
    ['en-US', EN_US, 'Module demo.\n\nDefine If has score as Int.\n', 'If'],
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

/** 快速修复的编辑：断言提供了「Use `word` as a name」并返回其编辑。 */
async function fixEdits(text: string, diag: Diag, lexicon: Lexicon, word: string): Promise<ReturnType<typeof escapeAllOccurrences>> {
  const fix = (await codeActionsFor(text, [diag], lexicon)).find(a => a.title === `Use \`${word}\` as a name`);
  assert.ok(fix, `未给出「Use \`${word}\` as a name」`);
  return fix.edit.changes['file:///t.aster']! as ReturnType<typeof escapeAllOccurrences>;
}

/** 编辑所在的 [行, 列]（0 基）。 */
const at = (edits: ReturnType<typeof escapeAllOccurrences>) => edits.map(e => [e.range.start.line, e.range.start.character]);

/** compile() 的 error 级诊断码（语法与名称解析）。 */
function compileErrors(text: string, lexicon: Lexicon): string[] {
  const r = compile(text, { lexicon });
  return [...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? []).filter(d => d.severity === 'error')].map(d => String(d.code));
}

/** #404 的生产复现：结构体字段 `返回` 与规则体里三处 RETURN 语句。 */
const ZH_404 = [
  '模块 入门.贷款。',
  '',
  '定义 申请人 包含',
  '  编号，',
  '  信用评分，',
  '  收入，',
  '  申请金额 并且 返回 作为 文本。',
  '',
  '规则 评估贷款 给定 申请人 作为 申请人，产出 文本：',
  '  如果 申请人.信用评分 大于 750',
  '    返回「批准，优惠利率」。',
  '  否则',
  '    如果 申请人.信用评分 大于 650',
  '      返回「批准，标准利率」。',
  '    否则',
  '      返回「需要人工审核」。',
  '',
].join('\n');

describe('「用作名字」只转义名字位置（#404，ADR 0064 §6 N1 修订）', () => {
  it('生产复现：只转义第 7 行的字段，三处 RETURN 语句不动，改写后无错误', async () => {
    const diag = cloudE901(ZH_404, ZH_CN);
    const edits = await fixEdits(ZH_404, diag, ZH_CN, '返回');
    assert.deepEqual(at(edits), [[6, 10]]);
    const fixed = applyEdits(ZH_404, edits);
    assert.equal(fixed, ZH_404.replace('并且 返回 作为', '并且 `返回` 作为'));
    assert.deepEqual(compileErrors(fixed, ZH_CN), []);
  });

  it('字段另有引用（申请人.返回）：引用一并转义，RETURN 语句不动', async () => {
    const text = ZH_404.replace('      返回「需要人工审核」。', '      返回 申请人.返回。');
    const edits = await fixEdits(text, cloudE901(text, ZH_CN), ZH_CN, '返回');
    // 第 16 行：`      返回 申请人.返回。` 只转义点号后的字段，行首的 RETURN 不动
    assert.deepEqual(at(edits), [[6, 10], [15, 13]]);
    const fixed = applyEdits(text, edits);
    assert.ok(fixed.includes('      返回 申请人.`返回`。') && fixed.includes('    返回「批准，优惠利率」。'), fixed);
    assert.deepEqual(compileErrors(fixed, ZH_CN), []);
  });

  it('W802（字段在名字位置被静默改名）：声明与引用都转义，结果无 W802', async () => {
    const text = [
      '模块 演示。', '',
      '定义 软件 包含 版本 作为 整数，名称 作为 文本。', '',
      '规则 取版本 给定 软件 作为 软件，产出 整数：',
      '  如果 软件.版本 大于 1',
      '    返回 软件.版本。',
      '  返回 0。', '',
    ].join('\n');
    const doc = { uri: 'file:///t404w.aster', version: 1, getText: () => text } as never;
    const parsed = parseDocumentText(text, ZH_CN, undefined, undefined);
    const published = (await computeDiagnostics(doc, () => ({ text, ...parsed }), ZH_CN)).filter(d => d.code === 'W802');
    assert.equal(published.length, 3);
    const edits = await fixEdits(text, published[0] as unknown as Diag, ZH_CN, '版本');
    assert.deepEqual(at(edits), [[2, 9], [5, 8], [6, 10]]);
    const fixed = applyEdits(text, edits);
    assert.equal((compile(fixed, { lexicon: ZH_CN }).resolutionDiagnostics ?? []).filter(d => d.code === 'W802').length, 0, fixed);
    assert.deepEqual(compileErrors(fixed, ZH_CN), []);
  });

  it('W802 落在引用上（声明已转义）：只转义该引用，RETURN 语句不动', async () => {
    const text = ZH_404.replace('并且 返回 作为', '并且 `返回` 作为').replace('      返回「需要人工审核」。', '      返回 申请人.返回。');
    const doc = { uri: 'file:///t404r.aster', version: 1, getText: () => text } as never;
    const parsed = parseDocumentText(text, ZH_CN, undefined, undefined);
    const w802 = (await computeDiagnostics(doc, () => ({ text, ...parsed }), ZH_CN)).filter(d => d.code === 'W802');
    assert.equal(w802.length, 1);
    const edits = await fixEdits(text, w802[0] as unknown as Diag, ZH_CN, '返回');
    assert.deepEqual(at(edits), [[15, 13]]);
    assert.deepEqual(compileErrors(applyEdits(text, edits), ZH_CN), []);
  });

  it('E808（租户汉字别名作名字）：按诊断里的别名重建判定，字段声明与引用转义，别名作 RETURN 的语句不动', async () => {
    const { compileSource } = await import('../../../src/policy-package/compile-source.js');
    const aliasSet = { RETURN: ['退回'] };
    const text = [
      '模块 演示。', '',
      '定义 单据 包含 退回 作为 整数。', '',
      '规则 取值 给定 单据 作为 单据，产出 整数：',
      '  如果 单据.退回 大于 1',
      '    退回 单据.退回。',
      '  退回 0。', '',
    ].join('\n');
    const compileWithAlias = (src: string) => compileSource(src, { locale: 'zh-CN', aliasSet, allowStructural: true });
    let e808: { code: string; span: { start: { line: number; col: number }; end: { line: number; col: number } }; data: unknown } | undefined;
    try {
      compileWithAlias(text);
    } catch (e) {
      e808 = JSON.parse((e as { diagnostics: string[] }).diagnostics[0]!);
    }
    assert.equal(e808?.code, 'E808');
    const range = {
      start: { line: e808.span.start.line - 1, character: e808.span.start.col - 1 },
      end: { line: e808.span.end.line - 1, character: e808.span.end.col - 1 },
    };
    // LSP 的词法表不含租户别名：判定只能靠诊断里的 alias / kind
    const edits = await fixEdits(text, { code: 'E808', message: '', range, data: e808.data }, ZH_CN, '退回');
    assert.deepEqual(at(edits), [[2, 9], [5, 8], [6, 10]]);
    const fixed = applyEdits(text, edits);
    assert.ok(fixed.includes('    退回 单据.`退回`。') && fixed.includes('  退回 0。'), fixed);
    assert.doesNotThrow(() => compileWithAlias(fixed));
  });

  it('同一行多处引用：坐标按同行已转义处右移换算，全部转义', () => {
    const text = [
      '模块 演示。', '',
      '定义 软件 包含 版本 作为 整数。', '',
      '规则 取版本 给定 软件 作为 软件，产出 整数：',
      '  返回 软件.版本 加上 软件.版本 加上 软件.版本。', '',
    ].join('\n');
    const check = lspSourceChecker({ lexicon: ZH_CN });
    const w802 = check(text).find(d => d.code === 'W802' && d.range.start.line === 2);
    assert.ok(w802);
    const r = nameEscapeEdits(text, '版本', w802.range, check, ZH_CN);
    assert.equal(r.mode, 'names');
    assert.deepEqual(at(r.edits), [[2, 9], [5, 8], [5, 17], [5, 26]]);
    assert.deepEqual(compileErrors(applyEscapes(text, r.edits), ZH_CN), []);
  });

  it('不给修复：W802 字段另有英文拼写的引用（`软件.version`，不在该词出现行上），改名会让它失效', async () => {
    const text = [
      '模块 演示。', '',
      '定义 软件 包含 版本 作为 整数。', '',
      '规则 取版本 给定 软件 作为 软件，产出 整数：',
      '  如果 软件.version 大于 1',
      '    返回 1。',
      '  返回 软件.版本。', '',
    ].join('\n');
    assert.deepEqual(compileErrors(text, ZH_CN), []);
    const check = lspSourceChecker({ lexicon: ZH_CN });
    const w802 = check(text).find(d => d.code === 'W802' && d.range.start.line === 2);
    assert.ok(w802);
    assert.equal(nameEscapeEdits(text, '版本', w802.range, check, ZH_CN).mode, 'none');
    assert.deepEqual(await codeActionsFor(text, [{ code: 'W802', message: '', range: w802.range, data: { keyword: '版本' } }], ZH_CN), []);
  });

  it('原文另有被 E901 掩盖的无关错误（别处的未知字段）：照样给出修复', async () => {
    const text = ZH_404.replace('    如果 申请人.信用评分 大于 650', '    如果 申请人.不存在 大于 650');
    const edits = await fixEdits(text, cloudE901(text, ZH_CN), ZH_CN, '返回');
    assert.deepEqual(at(edits), [[6, 10]]);
    // 修复后暴露的是原有的错误，不是改写引入的
    assert.deepEqual(compileErrors(applyEdits(text, edits), ZH_CN), ['E801']);
  });

  it('getOrParse 抛错（拿不到诊断用的编译上下文）时不给修复', async () => {
    const handlers: Record<string, (p: unknown) => Promise<unknown>> = {};
    const connection = { onCodeAction: (h: (p: unknown) => Promise<unknown>) => { handlers.codeAction = h; } };
    const documents = { get: () => ({ uri: 'file:///t.aster', getText: () => ZH_404 }) };
    registerCodeActionHandlers(connection as never, documents as never, () => { throw new Error('boom'); }, () => null, () => ZH_CN);
    const actions = await handlers.codeAction!({ textDocument: { uri: 'file:///t.aster' }, context: { diagnostics: [cloudE901(ZH_404, ZH_CN)] } });
    assert.deepEqual(actions, []);
  });

  it('de `wenn`：字段与引用转义，IF 语句不动', async () => {
    const text = [
      'Modul demo.', '',
      'Definiere Antrag hat punkte als Ganzzahl, wenn als Ganzzahl.', '',
      'Regel bewerte gegeben antrag als Antrag, liefert Ganzzahl:',
      '  wenn antrag.punkte groesser als 700',
      '    gib zurueck antrag.wenn.',
      '  gib zurueck 0.', '',
    ].join('\n');
    const edits = await fixEdits(text, cloudE901(text, DE_DE), DE_DE, 'wenn');
    assert.deepEqual(at(edits), [[2, 42], [6, 23]]);
    assert.deepEqual(compileErrors(applyEdits(text, edits), DE_DE), []);
  });

  it('hi `यदि`：字段与引用转义，IF 语句不动', async () => {
    const text = [
      'मॉड्यूल loan।', '',
      'परिभाषित Applicant रखता है creditScore रूप में पूर्णांक, यदि रूप में पूर्णांक।', '',
      'नियम approve दिया गया a रूप में Applicant, उत्पन्न पूर्णांक:',
      '  यदि a.creditScore से अधिक 700',
      '    लौटाएं a.यदि।',
      '  लौटाएं 0।', '',
    ].join('\n');
    const edits = await fixEdits(text, cloudE901(text, HI_IN), HI_IN, 'यदि');
    assert.deepEqual(at(edits), [[2, 57], [6, 13]]);
    const fixed = applyEdits(text, edits);
    assert.ok(fixed.includes('\n  यदि a.creditScore'), fixed);
    assert.deepEqual(compileErrors(fixed, HI_IN), []);
  });

  it('en `If`：类型名转义，IF 语句与 RETURN 不动', async () => {
    const text = [
      'Module demo.', '',
      'Define If has score as Int.', '',
      'Rule check given x as If, produce Int:',
      '  If x.score greater than 700:',
      '    Return 1.',
      '  Return 0.', '',
    ].join('\n');
    const edits = await fixEdits(text, cloudE901(text, EN_US), EN_US, 'If');
    // 类型引用 `as If` 编译时就是名字（无诊断），不需要转义；IF 语句是关键词
    assert.deepEqual(at(edits), [[2, 7]]);
    assert.deepEqual(compileErrors(applyEdits(text, edits), EN_US), []);
  });

  it('不给修复：转义诊断处本身就多出错误（en 形参 `If`，转义后是首字母大写的名字，E055）', async () => {
    const text = 'Module demo.\n\nRule get given If as Int, produce Int:\n  Return If.\n';
    const diag = cloudE901(text, EN_US);
    assert.deepEqual(await codeActionsFor(text, [diag], EN_US), []);
    const r = nameEscapeEdits(text, 'If', diag.range, lspSourceChecker({ lexicon: EN_US }), EN_US);
    assert.equal(r.mode, 'none');
    assert.ok(r.compiles <= MAX_COMPILES);
  });

  it('退回：扩展后多出错误（误把 RETURN 关键词当作名字位置）时只转义诊断处', () => {
    const real = lspSourceChecker({ lexicon: ZH_CN });
    // 构造一个落在第 11 行 RETURN 关键词上的 W802，诱使扩展转义它；转义后的 `` `返回`「…」 `` 是 E064
    const check: SourceChecker = text => [
      ...real(text),
      ...(text.includes('`返回` 作为') ? [{ code: 'W802', severity: 'warning', range: { start: { line: 10, character: 4 }, end: { line: 10, character: 6 } }, syntax: false }] : []),
    ];
    const diag = cloudE901(ZH_404, ZH_CN);
    const r = nameEscapeEdits(ZH_404, '返回', diag.range, check, ZH_CN);
    assert.equal(r.mode, 'diagnosed');
    assert.deepEqual(at(r.edits), [[6, 10]]);
    assert.ok(r.compiles <= MAX_COMPILES);
    // 不加守卫时的扩展结果确实多出 E064
    const expanded = applyEscapes(ZH_404, [r.edits[0]!, { range: { start: { line: 10, character: 4 }, end: { line: 10, character: 6 } }, newText: '`返回`' }]);
    assert.ok(compileErrors(expanded, ZH_CN).includes('E064'), expanded);
  });

  it('编译次数有上限：原文、诊断处与每轮扩展各一次', () => {
    let compiles = 0;
    const real = lspSourceChecker({ lexicon: ZH_CN });
    const text = ZH_404.replace('      返回「需要人工审核」。', '      返回 申请人.返回。');
    const r = nameEscapeEdits(text, '返回', cloudE901(text, ZH_CN).range, t => { compiles++; return real(t); }, ZH_CN);
    assert.equal(r.mode, 'names');
    assert.equal(r.compiles, compiles);
    assert.equal(compiles, 3);
    assert.equal(MAX_COMPILES, 2 + MAX_EXPANSION_ROUNDS);
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
