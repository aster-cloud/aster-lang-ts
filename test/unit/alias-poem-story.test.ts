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

  it('递归诗节：stars(3) 累积三颗星（中缀 then 拼接）', () => {
    // 三个时辰都含递归生成的诗节尾巴。
    const stanza = 'a single star, then another star, then another star';
    assert.ok(recite(8).endsWith(stanza), recite(8));
  });

  it('分支故事：到达时辰决定开场与结局（同源三命运）', () => {
    const dawn = recite(8);
    const dusk = recite(19);
    const midnight = recite(23);
    // 三个时辰开场不同。
    assert.match(dawn, /^dawn still lingers low, /);
    assert.match(dusk, /^dusk unfolds her veil, /);
    assert.match(midnight, /^midnight crowns the hill, /);
    // 黄昏后走「walks on, counting」，黎明走「turns home, leaving」。
    assert.match(dawn, /turns home, leaving/);
    assert.match(dusk, /walks on, counting/);
    assert.match(midnight, /walks on, counting/);
    // 三命运彼此不同。
    assert.notEqual(dawn, dusk);
    assert.notEqual(dusk, midnight);
  });

  it('边界时辰 18：恰好入夜（past 18 → 黄昏走向）', () => {
    assert.match(recite(18), /^dusk unfolds her veil, and the wanderer walks on, counting/);
  });

  it('类型全省：无 as/produce 的诗体规则也能编译执行（类型推断）', () => {
    // demo 的所有 Verse 都没写类型；这里单测一条最小无类型递归规则确认推断可行。
    const c = compile(BALLAD, { lexicon: BARD_EN });
    assert.ok(c.success, '全省类型仍编译');
    const ev = evaluate(c.core!, 'stars', { n: 1 });
    assert.ok(ev.success && ev.value === 'a single star', String(ev.value));
  });

  it('别名不变式：Bard 方言版 ≡ 规范关键词版（结构一致 Core IR）', () => {
    // 取 stars 诗节，分别用 Bard 别名（无类型 + 中缀 then）与规范关键词写，编译应得结构一致
    // IR（剥离 origin）。注：规范版也省类型，确保两边都走类型推断、IR 对齐。
    const bard = `Ballad t.\n\nVerse stars of n:\n  where n but 1\n    sing "a single star".\n  let earlier be stars(n less 1).\n  sing earlier then "!".`;
    const canon = `Module t.\n\nRule stars given n:\n  If n at most 1\n    Return "a single star".\n  Let earlier be stars(n minus 1).\n  Return earlier + "!".`;
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
