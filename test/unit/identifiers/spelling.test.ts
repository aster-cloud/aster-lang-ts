/**
 * @module test/unit/identifiers/spelling.test
 *
 * 通用写法解析：NFC 精确匹配优先，其次折叠匹配；同一层多个不同项即撞名（aster-cloud#650）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpellingIndex, resolveSpelling } from '../../../src/config/lexicons/identifiers/spelling.js';

interface Item {
  readonly canonical: string;
  readonly spellings: readonly string[];
}

const index = (items: readonly Item[]) =>
  buildSpellingIndex(items, (i) => i.spellings, (i) => i.canonical);

describe('resolveSpelling', () => {
  it('精确命中', () => {
    const r = resolveSpelling(index([{ canonical: 'Driver', spellings: ['Fahrer'] }]), 'Fahrer');
    assert.equal(r.kind, 'one');
    assert.equal(r.kind === 'one' && r.item.canonical, 'Driver');
  });

  it('精确未命中时按折叠键唯一命中', () => {
    const r = resolveSpelling(index([{ canonical: 'Driver', spellings: ['Fahrer'] }]), 'FAHRER');
    assert.equal(r.kind === 'one' && r.item.canonical, 'Driver');
  });

  it('精确优先于折叠：大小写不同的两项，精确写法只命中自己', () => {
    const idx = index([
      { canonical: 'a', spellings: ['Score'] },
      { canonical: 'b', spellings: ['score'] },
    ]);
    const r = resolveSpelling(idx, 'score');
    assert.equal(r.kind === 'one' && r.item.canonical, 'b');
    const c = resolveSpelling(idx, 'SCORE');
    assert.equal(c.kind, 'conflict');
    assert.deepEqual(c.kind === 'conflict' && c.items.map((i) => i.canonical), ['a', 'b']);
  });

  it('精确层撞名即撞名，不退回折叠层', () => {
    const r = resolveSpelling(index([
      { canonical: 'x', spellings: ['n'] },
      { canonical: 'y', spellings: ['n'] },
    ]), 'n');
    assert.equal(r.kind, 'conflict');
  });

  it('同一项的多个写法折叠到同一键不算撞名', () => {
    const r = resolveSpelling(index([{ canonical: 'Driver', spellings: ['Driver', 'driver', 'DRIVER'] }]), 'dRiVeR');
    assert.equal(r.kind === 'one' && r.item.canonical, 'Driver');
  });

  it('NFC：分解形式的写法与组合形式等价', () => {
    const r = resolveSpelling(index([{ canonical: 'cafe', spellings: ['café'] }]), 'café');
    assert.equal(r.kind === 'one' && r.item.canonical, 'cafe');
  });

  it('未命中返回 none；空索引同样', () => {
    assert.equal(resolveSpelling(index([{ canonical: 'a', spellings: ['a'] }]), 'b').kind, 'none');
    assert.equal(resolveSpelling(index([]), 'a').kind, 'none');
  });
});
