import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';
import { SemanticTokenKind } from '../../src/config/token-kind.js';
import type { Lexicon } from '../../src/config/lexicons/types.js';

// examples/alias-poem-story 的 CI 防回归：那份「可运行的谣曲」demo（用关键词别名机制把
// Aster 结构词改写成吟游词）必须始终能编译 + 执行 + 产出预期诗句。别名是 recognition-side
// 归一（ADR 0022），故「Bard 方言版」与「规范关键词版」编译到结构一致的 Core IR——本测试
// 同时把这条不变式钉死（既证 demo 活着，也证别名机制本身）。
initializeAllBundledLexicons();

/** 与 examples/alias-poem-story/bard.mjs 同源的 Bard 方言 Lexicon。 */
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
    [SemanticTokenKind.PLUS]: ['then'],
    [SemanticTokenKind.AT_MOST]: ['but'],
    [SemanticTokenKind.AT_LEAST]: ['past'],
    [SemanticTokenKind.MINUS_WORD]: ['less'],
  },
};

/** 向上找到含 package.json 的仓库根（不依赖 dist 层级硬编码）。 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'examples'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root (with examples/) not found');
}

const BALLAD = readFileSync(
  join(repoRoot(), 'examples', 'alias-poem-story', 'nightfall.ballad.aster'),
  'utf8',
);

function recite(hour: number): string {
  const c = compile(BALLAD, { lexicon: BARD_EN });
  assert.ok(c.success && c.core, `ballad compile: ${JSON.stringify(c.parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'nightsong', { hour });
  assert.ok(ev.success, `ballad recite: ${ev.error ?? ''}`);
  return String(ev.value);
}

describe('examples/alias-poem-story — 可运行的别名谣曲 demo', () => {
  it('Bard 方言源码编译成功（别名归一回规范关键词）', () => {
    const c = compile(BALLAD, { lexicon: BARD_EN });
    assert.ok(c.success && c.core, `compile: ${JSON.stringify(c.parseErrors ?? [])}`);
  });

  it('递归诗节 stanza(3)：三行变化的星之叠唱（押 -ark 韵，分行）', () => {
    // stanza 用递归把 refrain 逐行叠起，三行各不同（one / a second / a third），押 -ark 韵。
    const c = compile(BALLAD, { lexicon: BARD_EN });
    assert.ok(c.success && c.core, `compile: ${JSON.stringify(c.parseErrors ?? [])}`);
    const ev = evaluate(c.core!, 'stanza', { n: 3 });
    assert.ok(ev.success, `stanza: ${ev.error ?? ''}`);
    const lines = String(ev.value).split('\n');
    assert.equal(lines.length, 3, '三行叠唱');
    assert.match(lines[0]!, /one star opens in the dark,$/);
    assert.match(lines[1]!, /a second leans to join the spark,$/);
    assert.match(lines[2]!, /a third, and then the sky is stark\.$/);
  });

  it('分支故事：到达时辰决定开场与去向（同源三命运，押 -ost/-ossed 韵）', () => {
    const dawn = recite(8);
    const dusk = recite(19);
    const midnight = recite(23);
    // 开场行各不同（frost / lost / crossed 同韵）。
    assert.match(dawn, /^Dawn still lingers, faint and crossed,/);
    assert.match(dusk, /^Dusk lets fall the day she lost,/);
    assert.match(midnight, /^Midnight crowns the hill with frost,/);
    // 黄昏后「walks on … uncrossed」，黎明「turns for home … daylight lost」。
    assert.match(dawn, /turns for home, the daylight lost;/);
    assert.match(dusk, /walks on, the road uncrossed;/);
    assert.match(midnight, /walks on, the road uncrossed;/);
    // 三命运彼此不同，且各为三行（开场 / 去向 / 三行星唱）。
    assert.notEqual(dawn, dusk);
    assert.notEqual(dusk, midnight);
    assert.equal(midnight.split('\n').length, 5, '开场+去向+三行星唱=5 行');
  });

  it('边界时辰 18：恰好入夜（past 18 → 黄昏走向）', () => {
    assert.match(recite(18), /the wanderer walks on, the road uncrossed;/);
  });

  it('类型全省：无 as/produce 的诗体规则也能编译执行（类型推断）', () => {
    // demo 的所有 Verse 都没写类型；这里单测最小递归 refrain 确认推断可行。
    const c = compile(BALLAD, { lexicon: BARD_EN });
    assert.ok(c.success, '全省类型仍编译');
    const ev = evaluate(c.core!, 'refrain', { n: 1 });
    assert.ok(ev.success && String(ev.value).includes('one star opens in the dark'), String(ev.value));
  });

  it('别名不变式：Bard 方言版 ≡ 规范关键词版（结构一致 Core IR）', () => {
    // 取一段最小递归，分别用 Bard 别名（无类型 + 中缀 then）与规范关键词写，编译应得结构一致
    // IR（剥离 origin）。注：规范版也省类型，确保两边都走类型推断、IR 对齐。
    const bard = `Ballad t.\n\nVerse echo of n:\n  where n but 1\n    sing "one".\n  let rest become echo(n less 1).\n  sing rest then "!".`;
    const canon = `Module t.\n\nRule echo given n:\n  If n at most 1\n    Return "one".\n  Let rest be echo(n minus 1).\n  Return rest + "!".`;
    const rb = compile(bard, { lexicon: BARD_EN });
    const rc = compile(canon, { lexicon: EN_US });
    assert.ok(rb.success && rc.success, 'both compile');
    assert.deepEqual(stripOrigin(rb.core), stripOrigin(rc.core));
  });
});

/** 剥离 origin（源码位置元数据，因关键词长度不同而偏移；ADR 0016 结构比较同此口径）。 */
function stripOrigin(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigin);
  if (o && typeof o === 'object') {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === 'origin') continue;
      r[k] = stripOrigin((o as Record<string, unknown>)[k]);
    }
    return r;
  }
  return o;
}
