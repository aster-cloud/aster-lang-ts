/**
 * LSP 非英文与 inmemory 文档的一组回归：每条都对应一个曾在生产出现的缺陷。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LexiconRegistry, initializeAllBundledLexicons } from '../../../src/config/lexicons/index.js';
import { resolvePushedSettings } from '../../../src/lsp/settings.js';
import { captureWordAt, ensureUri, findTokenPositionsSafe, findWordPositions } from '../../../src/lsp/navigation/shared.js';
import { updateDocumentIndex } from '../../../src/lsp/workspace/document-indexer.js';
import { computeDiagnostics, MISSING_MODULE_HEADER_CODE } from '../../../src/lsp/diagnostics.js';
import { parseDocumentText } from '../../../src/lsp/parse-document.js';

initializeAllBundledLexicons();
const zh = LexiconRegistry.get('zh-CN');
const ZH_DOC = '模块 demo.p。\n\n规则 twice 给定 x 作为 整数 产出 整数：\n  返回 x 乘以 2。\n\n规则 note 给定 x 作为 整数 产出 文本：\n  返回 「twice」。\n';

describe('resolvePushedSettings', () => {
  it('★只推 locale 时保留其余默认值（旧实现整体替换，reflow 变 undefined）', () => {
    const s = resolvePushedSettings({ locale: 'zh-CN' });
    assert.equal(s.locale, 'zh-CN');
    assert.equal(s.format?.reflow, true);
    assert.equal(s.index?.persist, true);
    assert.equal(s.rename?.scope, 'workspace');
    assert.equal(s.maxNumberOfProblems, 1000);
  });

  it('嵌套字段逐项覆盖', () => {
    const s = resolvePushedSettings({ index: { persist: false } });
    assert.equal(s.index?.persist, false);
    assert.equal(s.format?.mode, 'lossless');
  });
});

describe('ensureUri', () => {
  it('★inmemory:// 原样返回（旧实现在 ESM 里调 require 直接抛错）', () => {
    assert.equal(ensureUri('inmemory://policy/default.aster'), 'inmemory://policy/default.aster');
    assert.equal(ensureUri('file:///a/b.aster'), 'file:///a/b.aster');
  });
});

describe('findTokenPositionsSafe', () => {
  it('★zh 文档按 token 精确匹配：不命中字符串字面量里的同名文本', () => {
    // 无 lexicon 时 lexer 遇中文即抛，退化成正则，会把「twice」字符串里的也算进去
    const positions = findTokenPositionsSafe(ZH_DOC, 'twice', zh);
    assert.equal(positions.length, 1, `应只命中规则名，实际 ${positions.length} 处`);
    const [hit] = positions;
    assert.ok(hit);
    assert.equal(ZH_DOC.slice(hit.start, hit.end), 'twice');
  });
});

describe('updateDocumentIndex', () => {
  it('★zh 文档被索引出模块名与函数符号（旧实现解析失败，从不索引）', async () => {
    const idx = await updateDocumentIndex('inmemory://policy/zh-index.aster', ZH_DOC, zh);
    assert.equal(idx.moduleName, 'demo.p');
    assert.deepEqual(idx.symbols.map((s) => s.name).sort(), ['note', 'twice']);
  });
});

describe('computeDiagnostics: 缺少模块头', () => {
  it('★诊断带稳定 code（message 本地化后 Quick Fix 靠它识别）', async () => {
    const doc = TextDocument.create('inmemory://policy/empty.aster', 'aster-cnl', 1, '');
    const getOrParse = (d: TextDocument) => ({ text: d.getText(), ...parseDocumentText(d.getText(), zh, undefined, undefined) });
    const diags = await computeDiagnostics(doc, getOrParse, zh);
    const header = diags.find((d) => d.code === MISSING_MODULE_HEADER_CODE);
    assert.ok(header, `应有 code=${MISSING_MODULE_HEADER_CODE} 的诊断，实际: ${JSON.stringify(diags.map((d) => [d.code, d.message]))}`);
    assert.match(String(header.message), /模块/);
  });
});

describe('词边界与取词（Unicode 标识符）', () => {
  it('★findWordPositions 按 Unicode 字母判定边界：「四加倍」里的「加倍」不算', () => {
    const text = '四加倍 加倍';
    assert.deepEqual(findWordPositions(text, '加倍'), [{ start: 4, end: 6 }]);
  });

  it('★captureWordAt 取中文与带变音的标识符，关键字返回 null', () => {
    const zhText = '规则 加倍 给定 数值 作为 整数 产出 整数：';
    assert.equal(captureWordAt(zhText, zhText.indexOf('加倍') + 1, zh), '加倍');
    assert.equal(captureWordAt(zhText, 1, zh), null);
    const de = LexiconRegistry.get('de-DE');
    const deText = 'Regel verdoppeln gegeben größe als Ganzzahl, liefert Ganzzahl:';
    assert.equal(captureWordAt(deText, deText.indexOf('größe') + 3, de), 'größe');
  });
});

describe('取词回退路径（词法失败时）', () => {
  /* U1：词法失败（未闭合字符串）时退回字符级捕获，字符类必须是 Unicode */
  it('★未闭合字符串导致词法失败时仍能取到中文标识符', () => {
    const text = '规则 加倍 给定 数值 作为 整数 产出 文本：\n  返回 「未闭合';
    assert.equal(captureWordAt(text, text.indexOf('加倍') + 1, zh), '加倍');
  });
});
