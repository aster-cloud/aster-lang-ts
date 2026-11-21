/**
 * 类型别名右侧在 TYPE 位置解析（ADR 0051 修订 1，aster-lang-test#174 第 5 项）。
 *
 * 此前别名右侧不解析，`Type Amount as Unbekannt.` 两引擎都静默接受。共享夹具 shared/type_alias_rhs_parity.json 与
 * aster-lang-core src/test/resources/diagnostics/type_alias_rhs_parity.json 逐字节相同，判定与 parse_diagnostics_parity 相同
 * （名称解析的全部 error [码, 行]，按报告顺序）；core TypeAliasRhsParityTest 按同一夹具断言。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { resolveDeclarations } from '../../../src/frontend/resolve-declarations.js';
import { NO_IMPORTS } from '../../../src/frontend/resolution-context.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import type * as AST from '../../../src/types.js';

interface AliasCase {
  readonly name: string;
  readonly lexicon?: string;
  readonly source: string;
  readonly structs?: readonly (readonly [string, string])[];
  readonly codes: readonly (readonly [string, number])[];
}

const FIXTURE = resolve(process.cwd(), 'shared', 'type_alias_rhs_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: AliasCase[] }).cases;
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE };

function resolveCase(source: string, lexiconId: string, structs: AliasCase['structs']) {
  const lexicon = LEXICONS[lexiconId];
  assert.ok(lexicon, `未知 lexicon ${lexiconId}`);
  const parsed = parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon);
  assert.deepEqual(parsed.diagnostics.filter((d) => d.severity === 'error'), [], '夹具源码须能解析');
  const mapped = (structs ?? []).map(([canonical, localized]) => ({ canonical, localized, kind: IdentifierKind.STRUCT }));
  const scopes = mapped.length === 0 ? undefined
    : buildVocabularyScopes({ id: 't', name: 't', locale: 'de-DE', version: '1', structs: mapped, fields: [], functions: [], enumValues: [] });
  return resolveDeclarations(parsed.ast, scopes ? { scopes, imports: NO_IMPORTS } : { imports: NO_IMPORTS });
}

describe('类型别名右侧在 TYPE 位置解析（共享夹具，ts 侧）', () => {
  it('共享夹具共 12 例', () => assert.equal(CASES.length, 12));

  for (const c of CASES) {
    it(c.name, () => {
      const { diagnostics } = resolveCase(c.source, c.lexicon ?? 'en-US', c.structs);
      const codes = diagnostics.filter((d) => d.severity === 'error').map((d) => [d.code, d.span?.start.line ?? 0]);
      assert.deepEqual(codes, c.codes);
    });
  }

  it('词汇本地类型名写回规范名（resolved.canonical），原写法保留', () => {
    const { module } = resolveCase('Modul p.\n\nDefiniere Customer mit alter als Ganzzahl.\n\nTyp K als Kunde.\n', 'de-DE', [['Customer', 'Kunde']]);
    const rhs = module.typeAliasDecls?.[0]?.type as AST.TypeName | undefined;
    assert.equal(rhs?.kind, 'TypeName');
    assert.equal(rhs?.name, 'Kunde');
    assert.equal(rhs?.resolved?.canonical, 'Customer');
  });
});
