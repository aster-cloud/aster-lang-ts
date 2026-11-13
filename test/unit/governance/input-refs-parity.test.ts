import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSource, resolveAndLowerChecked } from '../../../src/compile-pipeline.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { analyzeInputRefs } from '../../../src/governance/input-refs.js';
import { controlRegistryFrom } from '../../../src/governance/controls.js';
import { checkGovernance } from '../../../src/typecheck/governance.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';

// 两引擎共享夹具 shared/governance_input_refs_parity.json（与 aster-lang-core 同名测试资源逐字节相同；
// Java 对应 GovernanceInputRefsParityTest）：逐函数断言 inputRefs，档案要求 verifiedInputs 时 E708 的
// {rule, profile, construct} 与夹具中 ["*"] 规则的 construct 一一对应（ADR 0046 §11 D2 / §11.6）。

interface Expect {
  readonly inputRefs: readonly string[] | null;
  readonly construct?: string;
}

interface Case {
  readonly name: string;
  readonly lexicon?: string;
  readonly vocabulary?: DomainVocabulary;
  readonly source: string;
  readonly expect: Readonly<Record<string, Expect>>;
}

const FIXTURE = JSON.parse(readFileSync(resolve(process.cwd(), 'shared', 'governance_input_refs_parity.json'), 'utf8')) as {
  readonly cases: readonly Case[];
};
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'zh-CN': ZH_CN, 'de-DE': DE_DE };
const PROFILE = 'eu-ai-act-high-risk';

/** 该档案只要求 verifiedInputs，其余要求关闭，使断言只看 E708。 */
const REQUIRING = controlRegistryFrom({
  version: 'test',
  frameworks: [{ id: 'EU_AI_ACT', title: { en: 'a', zh: 'a', de: 'a' } }],
  controls: [{ key: 'EU_AI_ACT:ART14', framework: 'EU_AI_ACT', article: '14', title: { en: 'a', zh: 'a', de: 'a' } }],
  clauses: [],
  profiles: [{ id: PROFILE, title: { en: 'a', zh: 'a', de: 'a' }, requires: { ruleId: false, registeredControls: false, frameworks: [], verifiedInputs: true } }],
});

test('夹具覆盖 ADR 表与计划指定用例', () => {
  const names = FIXTURE.cases.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 30);
  for (const n of ['adr-13-inline-depth-8', 'adr-14-inline-depth-9', 'adr-15-mutual-recursion', 'alias-same-name-as-local-function',
    'two-stars-callee-body-first', 'non-verdict-functions-get-no-input-refs', 'localized-zh-canonical-paths', 'localized-de-canonical-paths']) {
    assert.ok(names.includes(n), n);
  }
});

for (const c of FIXTURE.cases) {
  test(`inputRefs 与 E708 同夹具：${c.name}`, () => {
    const scopes = c.vocabulary ? buildVocabularyScopes(c.vocabulary) : undefined;
    const lexicon = c.lexicon ? LEXICONS[c.lexicon] : undefined;
    const parsed = parseSource(c.source, lexicon, scopes);
    assert.equal(parsed.diagnostics.filter((d) => d.severity === 'error').length, 0, JSON.stringify(parsed.diagnostics));
    const core = resolveAndLowerChecked(parsed.ast, scopes).core;

    const actual: Record<string, readonly string[] | null> = {};
    const expectedE708: Record<string, string> = {};
    for (const d of core.decls) {
      if (d.kind !== 'Func') continue;
      actual[d.name] = d.inputRefs === null ? null : [...d.inputRefs];
      const want = c.expect[d.name];
      if (want?.construct !== undefined) {
        expectedE708[d.name] = want.construct;
        assert.equal(analyzeInputRefs(core, d).construct, want.construct, `${d.name} construct`);
      }
    }
    const expected = Object.fromEntries(Object.entries(c.expect).map(([k, v]) => [k, v.inputRefs]));
    assert.deepEqual(actual, expected);

    const e708: Record<string, string> = {};
    for (const diag of checkGovernance(core, { controls: REQUIRING })) {
      if (diag.code !== ErrorCode.GOV_PROFILE_INPUT_UNRESOLVABLE) continue;
      const data = diag.data as { rule: string; profile: string; construct: string };
      assert.equal(data.profile, PROFILE);
      e708[data.rule] = data.construct;
    }
    assert.deepEqual(e708, expectedE708);
  });
}
