import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DebounceMap } from '../../../src/lsp/debounce-map.js';

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ★issue #197：onDidClose 不撤销 pendingValidate 定时器，关闭后的回调仍会
//   为已关闭文档重新填充解析缓存。这里守住 cancel 的语义：撤销后回调绝不触发。
describe('DebounceMap', () => {
  it('到期触发回调并清除登记', async () => {
    const m = new DebounceMap();
    let fired = 0;
    m.schedule('a', 10, () => { fired++; });
    assert.equal(m.has('a'), true);
    await tick(40);
    assert.equal(fired, 1);
    assert.equal(m.has('a'), false);
  });

  it('★cancel 后回调绝不触发（文档关闭场景）', async () => {
    const m = new DebounceMap();
    let fired = 0;
    m.schedule('doc', 10, () => { fired++; });
    assert.equal(m.cancel('doc'), true);
    assert.equal(m.has('doc'), false);
    await tick(40);
    assert.equal(fired, 0, '已撤销的防抖回调仍被触发');
  });

  it('同 key 重复 schedule 只触发最后一次（防抖语义）', async () => {
    const m = new DebounceMap();
    const seen: string[] = [];
    m.schedule('doc', 10, () => { seen.push('first'); });
    m.schedule('doc', 10, () => { seen.push('second'); });
    await tick(40);
    assert.deepEqual(seen, ['second']);
  });

  it('不同 key 互不影响', async () => {
    const m = new DebounceMap();
    const seen: string[] = [];
    m.schedule('a', 10, () => { seen.push('a'); });
    m.schedule('b', 10, () => { seen.push('b'); });
    m.cancel('a');
    await tick(40);
    assert.deepEqual(seen, ['b']);
  });

  it('cancel 未登记的 key 返回 false', () => {
    assert.equal(new DebounceMap().cancel('nope'), false);
  });
});
