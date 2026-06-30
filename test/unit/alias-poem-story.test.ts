import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';
import { SemanticTokenKind } from '../../src/config/token-kind.js';
import type { Lexicon } from '../../src/config/lexicons/types.js';

// examples/alias-poem-story/nightfall.ballad.aster 的 CI 防回归：这份谣曲的**源码本身就是一首诗**
// （NIGHTFALL_EN 方言把结构词别名成诗的词），且必须能编译 + 执行（递归聚拢星光）。别名是
// recognition-side 归一（ADR 0022），故「诗体源码」与「规范关键词版」编译到结构一致的 Core IR
// ——本测试把这条不变式钉死（既证 demo 活着，也证别名机制本身）。
initializeAllBundledLexicons();

/** 与 examples/alias-poem-story/bard.mjs 的 NIGHTFALL_EN 同源——「源码即诗」方言。 */
const NIGHTFALL_EN: Lexicon = {
  ...EN_US,
  id: 'nightfall-en',
  name: 'Nightfall (English)',
  aliases: {
    [SemanticTokenKind.MODULE_DECL]: ['Nightfall'],
    [SemanticTokenKind.FUNC_TO]: ['I'],
    [SemanticTokenKind.FUNC_GIVEN]: ['count'],
    [SemanticTokenKind.IF]: ['while'],
    [SemanticTokenKind.RETURN]: ['sing'],
    [SemanticTokenKind.LET]: ['let'],
    [SemanticTokenKind.BE]: ['be'],
    [SemanticTokenKind.PLUS]: ['with'],
    [SemanticTokenKind.MINUS_WORD]: ['less'],
    [SemanticTokenKind.AT_MOST]: ['but'],
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

/** 编译并执行 `gather`（递归聚拢 n 颗星的光）。 */
function gather(stars: number): string {
  const c = compile(BALLAD, { lexicon: NIGHTFALL_EN });
  assert.ok(c.success && c.core, `ballad compile: ${JSON.stringify(c.parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'gather', { stars });
  assert.ok(ev.success, `ballad recite: ${ev.error ?? ''}`);
  return String(ev.value);
}

describe('examples/alias-poem-story — 源码即诗的 nightfall', () => {
  it('诗体源码编译成功（别名归一回规范关键词）', () => {
    const c = compile(BALLAD, { lexicon: NIGHTFALL_EN });
    assert.ok(c.success && c.core, `compile: ${JSON.stringify(c.parseErrors ?? [])}`);
  });

  it('源码每行都是诗句（标题 + 第一人称 + 缩进诗行）', () => {
    // 「源码即诗」契约：读源码本身就是一首诗。锁住几行的字面诗句形态。
    assert.match(BALLAD, /^Nightfall comes\./m);
    assert.match(BALLAD, /^I gather count stars:/m);
    assert.match(BALLAD, /and one last light to keep the dark from me/);
    assert.match(BALLAD, /and one more light to set the evening free/);
  });

  it('运行：gather 递归聚拢星光（押 me/free 韵）', () => {
    // base：一颗星 → 仅 "keep the dark from me"。
    assert.equal(gather(1), 'and one last light to keep the dark from me');
    // 递归累积：每多一颗星，叠一句 "set the evening free"。
    const two = gather(2);
    assert.match(two, /^and one last light to keep the dark from me/);
    assert.match(two, /and one more light to set the evening free$/);
    assert.notEqual(gather(1), gather(2));
    assert.notEqual(gather(2), gather(3));
  });

  it('类型全省：诗体源码无 as/produce 也能编译执行（类型推断）', () => {
    const c = compile(BALLAD, { lexicon: NIGHTFALL_EN });
    assert.ok(c.success, '全省类型仍编译');
    const ev = evaluate(c.core!, 'gather', { stars: 1 });
    assert.ok(ev.success && String(ev.value).includes('keep the dark from me'), String(ev.value));
  });

  it('别名不变式：诗体方言版 ≡ 规范关键词版（结构一致 Core IR）', () => {
    // 取 nightfall 的最小递归骨架，分别用 NIGHTFALL_EN 别名与规范关键词写，编译应得结构一致 IR
    //（剥 origin）。两版都省类型，确保走类型推断、IR 对齐。
    const poem = `Nightfall comes.\n\nI gather count stars:\n  while stars but 1\n    sing "a".\n  let earlier be gather(stars less 1).\n  sing earlier with "b".`;
    const canon = `Module comes.\n\nRule gather given stars:\n  If stars at most 1\n    Return "a".\n  Let earlier be gather(stars minus 1).\n  Return earlier + "b".`;
    const rp = compile(poem, { lexicon: NIGHTFALL_EN });
    const rc = compile(canon, { lexicon: EN_US });
    assert.ok(rp.success && rc.success, 'both compile');
    assert.deepEqual(stripOrigin(rp.core), stripOrigin(rc.core));
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
