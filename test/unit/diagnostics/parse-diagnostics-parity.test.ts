/**
 * ADR 0051 §16 R56/R57 双引擎诊断 parity（ts 侧）。
 *
 * 共享夹具 shared/parse_diagnostics_parity.json 与 aster-lang-core 的
 * src/test/resources/diagnostics/parse_diagnostics_parity.json byte-identical；core 侧
 * ParseDiagnosticsParityTest 对同一夹具断言同码同行。判定规则写在夹具的 description 里。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { resolveDeclarations } from '../../../src/frontend/resolve-declarations.js';
import { NO_IMPORTS } from '../../../src/frontend/resolution-context.js';
import { DiagnosticError } from '../../../src/diagnostics/diagnostics.js';
import { ERROR_METADATA } from '../../../src/diagnostics/error_codes.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';

interface ParityCase {
  readonly name: string;
  readonly lexicon?: string;
  readonly only?: 'ts' | 'core';
  readonly source: string;
  readonly structs?: readonly (readonly [string, string])[];
  readonly codes: readonly (readonly [string, number])[];
}

const REPO_ROOT = process.cwd();
const FIXTURE = resolve(REPO_ROOT, 'shared', 'parse_diagnostics_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: ParityCase[] }).cases;
/**
 * 码表已登记、但解析器尚未产出的码：E900（注解参数重名）由 Core IR v2 的 lowering 任务（T2）接入，
 * 届时与 core 同步补共享夹具并删除本项。
 */
const PENDING_PARSE_FIXTURES: ReadonlySet<string> = new Set(['E900']);
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE };

/** ts 侧判定：第一条解析错误；无解析错误时取名称解析（R1）的全部 error。 */
function tsCodes(c: ParityCase): [string, number][] {
  const lexicon = LEXICONS[c.lexicon ?? 'en-US'];
  assert.ok(lexicon, `未知 lexicon ${c.lexicon}`);
  try {
    const parsed = parseWithLexicon(lex(canonicalize(c.source, lexicon), lexicon), lexicon);
    const first = parsed.diagnostics.find((d) => d.severity === 'error');
    if (first) return [[first.code, first.span.start.line]];
    const structs = (c.structs ?? []).map(([canonical, localized]) => ({ canonical, localized, kind: IdentifierKind.STRUCT }));
    const scopes = structs.length === 0 ? undefined
      : buildVocabularyScopes({ id: 't', name: 't', locale: 'de-DE', version: '1', structs, fields: [], functions: [], enumValues: [] });
    const resolved = resolveDeclarations(parsed.ast, scopes ? { scopes, imports: NO_IMPORTS } : { imports: NO_IMPORTS });
    return resolved.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => [d.code, d.span?.start.line ?? 0]);
  } catch (e) {
    if (e instanceof DiagnosticError) return [[e.diagnostic.code, e.diagnostic.span.start.line]];
    throw e;
  }
}

describe('ADR 0051 §16 R56/R57 双引擎诊断 parity 夹具（ts 侧）', () => {
  for (const c of CASES.filter((x) => x.only !== 'core')) {
    it(c.name, () => {
      assert.deepEqual(tsCodes(c), c.codes);
    });
  }

  it('E050–E069 与 E900 每个码至少一例，且 E807 有冲突与非冲突两类夹具', () => {
    const covered = new Set(CASES.flatMap((c) => c.codes.map(([code]) => code)));
    const parseCodes = Object.values(ERROR_METADATA)
      .filter((m) => m.category === 'syntax')
      .map((m) => m.code as string);
    // 解析码段 E050–E069 已用满，续段从 E900 开始（ADR 0055 #3，locales core-ir/README.md「诊断码」）。
    assert.equal(parseCodes.length, 21);
    assert.deepEqual(parseCodes.filter((code) => !covered.has(code) && !PENDING_PARSE_FIXTURES.has(code)), []);
    assert.ok(covered.has('E807'));
    assert.ok(CASES.some((c) => c.name.startsWith('R57') && c.codes.length === 0), '缺 R57 非冲突夹具');
  });

  it('夹具中的 E050–E069 解析诊断都带命名参数、不再带 legacyCode', () => {
    for (const c of CASES.filter((x) => x.only !== 'core' && x.codes.some(([code]) => /^E0[56]\d$/.test(code)))) {
      const lexicon = LEXICONS[c.lexicon ?? 'en-US']!;
      let diag;
      try {
        diag = parseWithLexicon(lex(canonicalize(c.source, lexicon), lexicon), lexicon).diagnostics[0];
      } catch (e) {
        diag = (e as DiagnosticError).diagnostic;
      }
      assert.ok(diag, c.name);
      assert.equal('legacyCode' in diag, false, `${c.name}: legacyCode`);
      assert.ok(diag.params !== undefined, `${c.name}: params`);
    }
  });

  it('守卫：解析器报错点不再接受裸字符串（必须给出码与参数，见 parse-issue.ts）', () => {
    const dir = resolve(REPO_ROOT, 'src', 'parser');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      readFileSync(resolve(dir, file), 'utf8').split('\n').forEach((line, i) => {
        if (/\b(?:error|tools\.error|expectKeyword\(ctx, error, [\w.]+,)\(?\s*['"`]/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, []);
  });

  it('ts 夹具与 aster-lang-core 副本 byte-identical（跨仓同源）', () => {
    // 与 error-codes-parity 同口径：CI 中兄弟仓必须存在（fail-closed），本地未并列 checkout 时跳过。
    const RELATIVE = 'src/test/resources/diagnostics/parse_diagnostics_parity.json';
    const candidates = [
      resolve(REPO_ROOT, '..', 'aster-lang-core', RELATIVE),
      resolve(REPO_ROOT, 'aster-lang-core', RELATIVE),
    ];
    const inCi =
      process.env.CI === 'true' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.ASTER_ERROR_CODES_PARITY_REQUIRED === 'true';
    let javaBytes: Buffer | undefined;
    for (const candidate of candidates) {
      try {
        javaBytes = readFileSync(candidate);
        break;
      } catch {
        // 试下一个候选路径
      }
    }
    if (!javaBytes) {
      if (inCi) assert.fail(`CI 中必须 checkout aster-lang-core 才能校验 parity 夹具同源：\n${candidates.join('\n')}`);
      return;
    }
    assert.ok(readFileSync(FIXTURE).equals(javaBytes), 'parse_diagnostics_parity.json 与 aster-lang-core 副本必须 byte-identical');
  });
});
