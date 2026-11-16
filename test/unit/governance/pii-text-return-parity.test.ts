import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSource, resolveAndLowerChecked } from '../../../src/compile-pipeline.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { checkGovernance } from '../../../src/typecheck/governance.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';

// 两引擎共享夹具 shared/governance_pii_text_return_parity.json（与 aster-lang-core 同名测试资源逐字节相同；
// Java 对应 GovernancePiiTextReturnParityTest）：每例经完整编译通道得到 Core，断言 checkGovernance 给出的
// W709 序列 {rule, field, line} 与夹具一致，且每条都是不阻断的 warning（aster-cloud#772 方案 3）。

interface Expect {
  readonly rule: string;
  readonly field: string;
  readonly line: number;
}

interface Case {
  readonly name: string;
  readonly lexicon?: string;
  readonly vocabulary?: DomainVocabulary;
  readonly source: string;
  readonly expect: readonly Expect[];
}

const FIXTURE = JSON.parse(readFileSync(resolve(process.cwd(), 'shared', 'governance_pii_text_return_parity.json'), 'utf8')) as {
  readonly cases: readonly Case[];
};
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'zh-CN': ZH_CN, 'de-DE': DE_DE };

test('夹具覆盖正反例与已记录的限制', () => {
  const names = FIXTURE.cases.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 20);
  for (const n of ['concat-literal-and-pii-field', 'non-pii-field-not-reported', 'return-type-int-not-reported',
    'cross-function-not-propagated', 'set-overwrites-taint', 'localized-zh-canonical-path']) {
    assert.ok(names.includes(n), n);
  }
});

for (const c of FIXTURE.cases) {
  test(`W709 同夹具：${c.name}`, () => {
    const scopes = c.vocabulary ? buildVocabularyScopes(c.vocabulary) : undefined;
    const lexicon = c.lexicon ? LEXICONS[c.lexicon] : undefined;
    const parsed = parseSource(c.source, lexicon, scopes);
    assert.equal(parsed.diagnostics.filter((d) => d.severity === 'error').length, 0, JSON.stringify(parsed.diagnostics));
    const core = resolveAndLowerChecked(parsed.ast, scopes).core;

    const actual: Expect[] = [];
    for (const d of checkGovernance(core)) {
      if (d.code !== ErrorCode.GOV_PII_RETURNED_AS_TEXT) continue;
      assert.equal(d.severity, 'warning');
      const data = d.data as { rule: string; field: string };
      actual.push({ rule: data.rule, field: data.field, line: d.span?.start.line ?? -1 });
    }
    assert.deepEqual(actual, c.expect);
  });
}
