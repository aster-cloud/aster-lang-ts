/**
 * LSP 文档解析：非英文文档必须用其 lexicon 做**词法分析**。
 *
 * ★生产缺陷：server.ts 的 getOrParse 调 `lex(can)` 不传 lexicon。canonicalize 只把
 *   「。：」等标点转成半角，关键字仍是中文；无 lexicon 的 lexer 见到「模」即抛
 *   "Unexpected character"，于是 zh/de 文档的 hover / 跳转 / 文档符号全部报错。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentText } from '../../../src/lsp/parse-document.js';
import { LexiconRegistry, initializeAllBundledLexicons } from '../../../src/config/lexicons/index.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { computeDiagnostics, MISSING_MODULE_HEADER_CODE } from '../../../src/lsp/diagnostics.js';

initializeAllBundledLexicons();

describe('parseDocumentText', () => {
  it('★zh-CN 文档按 zh lexicon 词法分析并解析出模块名与函数', () => {
    const zh = LexiconRegistry.get('zh-CN');
    const text = '模块 demo.p。\n\n规则 twice 给定 x 作为 整数 产出 整数：\n  返回 x 乘以 2。\n';
    const r = parseDocumentText(text, zh, undefined, undefined);
    assert.ok(r.tokens.length > 0, '应产生 token（旧实现在 lex 阶段直接抛错）');
    assert.equal((r.ast as { name?: string } | null)?.name, 'demo.p');
    const funcs = ((r.ast as { decls?: Array<{ kind: string; name: string }> } | null)?.decls ?? [])
      .filter((d) => d.kind === 'Func').map((d) => d.name);
    assert.deepEqual(funcs, ['twice']);
  });

  it('★zh-CN 括号函数头（aster-lang-ts#236）：参数精确对齐原文，插入的关键字不盖住标识符', () => {
    // 重排成 `Rule 折扣 given 甲 …` 后比原文长；参数须仍为 exact（重命名只基于 exact），
    // 插入的 given 在原文没有对应文本，其区间不得覆盖紧随其后的 甲。
    const zh = LexiconRegistry.get('zh-CN');
    const text = '模块 测试。\n\n规则 折扣（甲 作为 整数，乙 作为 整数），产出 整数：\n  返回 甲。\n';
    const header = text.split('\n')[2]!;
    const r = parseDocumentText(text, zh, undefined, undefined);
    assert.deepEqual(r.parseDiagnostics, []);
    const onHeader = r.tokens.filter((t) => t.start?.line === 3 && t.end?.line === 3);
    const at = (value: string): (typeof onHeader)[number] => onHeader.find((t) => t.value === value)!;
    for (const name of ['折扣', '甲', '乙']) {
      const t = at(name);
      assert.equal(t.srcAlign, 'exact', `${name} 应精确对齐`);
      assert.equal(header.slice(t.start!.col - 1, t.end!.col - 1), name);
    }
    for (let i = 0; i + 1 < onHeader.length; i++) {
      assert.ok(onHeader[i]!.end!.col <= onHeader[i + 1]!.start!.col, `token ${i} 的区间与下一个重叠`);
    }
    const params = (r.ast as unknown as { decls: Array<{ params: Array<{ name: string; span: { start: { col: number } } }> }> })
      .decls[0]!.params;
    assert.deepEqual(params.map((p) => [p.name, header[p.span.start.col - 1]]), [['甲', '甲'], ['乙', '乙']]);
  });

  it('de-DE 转写关键字（zurueck → zurück）后的标识符仍精确对齐，所有 token 区间互不重叠', () => {
    // 推算 token 的游标与区间截断对 en/de 同样生效，这里钉住 de 的典型推算场景。
    const de = LexiconRegistry.get('de-DE');
    const text = 'Modul demo.p.\n\nRegel helfer gegeben eine größe als Ganzzahl, liefert Ganzzahl:\n  gib zurueck größe plus 1.\n';
    const body = text.split('\n')[3]!;
    const r = parseDocumentText(text, de, undefined, undefined);
    const onBody = r.tokens.filter((t) => t.start?.line === 4 && t.end?.line === 4);
    const groesse = onBody.find((t) => t.value === 'größe')!;
    assert.equal(groesse.srcAlign, 'exact');
    assert.equal(body.slice(groesse.start!.col - 1, groesse.end!.col - 1), 'größe');
    const sameLine = r.tokens.filter((t) => t.start && t.end && t.start.line === t.end.line);
    for (let i = 0; i + 1 < sameLine.length; i++) {
      const [a, b] = [sameLine[i]!, sameLine[i + 1]!];
      if (a.start!.line === b.start!.line) assert.ok(a.end!.col <= b.start!.col, `第 ${a.start!.line} 行 token ${String(a.value)} 与下一个重叠`);
    }
  });

  it('en-US（无 lexicon）行为不变', () => {
    const text = 'Module demo.p.\n\nRule twice given x as Int, produce Int:\n  Return x times 2.\n';
    const r = parseDocumentText(text, undefined, undefined, undefined);
    assert.equal((r.ast as { name?: string } | null)?.name, 'demo.p');
  });
});

describe('parseDocumentText：词法错误', () => {
  const UNTERMINATED = 'Module demo.p.\n\nRule f given x as Int, produce Text:\n  Return "abc.\n';

  it('★未闭合字符串不抛异常，词法诊断进入 parseDiagnostics', () => {
    const r = parseDocumentText(UNTERMINATED, undefined, undefined, undefined);
    assert.equal(r.ast, null);
    assert.deepEqual(r.tokens, []);
    assert.equal(r.parseDiagnostics.length, 1);
    const d = r.parseDiagnostics[0]!;
    assert.equal(d.severity, 'error');
    assert.match(d.message, /Unterminated string/);
    assert.equal(d.span.start.line, 4, '诊断应落在未闭合字符串所在行');
  });

  it('未闭合字符串后还有多行内容：只报一个词法错误', () => {
    const text = UNTERMINATED + '\nRule g given y as Int, produce Int:\n  Return y.\n';
    const r = parseDocumentText(text, undefined, undefined, undefined);
    assert.equal(r.ast, null);
    assert.equal(r.parseDiagnostics.length, 1);
    assert.match(r.parseDiagnostics[0]!.message, /Unterminated string/);
  });

  it('zh-CN 文档的未闭合「」字符串同样降级为诊断', () => {
    const zh = LexiconRegistry.get('zh-CN');
    const text = '模块 demo.p。\n\n规则 f 给定 x 作为 整数 产出 文本：\n  返回 「abc。\n';
    const r = parseDocumentText(text, zh, undefined, undefined);
    assert.equal(r.ast, null);
    assert.equal(r.parseDiagnostics.length, 1);
    assert.equal(r.parseDiagnostics[0]!.span.start.line, 4);
  });

  it('非词法异常照常抛出（不吞编程错误）', () => {
    assert.throws(() => parseDocumentText(undefined as unknown as string, undefined, undefined, undefined));
  });

  it('★computeDiagnostics 发布该词法诊断，且不附带模块头或通用兜底误报', async () => {
    const doc = TextDocument.create('inmemory://policy/unterminated.aster', 'aster', 1, UNTERMINATED);
    const getOrParse = (d: TextDocument) => ({ text: d.getText(), ...parseDocumentText(d.getText(), undefined, undefined, undefined) });
    const diags = await computeDiagnostics(doc, getOrParse as never, undefined);
    assert.equal(diags.length, 1, `实际：${JSON.stringify(diags.map((d) => [d.code, d.message]))}`);
    assert.match(diags[0]!.message, /Unterminated string/);
    assert.equal(diags[0]!.range.start.line, 3);
    assert.notEqual(diags[0]!.code, MISSING_MODULE_HEADER_CODE);
  });
});
