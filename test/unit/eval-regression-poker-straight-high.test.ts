import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

/**
 * aster-cloud 扑克摊牌引擎在 1.0.29+ 报「List.get: index out of bounds: 4 (size=4)」的回归护栏。
 *
 * 根因：规则里 `Let straightHigh be List.get(sortedDistinct, 4)` 无条件求值，
 * 含对子的 5 张牌只有 4 个不同点数，下标 4 必然越界。1.0.28 及以前 TS 解释器
 * 越界静默返回 undefined（该值又恰好没被用到），所以「看起来能跑」；
 * 1.0.29 起 List.get 越界抛错，与 truffle 一致（aster-dev#32），潜伏缺陷暴露。
 *
 * 本测试固定三条契约：
 * - Let 绑定按序立即求值，不因后续分支未使用而跳过——越界照样报错（两引擎一致）；
 * - 用不越界的写法（List.max）取顺子高牌即可得到正确结果；
 * - `and` 短路：左侧为假时右侧的越界 List.get 不会被求值（TS 求值器的设计语义）。
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = readFileSync(
  join(repoRoot, 'test', 'fixtures', 'eval-regression', 'poker-straight-high.aster'),
  'utf8',
);

// 对子 K 的 5 张牌：4 个不同点数，即原 KK>QQ 用例里的组合形态。
const PAIR_HAND = [13, 13, 12, 2, 5];
const STRAIGHT_HAND = [9, 10, 11, 12, 13];
const WHEEL_HAND = [14, 2, 3, 4, 5];

function run(entry: string, ranks: number[]): { success: boolean; value: unknown; error: string } {
  const c = compile(source);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { diagnostics?: unknown }).diagnostics ?? [])}`);
  const ev = evaluate(c.core!, entry, { ranks });
  return { success: ev.success, value: ev.value, error: String(ev.error ?? '') };
}

describe('扑克顺子高牌：Let 立即求值 + List.get 越界（aster-cloud 1.0.31 升级回归）', () => {
  it('★原写法遇对子手牌越界报错（复现 aster-cloud 的失败信息）', () => {
    const r = run('straightHighEager', PAIR_HAND);
    assert.equal(r.success, false, `必须失败，实际 value=${JSON.stringify(r.value)}`);
    assert.match(r.error, /List\.get: index out of bounds: 4 \(size=4\)/, `实际：${r.error}`);
  });

  it('原写法遇 5 个不同点数时正常返回顺子高牌', () => {
    const r = run('straightHighEager', STRAIGHT_HAND);
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 13);
  });

  it('改用 List.max 后对子手牌不再越界，顺子结果不变', () => {
    const pair = run('straightHighSafe', PAIR_HAND);
    assert.equal(pair.success, true, pair.error);
    assert.equal(pair.value, 0);
    const straight = run('straightHighSafe', STRAIGHT_HAND);
    assert.equal(straight.success, true, straight.error);
    assert.equal(straight.value, 13);
  });

  it('and 短路护住越界下标：对子手牌判轮子为假且不报错', () => {
    const pair = run('isWheel', PAIR_HAND);
    assert.equal(pair.success, true, pair.error);
    assert.equal(pair.value, false);
    const wheel = run('isWheel', WHEEL_HAND);
    assert.equal(wheel.success, true, wheel.error);
    assert.equal(wheel.value, true);
  });
});
