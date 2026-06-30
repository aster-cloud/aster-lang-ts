import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';
import { SemanticTokenKind } from '../../src/config/token-kind.js';
import type { Lexicon } from '../../src/config/lexicons/types.js';

// examples/alias-poem-story/tides.ballad.aster 的 CI 防回归：第二首谣曲展示 Match（behold）分支 +
// List 生成（List.range/List.sum）+ 等缩进多行续行，全经生产引擎编译执行。与 nightfall 同用 Bard
// 方言别名（recognition-side，ADR 0022）。
initializeAllBundledLexicons();

/** 与 bard.mjs 同源的 Bard 方言（含 Match→behold / When→as）。 */
const BARD_EN: Lexicon = {
  ...EN_US,
  id: 'bard-en',
  name: 'Bard (English)',
  aliases: {
    [SemanticTokenKind.MODULE_DECL]: ['Ballad'],
    [SemanticTokenKind.FUNC_TO]: ['Verse'],
    [SemanticTokenKind.FUNC_GIVEN]: ['of'],
    [SemanticTokenKind.LET]: ['let'],
    [SemanticTokenKind.BE]: ['become'],
    [SemanticTokenKind.IF]: ['where'],
    [SemanticTokenKind.RETURN]: ['sing'],
    [SemanticTokenKind.MATCH]: ['behold'],
    [SemanticTokenKind.WHEN]: ['as'],
    [SemanticTokenKind.PLUS]: ['then'],
    [SemanticTokenKind.AT_MOST]: ['but'],
    [SemanticTokenKind.AT_LEAST]: ['past'],
    [SemanticTokenKind.MINUS_WORD]: ['less'],
  },
};

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'examples'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root (with examples/) not found');
}

const TIDES = readFileSync(
  join(repoRoot(), 'examples', 'alias-poem-story', 'tides.ballad.aster'),
  'utf8',
);

function seasong(phase: number): string {
  const c = compile(TIDES, { lexicon: BARD_EN });
  assert.ok(c.success && c.core, `tides compile: ${JSON.stringify(c.parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'seasong', { phase });
  assert.ok(ev.success, `seasong: ${ev.error ?? ''}`);
  return String(ev.value);
}

describe('examples/alias-poem-story — tides 谣曲 (Match + List)', () => {
  it('Bard 方言源码编译成功', () => {
    const c = compile(TIDES, { lexicon: BARD_EN });
    assert.ok(c.success && c.core, `compile: ${JSON.stringify(c.parseErrors ?? [])}`);
  });

  it('Match（behold）按月相选 omen，四相各不同（押 -eep 韵）', () => {
    // 第一行（moon 行）押 -eep 韵：deep / sleep / leap / creep。
    assert.match(seasong(0), /^The new moon hides; the cove lies black and deep,/);
    assert.match(seasong(1), /^The crescent leans; the shallows stir from sleep,/);
    assert.match(seasong(2), /^The full moon climbs; the breakers rise to leap,/);
    assert.match(seasong(3), /^The old moon wanes; the long grey waters creep,/);
  });

  it('List 驱动意象（数字退到幕后）：swell 高度选潮汐意象，不念数字', () => {
    // swell(count)=List.sum(List.range(1,count)) 算出高度，behold 高度选意象（不印数字）；
    // 第二行也押 -eep 韵（keep）。phase p → height = sum(1..p)（半开区间 range(1,p+1)）。
    assert.match(seasong(0), /and not one wave to keep\.$/);      // height 0
    assert.match(seasong(1), /and a single tide to keep\.$/);     // height 1
    assert.match(seasong(2), /and a rising tide to keep\.$/);     // height 3
    assert.match(seasong(3), /and a flood the shore will keep\.$/); // height 6
    // 台面上看不到阿拉伯数字。
    assert.doesNotMatch(seasong(3), /[0-9]/);
  });

  it('多行续行 + 分行：seasong 是两行押韵对句', () => {
    const out = seasong(2);
    const lines = out.split('\n');
    assert.equal(lines.length, 2, 'moon 行 + swell 行');
    assert.equal(lines[0], 'The full moon climbs; the breakers rise to leap,');
    assert.equal(lines[1], 'and a rising tide to keep.');
  });
});
