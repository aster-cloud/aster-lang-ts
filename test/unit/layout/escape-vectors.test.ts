/**
 * L10 隐藏转义符共享向量（ADR 0059 修订 5 §6，shared/layout-vectors/display-escape.json，sha256 由 package-rules.test.ts 钉住）：
 * 按 L1–L7、L10a、L8–L9、L10b 的次序判定第一条失败的规则；L8–L10b 用本引擎编译。与 aster-lang-core LayoutEscapeVectorsTest 同一组向量；
 * 另断言 validatePolicyLayout 的 L10 码与「不给编译上下文即失败封闭」。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkHiddenEscapes,
  checkPackageLayout,
  hiddenEscapeTriples,
  irNameStrings,
  padStructuralSpans,
  stripHiddenEscapes,
  structuralNameHits,
  toCanonical,
  toDisplay,
  validatePolicyLayout,
  type PolicyLayout,
} from '../../../src/layout/index.js';
import { CompileFailure, compileSource, lexiconForLocale, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';

interface EscapeCase {
  id: string;
  lexicon: string;
  layoutText: string;
  aliasSet?: Record<string, string[]>;
  allowStructural?: boolean;
  vocabulary?: DomainVocabulary;
  triples?: string[];
  stripped?: string[];
  expect: string;
}

const CASES = (JSON.parse(readFileSync(join(process.cwd(), 'shared/layout-vectors/display-escape.json'), 'utf8')) as { cases: EscapeCase[] }).cases;
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

function compilerOf(c: EscapeCase): (source: string) => string | undefined {
  return (source) => {
    try {
      return positionFreeSha256(compileSource(source, {
        locale: c.lexicon,
        ...(c.aliasSet ? { aliasSet: c.aliasSet } : {}),
        ...(c.allowStructural ? { allowStructural: true } : {}),
        ...(c.vocabulary ? { vocabulary: c.vocabulary } : {}),
      }));
    } catch (e) {
      if (e instanceof CompileFailure) return undefined;
      throw e;
    }
  };
}

function ruleOf(e: unknown): string {
  if (e && typeof e === 'object' && 'rule' in e && typeof (e as { rule: unknown }).rule === 'string') return (e as { rule: string }).rule;
  throw e;
}

describe('L10 隐藏转义符：vectors/display-escape.json', () => {
  it('用例数不少于 20', () => assert.ok(CASES.length >= 20));
  for (const c of CASES) {
    it(`${c.id} → ${c.expect}`, () => {
      const layout = JSON.parse(c.layoutText) as PolicyLayout;
      const source = toCanonical(layout);
      const compile = compilerOf(c);
      let got = 'ok';
      try {
        const checked = checkPackageLayout({
          layoutBytes: encode(c.layoutText), displayBytes: encode(toDisplay(layout)), source, layoutVersion: 1,
          vocabularyLocalized: [], literalKeywords: [], operatorSpellings: [], l10b: 'deferred',
        });
        if (c.triples) assert.deepEqual(hiddenEscapeTriples(checked).map((t) => t.name), c.triples);
        if (c.stripped) {
          const t = hiddenEscapeTriples(checked);
          t.forEach((_, k) => assert.equal(stripHiddenEscapes(source, t, 1 << k), c.stripped![k]));
          assert.equal(stripHiddenEscapes(source, t, (1 << t.length) - 1), c.stripped[t.length]);
        }
        const hash = compile(source);
        assert.ok(hash !== undefined, `向量 ${c.id} 的规范源码编译不了`);
        const ir = compileSource(source, {
          locale: c.lexicon, ...(c.aliasSet ? { aliasSet: c.aliasSet, allowStructural: c.allowStructural === true } : {}),
          ...(c.vocabulary ? { vocabulary: c.vocabulary } : {}),
        });
        if (structuralNameHits(checked, irNameStrings(ir)).length > 0) throw Object.assign(new Error('L8'), { rule: 'L8' });
        if (compile(padStructuralSpans(checked)) !== hash) throw Object.assign(new Error('L9'), { rule: 'L9' });
        checkHiddenEscapes(checked, compile);
      } catch (e) {
        got = ruleOf(e);
      }
      assert.equal(got, c.expect);
    });
  }
});

describe('validatePolicyLayout 的 L10（ADR 0059 修订 5 §4.2）', () => {
  const byId = (id: string): EscapeCase => CASES.find((c) => c.id === id)!;
  const validate = (c: EscapeCase, withContext: boolean): ReturnType<typeof validatePolicyLayout> => {
    const layout = JSON.parse(c.layoutText) as PolicyLayout;
    return validatePolicyLayout(layout, toCanonical(layout), lexiconForLocale(c.lexicon), c.aliasSet,
      withContext ? { locale: c.lexicon, aliasSet: c.aliasSet ?? null, allowStructural: c.allowStructural === true, vocabulary: c.vocabulary ?? null } : undefined);
  };

  it('L10a 失败为 layout_escape_delimiter_invalid（E14 把关键词伪装成转义名）', () => {
    const r = validate(byId('E14'), true);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, 'layout_escape_delimiter_invalid');
  });

  it('不给编译上下文时含三元组即拒绝（失败封闭）；给了且 C⁻ 同一程序时通过（E3）', () => {
    const r = validate(byId('E3'), false);
    assert.equal(r.ok === false && r.code, 'layout_hidden_escape_changes_program');
    assert.deepEqual(validate(byId('E3'), true), { ok: true });
  });

  it('L10b 失败为 layout_hidden_escape_changes_program（E2 字段 版本）', () => {
    const r = validate(byId('E2'), true);
    assert.equal(r.ok === false && r.code, 'layout_hidden_escape_changes_program');
  });

  it('被隐藏的转义名不算「结构 span 藏值」：E1 通过', () => {
    assert.deepEqual(validate(byId('E1'), true), { ok: true });
  });
});
