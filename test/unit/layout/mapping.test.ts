/**
 * canonicalToDisplay / displayToCanonical（ADR 0058 §7.8）：偏移单位为 UTF-16 code unit。
 * 期望值一律由 canonical / display 文本的 indexOf 推出，与实现无关。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalToDisplay, displayToCanonical, toCanonical, toDisplay } from '../../../src/layout/index.js';
import type { PolicyLayout } from '../../../src/layout/index.js';
import { JINGYESI_LAYOUT, SHERLOCK_LAYOUT } from './fixtures.js';

/** 每个内容 span 在 canonical 中的 [start, end) */
function contentRanges(layout: PolicyLayout): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = 0;
  for (const s of layout.spans) {
    const len = ('text' in s ? s.text : s.canonical).length;
    if ('text' in s) out.push([at, at + len]);
    at += len;
  }
  return out;
}

const EMOJI: PolicyLayout = {
  v: 1,
  spans: [{ text: 'a😀b' }, { canonical: '\r\n', display: '' }, { text: '中😀' }, { canonical: '。', display: '——' }],
};

describe('§7.8 往返不变式', () => {
  for (const [name, layout] of [['静夜思', JINGYESI_LAYOUT], ['斑点带子案', SHERLOCK_LAYOUT], ['代理对与 \\r\\n', EMOJI]] as const) {
    it(`${name}：内容 span 内每个偏移 p，displayToCanonical(canonicalToDisplay(p)) === p`, () => {
      const canonical = toCanonical(layout);
      const display = toDisplay(layout);
      let checked = 0;
      for (const [start, end] of contentRanges(layout)) {
        for (let p = start; p < end; p++) {
          const d = canonicalToDisplay(layout, p);
          assert.equal(d.start, d.end, '内容偏移映射为一个点');
          assert.equal(display[d.start], canonical[p], '内容字符原样对应');
          assert.deepEqual(displayToCanonical(layout, d.start), { start: p, end: p });
          checked++;
        }
      }
      assert.ok(checked > 0);
    });
  }
});

describe('结构 span 与边界', () => {
  const canonical = toCanonical(JINGYESI_LAYOUT);
  const display = toDisplay(JINGYESI_LAYOUT);

  it('结构 span 内的偏移映射到整段 display 区间', () => {
    // canonical「：\n  」→ display「，\n」
    const c = canonical.indexOf('：');
    const d = display.indexOf('望明月') + '望明月'.length;
    for (const p of [c, c + 1, c + 3]) {
      assert.deepEqual(canonicalToDisplay(JINGYESI_LAYOUT, p), { start: d, end: d + 2 });
    }
  });

  it('display 为空串的结构 span 映射到插入点（前后内容 span 之间）', () => {
    const p = EMOJI.spans[0]!;
    const insertion = 'text' in p ? p.text.length : -1;
    assert.deepEqual(canonicalToDisplay(EMOJI, insertion), { start: insertion, end: insertion });
    assert.deepEqual(canonicalToDisplay(EMOJI, insertion + 1), { start: insertion, end: insertion });
  });

  it('display 侧：结构 span 的 display 内偏移映射到其 canonical 区间', () => {
    const d = display.indexOf('，\n');
    const c = canonical.indexOf('。\n');
    assert.deepEqual(displayToCanonical(JINGYESI_LAYOUT, d), { start: c, end: c + 2 });
    assert.deepEqual(displayToCanonical(JINGYESI_LAYOUT, d + 1), { start: c, end: c + 2 });
  });

  it('文末偏移（= 长度）映射到另一侧的文末', () => {
    assert.deepEqual(canonicalToDisplay(JINGYESI_LAYOUT, canonical.length), { start: display.length, end: display.length });
    assert.deepEqual(displayToCanonical(JINGYESI_LAYOUT, display.length), { start: canonical.length, end: canonical.length });
  });

  it('越界或非整数偏移抛 RangeError', () => {
    for (const bad of [-1, canonical.length + 1, 0.5, Number.NaN]) {
      assert.throws(() => canonicalToDisplay(JINGYESI_LAYOUT, bad), RangeError);
    }
    assert.throws(() => displayToCanonical(JINGYESI_LAYOUT, display.length + 1), RangeError);
  });
});
