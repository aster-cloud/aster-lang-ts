/**
 * 基于名称解析结果（Origin）的跳转到定义（#248，ADR 0051 §5「LSP」）。
 *
 * 光标处写法经 R1/R2 映射到规范名，再到同一规范名（及父名）的声明位置：
 * 折叠命中（driver → Driver）、词汇本地化写法、点分路径中的字段段都能跳到源码声明；
 * 只有词汇条目、没有源码声明的名字返回 null。走真实的 registerDefinitionHandler 接线。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerDefinitionHandler } from '../../../src/lsp/navigation/definition.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import type { VocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { DECLS, VOCAB, docOf, documentsOf, getOrParseWith, posOf } from './resolution-fixture.js';
import type { Doc } from './resolution-fixture.js';

interface Location { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }
type DefinitionFn = (params: unknown) => Location | null;

const EMPTY_VOCAB = buildVocabularyScopes({ id: 'empty', name: 't', locale: 'en-US', version: '1', structs: [], fields: [], functions: [], enumValues: [] });

function definitionAt(doc: Doc, pos: { line: number; character: number }, lexicon: Lexicon = ZH_CN, vocabulary: VocabularyScopes = VOCAB) {
  let handler: DefinitionFn | undefined;
  const connection = { onDefinition: (fn: DefinitionFn) => { handler = fn; } };
  registerDefinitionHandler(connection as never, documentsOf(doc), getOrParseWith(lexicon, vocabulary) as never);
  assert.ok(handler, 'onDefinition 未注册');
  return handler!({ textDocument: { uri: doc.uri }, position: pos });
}

/** 跳转目标的起点（0 基行、列） */
const startOf = (loc: Location | null) => (loc ? [loc.range.start.line, loc.range.start.character] : null);

describe('基于名称解析的跳转到定义', () => {
  it('★类型位置的折叠写法 driver → Define Driver（旧实现按原文精确匹配，返回 null）', () => {
    const doc = docOf(['Module m.', '', 'Define Driver has age as Int.', '', 'Rule f given x as driver, produce Int:', '  Return 1.', '']);
    const loc = definitionAt(doc, posOf(doc, 4, 'driver', 1), EN_US, EMPTY_VOCAB);
    assert.deepEqual(startOf(loc), [2, 0], 'Data 无 nameSpan，与原逻辑一样跳到声明起点');
  });

  it('精确写法照旧跳到声明', () => {
    const doc = docOf(['Module m.', '', 'Define Driver has age as Int.', '', 'Rule f given x as Driver, produce Int:', '  Return 1.', '']);
    assert.deepEqual(startOf(definitionAt(doc, posOf(doc, 4, 'Driver', 1), EN_US, EMPTY_VOCAB)), [2, 0]);
  });

  it('★词汇本地化：以规范名 Driver 引用、源码声明写作「司机」→ 跳到「司机」的声明', () => {
    const doc = docOf([...DECLS, '规则 g 给定 x 作为 Driver，产出 整数：', '  返回 1。', '']);
    const loc = definitionAt(doc, posOf(doc, DECLS.length, 'Driver', 1));
    assert.deepEqual(startOf(loc), [2, 0]);
  });

  it('★点分路径中的字段段 x.alter → Driver 的字段声明 alter', () => {
    const doc = docOf([...DECLS, '规则 检查 给定 x 作为 司机，产出 整数：', '  返回 x.alter。', '']);
    const loc = definitionAt(doc, posOf(doc, DECLS.length + 1, 'alter', 1));
    assert.deepEqual(startOf(loc), [2, DECLS[2]!.indexOf('alter')]);
  });

  it('多段路径 h.fahrer.alter 的末段按 fahrer 的类型 Driver 跳到 alter', () => {
    const doc = docOf([...DECLS, '规则 g 给定 h 作为 车主，产出 整数：', '  返回 h.fahrer.alter。', '']);
    const loc = definitionAt(doc, posOf(doc, DECLS.length + 1, 'alter', 1));
    assert.deepEqual(startOf(loc), [2, DECLS[2]!.indexOf('alter')]);
  });

  it('枚举成员 Hoch → 等级 中的成员声明', () => {
    const doc = docOf([...DECLS, '规则 级别 给定 x 作为 司机，产出 等级：', '  返回 Hoch。', '']);
    const loc = definitionAt(doc, posOf(doc, DECLS.length + 1, 'Hoch', 1));
    assert.deepEqual(startOf(loc), [6, DECLS[6]!.indexOf('Hoch')]);
  });

  it('只有词汇条目、没有源码声明 → null', () => {
    const vocab = buildVocabularyScopes({
      id: 'v', name: 't', locale: 'en-US', version: '1',
      structs: [{ canonical: 'Customer', localized: 'Kunde', kind: IdentifierKind.STRUCT }], fields: [], functions: [], enumValues: [],
    });
    const doc = docOf(['Module m.', '', 'Rule f given x as Kunde, produce Int:', '  Return 1.', '']);
    assert.equal(definitionAt(doc, posOf(doc, 2, 'Kunde', 1), EN_US, vocab), null);
  });

  it('语法不完整时：已解析部分的类型位置仍可跳转（R1 结果），不抛异常', () => {
    const doc = docOf(['Module m.', '', 'Define Driver has age as Int.', '', 'Rule f given x as driver, produce Int:', '  Return 1.', '',
      'Rule g given y as Int, produce Int:', '  Return y plus', '']);
    assert.deepEqual(startOf(definitionAt(doc, posOf(doc, 4, 'driver', 1), EN_US, EMPTY_VOCAB)), [2, 0]);
  });

  it('局部名（参数）仍由原有逻辑处理', () => {
    const doc = docOf(['Module m.', '', 'Rule f given count as Int, produce Int:', '  Return count.', '']);
    const loc = definitionAt(doc, posOf(doc, 3, 'count', 1), EN_US, EMPTY_VOCAB);
    assert.equal(loc?.range.start.line, 2);
  });
});
