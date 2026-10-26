/**
 * @module test/unit/identifiers/scopes.test
 *
 * VocabularyScopes 构建、查找与规范 JSON。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VocabularyScopeError,
  buildVocabularyScopes,
  canonicalScopesJson,
  lookup,
} from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const dir = join(repoRoot, 'test', 'fixtures', 'scopes');
const sample = JSON.parse(readFileSync(join(dir, 'sample.vocabulary.json'), 'utf8')) as DomainVocabulary;

const base = (over: Partial<DomainVocabulary>): DomainVocabulary => ({
  id: 't', name: 't', locale: 'de-DE', version: '1', structs: [], fields: [], functions: [], ...over,
});

describe('buildVocabularyScopes', () => {
  const scopes = buildVocabularyScopes(sample);

  it('struct Stufe 进入 types，field stufe 进入 fields[Level]，互不覆盖', () => {
    assert.strictEqual(lookup(scopes.types, 'stufe').folded[0]?.canonical, 'Level');
    assert.strictEqual(scopes.fields.get('Level') && lookup(scopes.fields.get('Level')!, 'Stufe').folded[0]?.canonical, 'level');
  });

  it('同 struct 下 Alter/alter 两个字段都保留', () => {
    const r = lookup(scopes.fields.get('Person')!, 'Alter');
    assert.deepStrictEqual(r.folded.map((c) => c.canonical).sort(), ['Alter', 'alter']);
    assert.deepStrictEqual(r.exact.map((c) => c.canonical), ['Alter']);
    assert.deepStrictEqual(lookup(scopes.fields.get('Person')!, 'alter').exact.map((c) => c.canonical), ['alter']);
    assert.strictEqual(lookup(scopes.fields.get('Person')!, 'ALTER').exact.length, 0);
  });

  it('别名为 synonym，主词条为 term', () => {
    const syn = lookup(scopes.types, 'niveau').folded[0]!;
    assert.strictEqual(syn.source, 'synonym');
    assert.strictEqual(syn.canonical, 'Level');
    assert.strictEqual(lookup(scopes.types, 'Stufe').folded[0]!.source, 'term');
  });

  it('written 为 NFC，组合字符写法可命中', () => {
    const c = lookup(scopes.types, 'Café').folded[0]!;
    assert.strictEqual(c.written, 'Café');
    assert.strictEqual(lookup(scopes.types, 'CAFÉ').folded.length, 1);
  });

  it('枚举成员、函数、字面量分桶', () => {
    assert.strictEqual(lookup(scopes.enumMembers.get('Level')!, 'hoch').folded[0]?.kind, IdentifierKind.ENUM_VALUE);
    assert.strictEqual(lookup(scopes.functions, 'gesamt').folded[0]?.canonical, 'total');
    assert.strictEqual(scopes.literals.get('nacht'), 'Gute Nacht');
  });

  it('未命中返回空数组', () => {
    assert.deepStrictEqual(lookup(scopes.types, 'nope'), { exact: [], folded: [] });
  });

  it('field 无 parent 抛 field_parent_required', () => {
    const v = base({ fields: [{ canonical: 'x', localized: 'x', kind: IdentifierKind.FIELD }] });
    assert.throws(() => buildVocabularyScopes(v), (e: unknown) => e instanceof VocabularyScopeError && e.code === 'field_parent_required');
  });

  it('枚举成员无 parent 抛 member_parent_required', () => {
    const v = base({ enumValues: [{ canonical: 'X', localized: 'X', kind: IdentifierKind.ENUM_VALUE }] });
    assert.throws(() => buildVocabularyScopes(v), (e: unknown) => e instanceof VocabularyScopeError && e.code === 'member_parent_required');
  });

  it('同折叠键的字面量内容冲突抛 literal_conflict', () => {
    const v = base({
      literals: [
        { canonical: 'a', localized: 'X', kind: IdentifierKind.LITERAL },
        { canonical: 'b', localized: 'x', kind: IdentifierKind.LITERAL },
      ],
    });
    assert.throws(() => buildVocabularyScopes(v), (e: unknown) => e instanceof VocabularyScopeError && e.code === 'literal_conflict');
  });
});

describe('canonicalScopesJson', () => {
  const expected = readFileSync(join(dir, 'sample.canonical.json'), 'utf8');

  it('两次构建输出相同', () => {
    assert.strictEqual(canonicalScopesJson(buildVocabularyScopes(sample)), canonicalScopesJson(buildVocabularyScopes(sample)));
  });

  it('与 sample.canonical.json 逐字节一致', () => {
    assert.strictEqual(canonicalScopesJson(buildVocabularyScopes(sample)), expected);
  });

  it('输入顺序不影响输出', () => {
    const rev: DomainVocabulary = { ...sample, structs: [...sample.structs].reverse(), fields: [...sample.fields].reverse() };
    assert.strictEqual(canonicalScopesJson(buildVocabularyScopes(rev)), expected);
  });

  it('无空白且含 schemaVersion，键序按码点', () => {
    assert.ok(!/\s(?=[{}\[\]":,])|[{,]\s/.test(expected.replace(/"[^"]*"/g, '""')));
    assert.ok(expected.includes('"schemaVersion":1'));
    assert.ok(expected.startsWith('{"enumMembers":'));
  });

  it('Alter 排在 alter 之前（码点序）', () => {
    assert.ok(expected.indexOf('"canonical":"Alter"') < expected.indexOf('"canonical":"alter"'));
  });
});

describe('折叠键 NFC 闭包与转义', () => {
  it('Ϊ́ 与 ΐ 同桶，两个候选都保留', () => {
    const v = base({
      functions: [
        { canonical: 'a', localized: '\u03AA\u0301', kind: IdentifierKind.FUNCTION },
        { canonical: 'b', localized: '\u0390', kind: IdentifierKind.FUNCTION },
      ],
    });
    const json = canonicalScopesJson(buildVocabularyScopes(v));
    assert.strictEqual(Object.keys(JSON.parse(json).functions).length, 1);
    assert.ok(json.includes('"canonical":"a"') && json.includes('"canonical":"b"'));
  });

  it('制表符转义为 \\t，U+2028 原样输出', () => {
    const v = base({ functions: [{ canonical: 'c', localized: 'a\tb\u2028c', kind: IdentifierKind.FUNCTION }] });
    const json = canonicalScopesJson(buildVocabularyScopes(v));
    assert.ok(json.includes('"written":"a\\tb\u2028c"'));
    assert.ok(json.includes('"a\\tb\u2028c":['));
  });
});
