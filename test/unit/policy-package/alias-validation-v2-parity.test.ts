/**
 * ADR 0060 §5.4 别名校验器 v2 跨引擎夹具（ts 侧）。
 *
 * shared/alias_validation_v2_parity.json 与 aster-lang-core 的 src/test/resources/diagnostics/ 副本逐字节相同；
 * core 侧 AliasValidationV2ParityTest（cases）与 AliasIdentifierGuardTest（guardCases）对同一夹具断言同样的结果。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { USER_ALIAS_VALIDATOR_VERSION, validateAliasSet, type AliasSet } from '../../../src/policy-package/alias-validate.js';
import { attributeParseFailure, checkAliasIdentifiers, forbiddenKeys } from '../../../src/policy-package/alias-identifier-guard.js';
import { CompileFailure, compileSource, lexiconForLocale } from '../../../src/policy-package/compile-source.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';

/** 与 core AliasValidationV2Fixture.SHA256 相同；改夹具须两仓同改并同步两侧常量。 */
const FIXTURE_SHA256 = '721ab90b1f847ce7e3806d32360db1157d6a1ac5368ef5d15f99e402464765c4';

interface ValidatorCase {
  readonly id: string;
  readonly locale: string;
  readonly allowStructural: boolean;
  readonly aliasSet: AliasSet | null;
  readonly vocabulary: DomainVocabulary | null;
  readonly valid: boolean;
  readonly codes: readonly string[];
}

interface GuardCase {
  readonly id: string;
  readonly locale: string;
  readonly allowStructural: boolean;
  readonly aliasSet: AliasSet | null;
  readonly vocabulary: DomainVocabulary | null;
  readonly source: string;
  readonly expect: 'ok' | 'alias_identifier_collision' | 'parse_error';
}

const REPO_ROOT = process.cwd();
const RELATIVE = 'shared/alias_validation_v2_parity.json';
const FIXTURE_BYTES = readFileSync(resolve(REPO_ROOT, RELATIVE));
const FIXTURE = JSON.parse(FIXTURE_BYTES.toString('utf8')) as {
  version: number;
  cases: ValidatorCase[];
  guardCases: GuardCase[];
};

/**
 * 校验器错误消息 → cloud AliasIssueCode 名。顺序有意义：结构词消息也以「不允许为」开头，须先判。
 * 与 core AliasValidationV2Fixture.issueCode 逐条相同。
 */
const ISSUE_CODES: readonly (readonly [string, string])[] = [
  ['别名集 kind 数量', 'tooManyKinds'],
  ['不允许为结构词 ', 'structuralNotGranted'],
  ['不允许为 ', 'kindNotAllowed'],
  [' 的别名数量 ', 'tooManyAliases'],
  [' 的别名不能为空', 'empty'],
  [' 的别名长度 ', 'tooLong'],
  ['含非规范空白', 'nonCanonical'],
  ['必须是多词短语', 'singleWord'],
  ['与某规范关键词或已有别名同形', 'shadowsKeyword'],
  ['在多个 kind 间重复定义', 'duplicate'],
  ['与领域词汇标识符同形', 'collidesVocabulary'],
  ['与字面量宏触发词同形', 'collidesVocabulary'],
];

function issueCode(message: string): string {
  const hit = ISSUE_CODES.find(([needle]) => message.includes(needle));
  if (!hit) throw new Error(`无法映射的校验器消息: ${message}`);
  return hit[1];
}

/** 编译失败时的诊断码集合（JSON 诊断取 code，纯文本诊断记为 text）。 */
function failureCodes(e: CompileFailure): string[] {
  const codes = e.diagnostics.map((d) => {
    try {
      return String((JSON.parse(d) as { code?: unknown }).code ?? 'text');
    } catch {
      return 'text';
    }
  });
  return [...new Set(codes)].sort();
}

describe('ADR 0060 别名校验器 v2 parity（ts 侧）', () => {
  it('校验器版本为 "2"、夹具版本为 2', () => {
    assert.equal(USER_ALIAS_VALIDATOR_VERSION, '2');
    assert.equal(FIXTURE.version, 2);
  });

  it('夹具 sha256 等于两仓共同钉住的值', () => {
    assert.equal(createHash('sha256').update(FIXTURE_BYTES).digest('hex'), FIXTURE_SHA256);
  });

  it('ts 夹具与 aster-lang-core 副本 byte-identical（跨仓同源）', () => {
    // 与 parse-diagnostics-parity 同口径：CI 中兄弟仓必须存在（fail-closed），本地未并列 checkout 时跳过。
    const CORE_RELATIVE = 'src/test/resources/diagnostics/alias_validation_v2_parity.json';
    const candidates = [resolve(REPO_ROOT, '..', 'aster-lang-core', CORE_RELATIVE), resolve(REPO_ROOT, 'aster-lang-core', CORE_RELATIVE)];
    const inCi =
      process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true' || process.env.ASTER_ERROR_CODES_PARITY_REQUIRED === 'true';
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
      if (inCi) assert.fail(`CI 中必须 checkout aster-lang-core 才能校验夹具同源：\n${candidates.join('\n')}`);
      return;
    }
    assert.ok(FIXTURE_BYTES.equals(javaBytes), 'alias_validation_v2_parity.json 与 aster-lang-core 副本必须 byte-identical');
  });

  describe('cases（只跑校验器）', () => {
    for (const c of FIXTURE.cases) {
      it(c.id, () => {
        const errors = validateAliasSet(c.aliasSet, {
          base: lexiconForLocale(c.locale),
          allowStructural: c.allowStructural,
          vocabulary: c.vocabulary ? buildVocabularyScopes(c.vocabulary) : undefined,
          locale: c.locale,
        });
        assert.equal(errors.length === 0, c.valid, errors.join('; '));
        assert.deepEqual([...new Set(errors.map(issueCode))].sort(), [...c.codes].sort(), errors.join('; '));
      });
    }
  });

  describe('guardCases（完整编译）', () => {
    for (const c of FIXTURE.guardCases) {
      it(c.id, () => {
        let failure: CompileFailure | undefined;
        try {
          compileSource(c.source, {
            locale: c.locale,
            aliasSet: c.aliasSet,
            allowStructural: c.allowStructural,
            vocabulary: c.vocabulary ?? undefined,
          });
        } catch (e) {
          if (!(e instanceof CompileFailure)) throw e;
          failure = e;
        }
        if (c.expect === 'ok') assert.equal(failure, undefined, failure?.diagnostics.join('\n'));
        else if (c.expect === 'alias_identifier_collision') {
          assert.ok(failure, '期望 E808，实际编译通过');
          assert.deepEqual(failureCodes(failure), ['E808'], failure.diagnostics.join('\n'));
        } else {
          assert.ok(failure, '期望解析错误，实际编译通过');
          assert.ok(!failureCodes(failure).includes('E808'), failure.diagnostics.join('\n'));
        }
      });
    }
  });
});

describe('别名名字守卫单元', () => {
  it('K 只含带汉字单词别名的 kind：英文规范拼写与别名本身', () => {
    assert.deepEqual([...forbiddenKeys({ RETURN: ['低头'], PLUS: ['接 着'] }, 'zh-CN').keys()].sort(), ['return', '低头']);
  });

  it('没有汉字单词别名（多词、或非 zh locale）时守卫不启用', () => {
    assert.equal(forbiddenKeys({ RETURN: ['answer it'] }, 'en-US').size, 0);
    assert.equal(forbiddenKeys({ RETURN: ['低头'] }, 'en-US').size, 0);
    assert.equal(forbiddenKeys(null, 'zh-CN').size, 0);
  });

  it('解析失败、而把该处别名换成普通名字即可解析时报 E808，诊断带名字、别名与 kind', () => {
    const source = '模块 测试。\n\n规则 甲 给定 低头 作为 整数，产出 整数：\n  返回 1。\n';
    assert.throws(
      () => compileSource(source, { locale: 'zh-CN', aliasSet: { RETURN: ['低头'] }, allowStructural: true }),
      (e: unknown) => {
        assert.ok(e instanceof CompileFailure);
        const d = JSON.parse(e.diagnostics[0]!) as { code: string; data: Record<string, string>; span: { start: { line: number; col: number } } };
        assert.equal(d.code, 'E808');
        assert.deepEqual(d.data, { name: '低头', alias: '低头', kind: 'RETURN' });
        assert.deepEqual(d.span.start, { line: 3, col: 9 });
        return true;
      },
    );
  });

  it('其他解析错误不改报 E808', () => {
    // 语法错误在别名之外：照常报解析错误
    const source = '模块 测试。\n\n规则 甲，产出 整数：\n  返回 1 加上。\n';
    assert.throws(
      () => compileSource(source, { locale: 'zh-CN', aliasSet: { RETURN: ['低头'] }, allowStructural: true }),
      (e: unknown) => e instanceof CompileFailure && !failureCodes(e).includes('E808'),
    );
  });

  it('checkAliasIdentifiers 对无名字冲突的 AST 返回空', () => {
    assert.deepEqual(
      checkAliasIdentifiers({ kind: 'Module', name: '测试', decls: [], span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } } } as never, { RETURN: ['低头'] }, 'zh-CN'),
      [],
    );
  });

  it('错误行的每处别名出现都会探测（不按个数截断）', () => {
    const source = '模块 测试。\n\n规则 甲，产出 整数：\n  低头 低头 低头 低头 低头 低头。\n';
    let calls = 0;
    const result = attributeParseFailure(source, 4, { RETURN: ['低头'] }, 'zh-CN', { exhausted: () => false, parses: () => ++calls === 6 });
    assert.equal(calls, 6);
    assert.deepEqual(result?.span?.start, { line: 4, col: 18 });
  });

  it('时限用尽后不再构造、也不再解析后面的候选', () => {
    const source = '模块 测试。\n\n规则 甲，产出 整数：\n  低头 低头 低头 低头 低头 低头。\n';
    let calls = 0;
    const result = attributeParseFailure(source, 4, { RETURN: ['低头'] }, 'zh-CN', {
      exhausted: () => calls >= 2,
      parses: () => {
        calls++;
        return false;
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 2);
  });
});
