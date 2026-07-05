/**
 * ADR 0029：inline-if 的 then 连接词进入 SemanticTokenKind.THEN，并由四语词法表翻译。
 *
 * 不改 parser 判定逻辑：本地词先经 keyword-translator 归一为英文 `then`，再走现有
 * `isKeyword('then')` 软关键字路径。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compile } from '../../../src/browser.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { SemanticTokenKind } from '../../../src/config/token-kind.js';
import type { Core } from '../../../src/types.js';

type Case = {
  name: string;
  lexicon: Lexicon;
  thenWord: string;
  source: string;
};

const CASES: Case[] = [
  {
    name: 'en-US',
    lexicon: EN_US,
    thenWord: 'then',
    source: [
      'Module adr0029.',
      '',
      'Rule decide given cond as Bool, produce Text:',
      '  Return if cond then "A" else "B".',
    ].join('\n'),
  },
  {
    name: 'zh-CN',
    lexicon: ZH_CN,
    thenWord: '那么',
    source: [
      '模块 adr0029。',
      '',
      '规则 decide 给定 cond 作为 布尔，产出 文本：',
      '  返回 如果 cond 那么 「A」 否则 「B」。',
    ].join('\n'),
  },
  {
    name: 'de-DE',
    lexicon: DE_DE,
    thenWord: 'dann',
    source: [
      'Modul adr0029.',
      '',
      'Regel decide gegeben cond als Boolesch, liefert Text:',
      '  gib zurueck wenn cond dann "A" sonst "B".',
    ].join('\n'),
  },
  {
    name: 'hi-IN',
    lexicon: HI_IN,
    thenWord: 'तो',
    source: [
      'मॉड्यूल adr0029।',
      '',
      'नियम decide दिया गया cond रूप में बूलियन, उत्पन्न पाठ:',
      '  लौटाएं यदि cond तो "A" अन्यथा "B"।',
    ].join('\n'),
  },
];

function stripDerived(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripDerived);
  if (o && typeof o === 'object') {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === 'origin' || k === 'span') continue;
      r[k] = stripDerived((o as Record<string, unknown>)[k]);
    }
    return r;
  }
  return o;
}

function compileCore(source: string, lexicon: Lexicon): Core.Module {
  const result = compile(source, { lexicon });
  assert.equal(result.success, true, `${lexicon.id}: ${JSON.stringify(result.parseErrors ?? result.loweringErrors)}`);
  assert.ok(result.core, `${lexicon.id}: 应产出 Core IR`);
  return result.core;
}

function parseWithLexiconCore(source: string, lexicon: Lexicon): Core.Module {
  const canonical = canonicalize(source, lexicon);
  const tokens = lex(canonical, lexicon);
  const result = parseWithLexicon(tokens, lexicon);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  assert.equal(errors.length, 0, `${lexicon.id}: ${JSON.stringify(errors)}`);
  return lowerModule(result.ast);
}

function expectCompiles(source: string, lexicon: Lexicon): void {
  const result = compile(source, { lexicon });
  assert.equal(result.success, true, `${lexicon.id}: ${JSON.stringify(result.parseErrors ?? result.loweringErrors)}`);
}

describe('ADR 0029 — then 连接词四语本地化', () => {
  it('四语词法表都提供 THEN 补词', () => {
    assert.equal(EN_US.keywords[SemanticTokenKind.THEN], 'then');
    assert.equal(ZH_CN.keywords[SemanticTokenKind.THEN], '那么');
    assert.equal(DE_DE.keywords[SemanticTokenKind.THEN], 'dann');
    assert.equal(HI_IN.keywords[SemanticTokenKind.THEN], 'तो');
  });

  it('compile()：四语 inline-if 产出结构等价 Core IR', () => {
    const expected = stripDerived(compileCore(CASES[0]!.source, CASES[0]!.lexicon));
    for (const c of CASES) {
      assert.deepEqual(stripDerived(compileCore(c.source, c.lexicon)), expected, c.name);
    }
  });

  it('parseWithLexicon()：四语 inline-if 走通同一翻译链', () => {
    const expected = stripDerived(parseWithLexiconCore(CASES[0]!.source, CASES[0]!.lexicon));
    for (const c of CASES) {
      assert.deepEqual(stripDerived(parseWithLexiconCore(c.source, c.lexicon)), expected, c.name);
    }
  });

  it('compile() token translation 把本地 THEN 归一为英文 then', () => {
    for (const c of CASES.slice(1)) {
      const result = compile(c.source, { lexicon: c.lexicon, includeIntermediates: true });
      assert.equal(result.success, true, `${c.name}: ${JSON.stringify(result.parseErrors ?? result.loweringErrors)}`);
      assert.ok(result.tokens?.some((t) => t.value === 'then'), `${c.name}: 应出现翻译后的 then token`);
      assert.equal(
        result.tokens?.some((t) => t.value === c.thenWord),
        false,
        `${c.name}: 本地 then 词不应原样进入 parser`,
      );
    }
  });

  it('THEN 本地词在字段名和参数名位置仍是软关键字', () => {
    expectCompiles('Module m.\n\nDefine Box has then as Int.', EN_US);
    expectCompiles('Module m.\n\nRule echo given then as Int, produce Int:\n  Return then.', EN_US);

    expectCompiles('模块 m。\n\n定义 Box 包含 那么 作为 整数。', ZH_CN);
    expectCompiles('模块 m。\n\n规则 echo 给定 那么 作为 整数，产出 整数：\n  返回 那么。', ZH_CN);

    expectCompiles('Modul m.\n\nDefiniere Box hat dann als Ganzzahl.', DE_DE);
    expectCompiles('Modul m.\n\nRegel echo gegeben dann als Ganzzahl, liefert Ganzzahl:\n  gib zurueck dann.', DE_DE);

    expectCompiles('मॉड्यूल m।\n\nपरिभाषित Box रखता है तो रूप में पूर्णांक।', HI_IN);
    expectCompiles('मॉड्यूल m।\n\nनियम echo दिया गया तो रूप में पूर्णांक, उत्पन्न पूर्णांक:\n  लौटाएं तो।', HI_IN);
  });

  it('连写边界：那么值 不会被切成 then + 值', () => {
    expectCompiles('模块 m。\n\n定义 Box 包含 那么值 作为 整数。', ZH_CN);

    const result = compile(
      [
        '模块 m。',
        '',
        '规则 echo 给定 那么值 作为 整数，产出 整数：',
        '  返回 那么值。',
      ].join('\n'),
      { lexicon: ZH_CN, includeIntermediates: true },
    );
    assert.equal(result.success, true, JSON.stringify(result.parseErrors ?? result.loweringErrors));
    assert.ok(result.tokens?.some((t) => t.value === '那么值'), '连写词应作为一个标识符保留');
    assert.equal(result.tokens?.some((t) => t.value === 'then'), false, '那么值 不应产生 then token');
  });
});
