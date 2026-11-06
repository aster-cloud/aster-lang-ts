/**
 * TS 不比 Java 严（aster-lang-ts#281）：语料中 Java 放行而 TS 报错的三处。
 *
 * - int_match：未写类型的 `given n` 按名字推断（视为未知），作 Match scrutinee 时整数模式不报 E010；
 * - workflow-compensate：compensate 体的返回值运行时被丢弃，Java 不检查其类型，TS 不再报 E022；
 * - vocab-de/type-alias-localized：签名中引用类型别名（Core 不含别名声明）不报 E006。
 *   在 parse → R1 → lower → R2 管线中未声明的类型名已由 E800 报告，E006 只会误伤别名，Java 亦不报。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileAndTypecheck, EN_US, DE_DE } from '../../../src/browser.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/index.js';

interface Diag { severity?: string; code: string }

function errorCodes(source: string, options: Parameters<typeof compileAndTypecheck>[1] = { lexicon: EN_US }): string[] {
  const r = compileAndTypecheck(source, options);
  return [...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? []), ...(r.typeErrors ?? [])]
    .map((d) => d as Diag)
    .filter((d) => d.severity === 'error' || d.severity === undefined)
    .map((d) => d.code);
}

describe('#281 TS 不比 Java 严', () => {
  it('int_match：按名推断的 scrutinee 上的整数模式不报 E010', () => {
    const src = [
      'Module demo.int_match.',
      '',
      'Rule classify given n, produce:',
      '  Match n:',
      '    When 0, Return "zero".',
      '    When 42, Return "answer".',
      '',
    ].join('\n');
    assert.deepEqual(errorCodes(src), []);
  });

  it('显式 Int scrutinee 上的整数模式仍然放行', () => {
    const src = 'Module m.\n\nRule f given n as Int, produce Text:\n  Match n:\n    When 0, Return "zero".\n  Return "other".\n';
    assert.deepEqual(errorCodes(src), []);
  });

  // 运行时（aster-lang-truffle MatchNode.PatIntNode）对非数值 scrutinee 只返回「不匹配」并落到后续分支，
  // 行为有定义、不崩溃；Java 也不报 E010。因此显式非 Int 类型同样放行。
  for (const ty of ['Float', 'Decimal', 'Text']) {
    it(`显式 ${ty} scrutinee 上的整数模式不报 E010`, () => {
      const src = `Module m.\n\nRule f given n as ${ty}, produce Text:\n  Match n:\n    When 0, Return "zero".\n  Return "other".\n`;
      assert.deepEqual(errorCodes(src), []);
    });
  }

  it('workflow-compensate：compensate 返回 Result of Text 不报 E022', () => {
    const src = [
      'Module demo.workflow.compensate.',
      '',
      'Rule processOrder, produce. It performs io:',
      '  workflow:',
      '    step reserve:',
      '      return ok of "reserved".',
      '',
      '    compensate:',
      '      return ok of "released".',
      '',
      '    step execute:',
      '      return ok of "executed".',
      '  .',
      '',
    ].join('\n');
    assert.deepEqual(errorCodes(src), []);
  });

  it('签名引用类型别名不报 E006（en）', () => {
    const src = 'Module m.\n\ntype Score as Int.\n\nRule up given x as Score, produce Score:\n  Return x plus 1.\n';
    assert.deepEqual(errorCodes(src), []);
  });

  it('vocab-de/type-alias-localized：本地化别名名不报 E006', () => {
    const vocabulary: DomainVocabulary = {
      id: 'parity.vocab.type-alias-localized',
      name: '本地化类型别名名',
      locale: 'de-DE',
      version: '1.0.0',
      structs: [{ canonical: 'Score', localized: 'Punkte', kind: 'struct' }],
      fields: [],
      functions: [],
      enumValues: [],
      literals: [],
    } as unknown as DomainVocabulary;
    const src = [
      'Modul versicherung.alias.',
      '',
      'type Punkte as Ganzzahl.',
      '',
      'Regel erhoehen gegeben x als Punkte, liefert Punkte:',
      '  gib zurueck x plus 1.',
      '',
    ].join('\n');
    assert.deepEqual(errorCodes(src, { lexicon: DE_DE, vocabulary }), []);
  });

  it('未声明的类型名仍由名称解析报 E800', () => {
    const src = 'Module m.\n\nRule bad of T given x as U, produce T:\n  Return x.\n';
    assert.ok(errorCodes(src).includes('E800'));
  });
});
