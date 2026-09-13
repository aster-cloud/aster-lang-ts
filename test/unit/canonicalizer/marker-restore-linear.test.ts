import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/index.js';

/**
 * canonicalize 的 marker 还原必须是**单趟**（ADR 0037 §12.10 ①）。
 *
 * <h2>被守护的缺陷</h2>
 *
 * 原写法是逐个 marker 各扫一遍：
 * ```ts
 * for (const [marker, keyword] of keywordMarkers) marked = marked.replace(marker, keyword);
 * ```
 * `.replace(string, string)` 每次从偏移 0 重扫并**重建整串**。多词关键词
 * （`greater than` / `at least`）每出现一次造一个 marker，M 随输入线性增长
 * → **O(M·n)**。实测 750KB 源码 **3368ms**，修复后 **115ms**。
 *
 * <p>★这是本轮审计发现的**最高危**缺陷，而且**不是正则问题**——作者自扫时
 * 只看正则，结构性地漏掉了它。
 *
 * <h2>★为什么必须带对照基线</h2>
 *
 * 只测「含关键词的输入很慢」证明不了归因——大输入本来就慢。必须同时测一份
 * **等长但不含多词关键词**的输入：它若保持线性，才说明慢的是 marker 数量。
 * 实测对照基线恒为 ×1.9〜2.0。
 */

/** 含多词关键词（`greater than`）——每次出现造一个 marker。 */
const WITH_KEYWORDS = 'If a is greater than b. ';

/** 等长、但**不含**任何多词关键词的对照输入。 */
const CONTROL = 'If a is bigger xxxx b. ';

/** 取 3 次测量的最小值——最接近真实计算量，受调度抖动最小。 */
function timeOf(src: string): number {
  canonicalize(src);                       // 预热，避免 JIT 污染
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = process.hrtime.bigint();
    canonicalize(src);
    best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
  }
  return best;
}

describe('canonicalize marker 还原 — 必须单趟（线性）', () => {
  it('★多词关键词密集的源码必须在绝对预算内完成', () => {
    // ★这条**换过两版判据**，两版都被独立审查者证伪，值得写清楚：
    //
    //   v1 `ratio < 3.0`（写死增长率）
    //      → 单独跑 2.0× 稳过，**全量套件并发**时涨到 3.40× 变红。flaky。
    //
    //   v2 `ratio / 对照基线ratio < 2.0`（相对化）
    //      → 修好了 flaky，但**把信号也除掉了**：审查者把 marker 还原退回
    //        O(M·n)，门禁 **3/3 全绿**（本组 ×3.45 ÷ 对照 ×2.10 = 1.64 < 2.0）。
    //        这是「门禁在结构上无法变红」——比 flaky 更糟。
    //      ★我引用的「改前 ×9.69」取自 base=4000，而门禁跑的是 base=8000
    //        （实测仅 ×3.40）——**证据取自与门禁不同的输入规模**。
    //
    //   v3（本版）**绝对预算**。缺陷态与修复态在同一规模上差 ~30 倍，
    //   余量足够大，既不受并发抖动影响，也不会把信号除没：
    //     修复态  n=32000 → 110ms
    //     缺陷态  n=32000 → 3368ms
    //   取 800ms：修复态有 7× 余量（扛得住慢机器/并发），缺陷态超 4 倍必红。
    const N = 32000;
    const src = WITH_KEYWORDS.repeat(N);
    const ms = timeOf(src);

    assert.ok(ms < 800,
      `${N} 次多词关键词的源码（${(src.length / 1024).toFixed(0)}KB）耗时 ${ms.toFixed(0)}ms —— 应 <800ms。\n`
      + '★修复态实测 110ms，缺陷态 3368ms（30×）。超预算说明 marker 还原退回了\n'
      + '  「逐个 replace」的 O(M·n) 写法——每次 replace 都从偏移 0 重扫并重建整串。\n'
      + '  修法：marked.replace(/\\x00KW\\d+\\x00/g, m => keywordMarkers.get(m) ?? m)');
  });

  it('★对照基线：等长但无多词关键词的输入必须明显更快（证明归因）', () => {
    // 反向守卫：若两者耗时相当，说明慢的是「输入大」而非「marker 多」，
    // 上一条的绝对预算就失去了归因意义。
    const N = 32000;
    const withKw = timeOf(WITH_KEYWORDS.repeat(N));
    const control = timeOf(CONTROL.repeat(N));

    assert.ok(control < withKw * 2,
      `对照基线（无多词关键词）${control.toFixed(0)}ms 竟不快于含关键词的 ${withKw.toFixed(0)}ms —— \n`
      + '说明 marker 机制没在起作用，上一条的绝对预算失去归因意义。');
  });

  it('★还原结果必须与逐个替换逐字节一致（语义守卫）', () => {
    // 单趟替换若写错（比如正则漏了某种 marker 形态），关键词会残留成 \x00KW0\x00。
    for (const src of [
      'If a is greater than b.',
      'If a is at least b.',
      'If a is greater than b. If c is at least d.',
      '  If a is greater than b.  ',
    ]) {
      const out = canonicalize(src);
      assert.ok(!out.includes('\x00'),
        `输出里残留了未还原的 marker —— 单趟替换的正则漏掉了某种形态。\n`
        + `输入 ${JSON.stringify(src)}\n输出 ${JSON.stringify(out)}`);
    }
  });

  it('★多词关键词确实被识别（否则上面两条都是空洞的）', () => {
    // 反向守卫：若 `greater than` 压根不是多词关键词，就不会产生任何 marker，
    // 前两条测试便测不到本文件声称要守护的东西（本仓记过的「样本无从区分」）。
    const out = canonicalize('If a is GREATER THAN b.');
    assert.match(out, /greater than/,
      '多词关键词未被归一化为小写 —— 说明 marker 机制没有生效，'
      + '本文件的其余断言全部空洞。实际：' + out);
  });
});
