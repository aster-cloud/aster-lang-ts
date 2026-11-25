/**
 * 字面量宏内容的字符规则（ADR 0060 修订 1 R18，#362 第 5 项）：反斜杠、ASCII 双引号与弯引号允许，「」『』«»、
 * 控制字符与空内容拒绝。共享夹具 shared/literal_value_parity.json 与 aster-lang-core
 * src/test/resources/diagnostics/literal_value_parity.json 逐字节相同，core LiteralValueParityTest 按同一夹具断言。
 *
 * 允许的内容另验证展开结果：编译后 Return 的字符串值等于宏值本身，规范化结果再规范化一次不变。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize } from '../../../../../src/frontend/canonicalizer.js';
import { buildVocabularyScopes } from '../../../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind, validateVocabulary, type DomainVocabulary } from '../../../../../src/config/lexicons/identifiers/types.js';
import { compileSource, lexiconForLocale } from '../../../../../src/policy-package/compile-source.js';

interface LiteralValueCase {
  readonly name: string;
  readonly lexicon: string;
  readonly source: string;
  readonly trigger: string;
  readonly content: string;
  readonly valid: boolean;
}

const FIXTURE = resolve(process.cwd(), 'shared', 'literal_value_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: LiteralValueCase[] }).cases;

const vocabOf = (c: LiteralValueCase): DomainVocabulary => ({
  id: 'p',
  name: 'p',
  locale: c.lexicon,
  version: '1',
  structs: [],
  fields: [],
  functions: [],
  enumValues: [],
  literals: [{ localized: c.trigger, canonical: c.content, kind: IdentifierKind.LITERAL }],
});

test('共享夹具共 25 例', () => {
  assert.equal(CASES.length, 27);
});

for (const c of CASES) {
  test(`字面量内容与 core 同一规则：${c.name}`, () => {
    const vocab = vocabOf(c);
    const result = validateVocabulary(vocab);
    assert.equal(result.valid, c.valid, `校验结论：${result.errors.join('; ')}`);
    if (!c.valid) return;

    const ir = JSON.parse(compileSource(c.source, { locale: c.lexicon, vocabulary: vocab })) as {
      decls: { body: { statements: { expr: { kind: string; value: string } }[] } }[];
    };
    const expr = ir.decls[0]!.body.statements[0]!.expr;
    assert.equal(expr.kind, 'String');
    assert.equal(expr.value, c.content, '读回值');

    const lexicon = lexiconForLocale(c.lexicon);
    const canonical = canonicalize(c.source, { lexicon, vocabulary: buildVocabularyScopes(vocab) });
    assert.equal(canonicalize(canonical, lexicon), canonical, '展开结果再规范化不变');
  });
}
