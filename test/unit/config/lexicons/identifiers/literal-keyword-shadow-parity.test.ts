/**
 * 字面量触发词与关键词同形时关键词优先（ADR 0060 修订 1 R16'，#368）。共享夹具 shared/literal_keyword_shadow_parity.json
 * 与 aster-lang-core src/test/resources/diagnostics/literal_keyword_shadow_parity.json 逐字节相同，core
 * LiteralKeywordShadowParityTest 按同一夹具断言。
 *
 * 每例断言 literalsVisibleUnder 正好保留 expectVisible；带 source 的用例另以有效词法表、不经别名校验编译，
 * 与不带词汇的 equivalent 得到同一位置无关哈希（被丢弃的触发词按关键词读）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '../../../../../src/browser.js';
import { foldKey, nfc } from '../../../../../src/config/lexicons/identifiers/casefold.js';
import { buildVocabularyScopes, literalsVisibleUnder } from '../../../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind, type DomainVocabulary } from '../../../../../src/config/lexicons/identifiers/types.js';
import type { Lexicon } from '../../../../../src/config/lexicons/types.js';
import { overlayAliases, type AliasSet } from '../../../../../src/policy-package/alias-validate.js';
import { lexiconForLocale, positionFreeSha256 } from '../../../../../src/policy-package/compile-source.js';

interface ShadowCase {
  readonly name: string;
  readonly lexicon: string;
  readonly officialAliases?: AliasSet;
  readonly aliasSet?: AliasSet;
  readonly literals: readonly (readonly [string, string])[];
  readonly expectVisible: readonly string[];
  readonly source?: string;
  readonly equivalent?: string;
}

const FIXTURE = resolve(process.cwd(), 'shared', 'literal_keyword_shadow_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: ShadowCase[] }).cases;

function coreJsonOf(source: string, lexicon: Lexicon, vocabulary?: DomainVocabulary): string {
  const r = compile(source, { lexicon, ...(vocabulary ? { vocabulary } : {}) });
  assert.ok(r.success && r.coreJson !== undefined, JSON.stringify([...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? [])]));
  return r.coreJson;
}

test('共享夹具共 12 例', () => {
  assert.equal(CASES.length, 14);
});

for (const c of CASES) {
  test(`关键词优先与 core 同一规则：${c.name}`, () => {
    const vocabulary: DomainVocabulary = {
      id: 'p', name: 'p', locale: c.lexicon, version: '1',
      structs: [], fields: [], functions: [], enumValues: [],
      literals: c.literals.map(([localized, canonical]) => ({ localized, canonical, kind: IdentifierKind.LITERAL })),
    };
    const effective = overlayAliases(overlayAliases(lexiconForLocale(c.lexicon), c.officialAliases), c.aliasSet);
    const visible = literalsVisibleUnder(buildVocabularyScopes(vocabulary), effective);
    assert.deepEqual([...visible.keys()].sort(), c.expectVisible.map((t) => foldKey(nfc(t))).sort());

    if (c.source !== undefined && c.equivalent !== undefined) {
      assert.equal(
        positionFreeSha256(coreJsonOf(c.source, effective, vocabulary)),
        positionFreeSha256(coreJsonOf(c.equivalent, effective)),
        '被丢弃的触发词按关键词读',
      );
    }
  });
}
