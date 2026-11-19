/**
 * 《静夜思》原诗即策略（ADR 0060 §8 证明第 1、3 条的 ts 一侧）：zh-CN + 四个汉字单词结构词别名 + 两条内嵌词条
 * 经 compileSource（与包导出 / Node 重编译同一入口，含别名校验 v2 与名字守卫）编译零诊断，求值 `地上霜` 得 `静夜思`。
 *
 * JINGYESI_POSITION_FREE_SHA256 是 Core IR 的去列投影哈希（ADR 0059 修订 1 A2）；aster-api 列车后的 Java 侧证明
 * （计划 T7 `coreIrMatchesTs`）以同一值作期望，两引擎 Core IR 一致才通过。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompileFailure, compileSource, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';
import { evaluatePackage } from '../../../src/policy-package/evaluate-package.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';

/** ADR 0060 §8 源码（与 cloud 演示 POEM_ZH.source 逐字节相同）。 */
const SOURCE = '床前 明月光。\n疑是 地上霜，举头 望明月：\n  低头 思故乡。\n';
/** ADR 0060 §8 aliasSet（全是结构词，需授权）。 */
const ALIASES = { FUNC_PRODUCE: ['举头'], FUNC_TO: ['疑是'], MODULE_DECL: ['床前'], RETURN: ['低头'] };
/** ADR 0060 §8 内嵌词汇转成的引擎形状（§6.1 toDomainVocabulary）。 */
const VOCAB: DomainVocabulary = {
  id: 'policy.embedded',
  name: 'policy',
  locale: 'zh-CN',
  version: '1',
  structs: [{ localized: '望明月', canonical: 'Text', kind: 'struct' } as DomainVocabulary['structs'][number]],
  fields: [],
  functions: [],
  enumValues: [],
  literals: [{ localized: '思故乡', canonical: '静夜思', kind: 'literal' } as NonNullable<DomainVocabulary['literals']>[number]],
};

/** 改动诗的编译结果（或 Core IR 形状）须同步 aster-api 的 Java 侧期望值。 */
export const JINGYESI_POSITION_FREE_SHA256 = '55512170231ae56d7f01b8130ce368d650c5b390ad6f0ac7f34d5350c8960ec6';

const compilePoem = (overrides: Partial<Parameters<typeof compileSource>[1]> = {}): string =>
  compileSource(SOURCE, { locale: 'zh-CN', aliasSet: ALIASES, allowStructural: true, vocabulary: VOCAB, ...overrides });

describe('《静夜思》原诗即策略（ADR 0060 §8）', () => {
  it('compiles with zh-CN, the v2 aliasSet and the embedded vocabulary', () => {
    const coreJson = compilePoem();
    const core = JSON.parse(coreJson) as { name: string; decls: { kind: string; name: string }[] };
    assert.equal(core.name, '明月光');
    assert.deepEqual(core.decls.map((d) => [d.kind, d.name]), [['Func', '地上霜']]);
  });

  it('evaluates 地上霜 to 静夜思', () => {
    const result = evaluatePackage(compilePoem(), '地上霜', {});
    assert.ok(result.ok, result.ok ? '' : result.message);
    assert.equal(JSON.parse(result.valueJson), '静夜思');
  });

  it('is rejected without the structural grant', () => {
    assert.throws(
      () => compilePoem({ allowStructural: false }),
      (e: unknown) => e instanceof CompileFailure && e.diagnostics.some((d) => d.includes('FUNC_PRODUCE')),
    );
  });

  it('fails without the embedded vocabulary', () => {
    assert.throws(() => compilePoem({ vocabulary: undefined }), CompileFailure);
  });

  it('fails without the aliasSet', () => {
    assert.throws(() => compilePoem({ aliasSet: null }), CompileFailure);
  });

  it('positionFreeSha256 is stable', () => {
    assert.equal(positionFreeSha256(compilePoem()), JINGYESI_POSITION_FREE_SHA256);
  });
});
