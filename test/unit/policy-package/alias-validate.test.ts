import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayAliases, validateAliasSet, MAX_ALIASES_PER_KIND, MAX_ALIAS_KINDS, SEMANTIC_KIND_NAMES } from '../../../src/policy-package/alias-validate.js';
import { lexiconForLocale, compileSource, CompileFailure, positionFreeSha256 } from '../../../src/policy-package/obtain-ir.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';

// 逐条复刻 aster-api UserAliasValidatorTest / UserAliasCompileTest（ADR 0059 P0 结果 §4，T3）。
const base = lexiconForLocale('en-US');
const errs = (set: Record<string, string[]>, allowStructural = false): string[] => validateAliasSet(set, { base, allowStructural });

test('允许低风险多词运算符别名', () => assert.deepEqual(errs({ TIMES: ['multiplied by'] }), []));
test('拒绝敏感 kind（RETURN）', () => assert.ok(errs({ RETURN: ['approve as'] }).some((e) => e.includes('不允许为'))));
test('拒绝控制流、导入、效果 kind', () => {
  for (const k of ['IF', 'OTHERWISE', 'MATCH', 'IMPORT', 'IO', 'AND', 'FUNC_TO', 'WORKFLOW']) {
    assert.ok(SEMANTIC_KIND_NAMES.has(k), k);
    assert.notDeepEqual(errs({ [k]: ['some phrase'] }), [], k);
  }
});
test('拒绝单词别名', () => assert.ok(errs({ TIMES: ['scaled'] }).some((e) => e.includes('多词'))));
test('拒绝遮蔽多词规范拼写', () => {
  assert.deepEqual(errs({ TIMES: ['plus times'] }), []);
  assert.ok(errs({ TIMES: ['divided by'] }).some((e) => e.includes('遮蔽')));
});
test('null 与空集合法', () => {
  assert.deepEqual(validateAliasSet(null, { base }), []);
  assert.deepEqual(errs({}), []);
});
test('拒绝非规范空白与大写', () => {
  assert.ok(errs({ TIMES: ['scaled  by'] }).some((e) => e.includes('非规范空白')));
  assert.notDeepEqual(errs({ TIMES: ['Scaled By'] }), []);
});

const vocab: DomainVocabulary = {
  id: 'test-vocab', name: 'Test Vocab', locale: 'en-US', version: '1.0.0',
  structs: [], fields: [{ canonical: 'monthlyFee', localized: 'monthly fee', kind: 'field', parent: 'Account' }],
  functions: [], enumValues: [],
} as unknown as DomainVocabulary;
test('拒绝与领域词汇标识符同形的别名', () => {
  const scopes = buildVocabularyScopes(vocab);
  assert.ok(validateAliasSet({ TIMES: ['monthly fee'] }, { base, vocabulary: scopes }).some((e) => e.includes('领域词汇')));
  assert.deepEqual(validateAliasSet({ TIMES: ['multiplied by'] }, { base, vocabulary: scopes }), []);
});

const STRUCTURAL = ['MODULE_DECL', 'FUNC_TO', 'IF', 'OTHERWISE', 'MATCH', 'WHEN', 'RETURN'];
test('结构词默认拒绝、授权后多词允许、授权后单词仍拒', () => {
  for (const k of STRUCTURAL) {
    assert.notDeepEqual(errs({ [k]: ['the phrase here'] }), [], k);
    assert.deepEqual(errs({ [k]: ['the phrase here'] }, true), [], k);
  }
  assert.ok(errs({ RETURN: ['answer'] }, true).join(',').includes('多词'));
});
test('高危 kind 即使授权也拒', () => {
  for (const k of ['IMPORT', 'AND', 'OR', 'NOT', 'IO', 'AWAIT']) assert.notDeepEqual(errs({ [k]: ['some phrase'] }, true), [], k);
});
test('W2 上界：kind 数、每 kind 条数、单条长度、边界值', () => {
  const kinds = [...SEMANTIC_KIND_NAMES].slice(0, MAX_ALIAS_KINDS + 1);
  assert.ok(kinds.length > MAX_ALIAS_KINDS);
  assert.ok(errs(Object.fromEntries(kinds.map((k) => [k, ['a b']]))).some((e) => e.includes('kind 数量')));
  const many = Array.from({ length: MAX_ALIASES_PER_KIND + 1 }, (_, i) => `alias number ${i}`);
  assert.ok(errs({ TIMES: many }).some((e) => e.includes('别名数量')));
  assert.ok(errs({ TIMES: ['a ' + 'x'.repeat(200)] }).some((e) => e.includes('别名长度')));
  assert.deepEqual(errs({ TIMES: many.slice(0, MAX_ALIASES_PER_KIND).map((_, i) => `alias phrase ${i}`) }), []);
});

test('叠加为合并语义：base 别名保留、用户别名按 kind 追加去重', () => {
  const withBase = { ...base, aliases: { PLUS: ['added together'], TIMES: ['times by'] } } as typeof base;
  const wrapped = overlayAliases(withBase, { TIMES: ['multiplied by', 'times by'] });
  assert.deepEqual(wrapped.aliases, { PLUS: ['added together'], TIMES: ['times by', 'multiplied by'] });
  assert.equal(overlayAliases(base, {}), base);
});

const canon = 'Module Pricing.\n\nRule discountedPrice given amount as Int, produce Int:\n  If amount greater than 100\n    Return amount times 90 divided by 100.\n  Return amount.';
test('别名版源码与规范版降到同一投影 IR', () => {
  const aliasSrc = canon.replace('times 90 divided by', 'multiplied by 90 split by');
  const a = compileSource(aliasSrc, { locale: 'en-US', aliasSet: { TIMES: ['multiplied by'], DIVIDED_BY: ['split by'] } });
  const b = compileSource(canon, { locale: 'en-US' });
  // 别名替换会改变 col（ts 的 col 指原文），投影哈希不看 col
  assert.equal(positionFreeSha256(a), positionFreeSha256(b));
});
test('授权的结构词别名版与规范版同一投影 IR；未授权即编译失败', () => {
  const set = { FUNC_TO: ['the rule for'], IF: ['in the case that'], RETURN: ['the answer is'] };
  const src = canon.replace('Rule ', 'the rule for ').replace('If ', 'in the case that ').replaceAll('Return ', 'the answer is ');
  const a = compileSource(src, { locale: 'en-US', aliasSet: set, allowStructural: true });
  assert.equal(positionFreeSha256(a), positionFreeSha256(compileSource(canon, { locale: 'en-US' })));
  assert.throws(() => compileSource(src, { locale: 'en-US', aliasSet: set }), CompileFailure);
});
