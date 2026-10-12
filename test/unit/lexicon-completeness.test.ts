import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CI_OPTIONAL_KINDS, checkFirstPartyCompleteness } from '../../scripts/lexicon-completeness.js';
import { SemanticTokenKind } from '../../src/config/token-kind.js';
import { EN_US } from '../../src/config/lexicons/en-US.js';

// ADR 0029 / ADR 0046：1.0.32 发版列车后这些 kind 已转正，first-party 包缺失即 CI 失败
const PROMOTED = [
  'IMPORT_VERSION', 'THEN',
  'PROFILE', 'ALLOW', 'DENY', 'ESCALATE', 'REQUIRE_APPROVAL_BY', 'BECAUSE',
] as const;

const javaTokens = new Set<string>(Object.values(SemanticTokenKind));

function lexiconsWithout(kind?: string): Record<string, { keywords: Record<string, string> }> {
  const keywords: Record<string, string> = { ...EN_US.keywords };
  if (kind) delete keywords[kind];
  return { 'en-US': { keywords } };
}

describe('first-party lexicon 完整性（verify-lexicon-sync 3b）', () => {
  it('转正后的 kind 不再出现在 CI 可选集中', () => {
    for (const kind of PROMOTED) assert.equal(CI_OPTIONAL_KINDS.has(kind), false, kind);
  });

  it('完整的 first-party 包无错误无告警', () => {
    const result = checkFirstPartyCompleteness(javaTokens, lexiconsWithout(), ['en-US']);
    assert.equal(result.errors, 0);
    assert.equal(result.warnings, 0);
  });

  for (const kind of PROMOTED) {
    it(`first-party 包缺 ${kind} 是 CI 错误`, () => {
      const result = checkFirstPartyCompleteness(javaTokens, lexiconsWithout(kind), ['en-US']);
      assert.equal(result.errors, 1);
      assert.equal(result.warnings, 0);
      const errorLines = result.lines.filter(l => l.level === 'error').map(l => l.message);
      assert.ok(errorLines.some(m => m.includes(kind)), `错误应点名 ${kind}：${errorLines.join(' | ')}`);
    });
  }

  it('Java 导出中缺 first-party 包本身也是错误', () => {
    const result = checkFirstPartyCompleteness(javaTokens, {}, ['en-US']);
    assert.equal(result.errors, 1);
  });
});
