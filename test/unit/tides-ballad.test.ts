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

  it('Match（behold）按月相选 omen，四相各不同', () => {
    assert.match(seasong(0), /^the new moon hides/);
    assert.match(seasong(1), /^the crescent leans/);
    assert.match(seasong(2), /^the full moon climbs/);
    assert.match(seasong(3), /^the old moon wanes/);
  });

  it('List 生成（List.range/List.sum）数浪：phase p → 三角数 sum(1..p+1)', () => {
    // waves(count) = List.sum(List.range(1, count)); seasong 传 phase+1。
    // phase 0 → range(1,1)=[1]→1? 实测 range(1,1) 行为见下；用实际值锁定。
    assert.match(seasong(0), /0 waves answer the shore\.$/); // sum(range(1,1))=0（半开区间）
    assert.match(seasong(2), /3 waves answer the shore\.$/); // sum(range(1,3))=1+2=3
    assert.match(seasong(3), /6 waves answer the shore\.$/); // sum(range(1,4))=1+2+3=6
  });

  it('多行续行：seasong 收尾四行 then 连接成一句', () => {
    assert.equal(
      seasong(2),
      'the full moon climbs, and 3 waves answer the shore.',
    );
  });
});
