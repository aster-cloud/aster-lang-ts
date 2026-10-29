/**
 * 内置领域词汇的枚举成员端到端（ADR 0051 R26）：
 * 内置 finance.loan 词汇的枚举成员声明了所属枚举，本地化拼写经注册中心解析为规范成员。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DE_DE,
  ZH_CN,
  compileAndTypecheck,
  evaluate,
  initBuiltinVocabularies,
  resolvePolicyTypes,
  vocabularyRegistry,
} from '../../src/browser.js';
import type { Lexicon } from '../../src/config/lexicons/types.js';
import type { Core } from '../../src/types.js';

const CASES: ReadonlyArray<{ locale: string; lexicon: Lexicon; source: string; member: string; canonical: string }> = [
  {
    locale: 'de-DE',
    lexicon: DE_DE,
    source:
      'Modul kredit.\n\n' +
      'Definiere CreditLevel als eines von Ausgezeichnet, Gut, Befriedigend, Mangelhaft.\n\n' +
      'Regel einstufen gegeben x als Ganzzahl, liefert CreditLevel:\n' +
      '  gib zurueck CreditLevel.Ausgezeichnet.\n',
    member: 'Ausgezeichnet',
    canonical: 'Excellent',
  },
  {
    locale: 'zh-CN',
    lexicon: ZH_CN,
    source:
      '模块 kredit。\n\n' +
      '定义 CreditLevel 为以下之一 优秀, 良好, 一般, 较差。\n\n' +
      '规则 einstufen 给定 x 作为 整数，产出 CreditLevel：\n' +
      '  返回 CreditLevel.优秀。\n',
    member: '优秀',
    canonical: 'Excellent',
  },
];

describe('内置 finance.loan 词汇的枚举成员解析', () => {
  initBuiltinVocabularies();

  for (const c of CASES) {
    it(`${c.locale}：Define CreditLevel 的本地化成员解析为规范成员`, () => {
      const vocabulary = vocabularyRegistry.get('finance.loan', c.locale)!.vocabulary;

      const resolved = resolvePolicyTypes(c.source, { locale: c.locale, vocabulary });
      assert.equal(resolved.ok, true, JSON.stringify(resolved));
      if (!resolved.ok) return;
      const level = resolved.types.enums.find((e) => e.canonical === 'CreditLevel');
      assert.ok(level, JSON.stringify(resolved.types.enums));
      assert.deepEqual(level.members.map((m) => m.canonical), ['Excellent', 'Good', 'Fair', 'Poor']);
      assert.equal(level.members[0]!.written, c.member);

      const result = compileAndTypecheck(c.source, { lexicon: c.lexicon, vocabulary });
      assert.equal(result.success, true, JSON.stringify(result));
      const value = evaluate(result.core as Core.Module, 'einstufen', { x: 1 });
      assert.equal(value.success, true, value.error);
      assert.deepEqual(value.value, { __type: '?', _enum: 'CreditLevel', value: c.canonical, variant: c.canonical, args: [] });
    });
  }
});
