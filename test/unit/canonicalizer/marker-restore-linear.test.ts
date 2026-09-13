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
  it('★多词关键词密集的源码不得呈超线性增长', () => {
    const base = 8000;
    const small = timeOf(WITH_KEYWORDS.repeat(base));
    const large = timeOf(WITH_KEYWORDS.repeat(base * 2));

    // ★对照基线：同样翻倍，但输入不含多词关键词。
    //   它用来证明「若 large/small 偏大，原因是 marker 而非输入变长」。
    const ctrlSmall = timeOf(CONTROL.repeat(base));
    const ctrlLarge = timeOf(CONTROL.repeat(base * 2));
    const ctrlRatio = ctrlLarge / Math.max(ctrlSmall, 0.001);

    if (large < 1.0) {
      assert.ok(large < 200, `耗时 ${large.toFixed(2)}ms 超出绝对预算 200ms`);
      return;
    }

    const ratio = large / Math.max(small, 0.001);

    // ★判据是「**相对对照基线**的倍率」，不是写死的 3.0。
    //
    //   我第一版写死 `ratio < 3.0`，单独跑 2.0× 稳过，但**全量套件并发跑**时
    //   涨到 3.40× 直接变红——这是典型的 flaky 门禁，最后会被人加 skip。
    //
    //   对照基线与本组**同时**受调度抖动影响，故两者的比值把机器负载约掉了。
    //   缺陷态的信号极强（改前 ×9.69 vs 对照 ×1.94，差 5 倍），
    //   取 2.0 倍余量既挡得住回归，又扛得住噪声。
    const relative = ratio / Math.max(ctrlRatio, 0.001);
    assert.ok(relative < 2.0,
      `多词关键词源码 ${base}→${base * 2}（翻倍）耗时 ${small.toFixed(0)}ms→${large.toFixed(0)}ms，`
      + `增长 ${ratio.toFixed(2)}×；对照基线（等长无关键词）增长 ${ctrlRatio.toFixed(2)}×，`
      + `相对倍率 ${relative.toFixed(2)} —— 应 <2.0。\n`
      + '★对照线性而本组超线性，说明 marker 还原退回了「逐个 replace」的 O(M·n) 写法。\n'
      + '  修法：marked.replace(/\\x00KW\\d+\\x00/g, m => keywordMarkers.get(m) ?? m)');
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
