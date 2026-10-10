import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractQuantities } from '../../../src/mapping/quantity-ir.js';
import { parseSourceIr } from '../../../src/mapping/source-ir.js';

/**
 * ReDoS **时间预算门禁**（ADR 0037 §12.6）。
 *
 * <h2>★为什么不能只用「绝对毫秒阈值」</h2>
 *
 * `quantity-ir.test.ts` 里已有一条 `ms < 500` 的断言。它能抓住「锚点被删」，
 * 但作为**门禁**有结构性缺陷：
 *
 * <ul>
 *   <li>阈值定低 → 共享 CI runner 抖动就红（flaky，最后被人加 skip）</li>
 *   <li>阈值定高 → 一个「只慢 3 倍」的新回溯照样溜过去（门禁形同虚设）</li>
 * </ul>
 *
 * <p>★灾难性回溯的特征不是「慢」，是**随输入长度超线性增长**。所以这里量的是
 * <b>增长率</b>而非绝对耗时：输入翻倍，耗时应大致翻倍（线性）；若接近翻四倍
 * （二次），就是回溯回来了。增长率对机器速度**不敏感**——慢机器上两个数据点
 * 一起变慢，比值不变。
 *
 * <p>实测（未加锚时）正是二次：5000→36ms、10000→144ms、20000→576ms、
 * 40000→2304ms，每翻倍约 ×4。
 */

/** 单次计时（毫秒）。 */
function timeOnce(fn: () => void): number {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

/** 取多次测量的**最小值**——最小值最接近真实计算量，受调度抖动干扰最小。 */
function timeOf(fn: () => void, repeats = 7): number {
  let best = Infinity;
  for (let i = 0; i < repeats; i++) best = Math.min(best, timeOnce(fn));
  return best;
}

/**
 * 增长率门禁的规模倍数。
 *
 * ★原先只把输入**翻倍**：线性 ≈2×、二次 ≈4×，门槛 3× 夹在中间，两侧各只有
 * 1.5 倍的缝。共享 runner 的一次调度突发就能跨过这条缝——2026-10-10 发布
 * 1.0.31 时自检用例就这样误红过（已知二次算法没被判出来）。
 *
 * ×8 后线性 ≈8×、二次 ≈64×，两带之间拉开 8 倍；判据改用**增长指数**
 * （log 比值 / log 倍数：线性=1，二次=2），门槛取中点 1.5，即比值 <8^1.5≈22.6，
 * 两侧都有约 2.8 倍余量。
 */
const SCALE = 8;
const EXPONENT_LIMIT = 1.5;
const ROUNDS = 11;

/**
 * 断言 `fn` 对长度 n 的输入呈**次二次**增长。
 *
 * ★量法：两种规模**各自**预热，再**交替**测量，各取最小值。
 * - 只预热一次不够：JIT 可能在小规模测量期间才升到最优层级，
 *   小规模被测成「慢的那一层」，比值被系统性压低。
 * - 调度、GC 噪声只会让一次测量变慢、不会变快，所以最小值最接近真实计算量；
 *   交替测量让噪声突发两组均摊。满载实测最小值比中位数更稳。
 * - 本地满载（10 个忙循环 + 并行跑另一仓全量测试）30 轮：
 *   SourceIR 指数 ≤1.24，自检（已知二次）≥1.99，门槛 1.5 两侧都有余量。
 */
function assertSubQuadratic(
  label: string,
  build: (n: number) => string,
  fn: (s: string) => unknown,
  base: number,
): void {
  const small = build(base);
  const large = build(base * SCALE);

  for (let i = 0; i < 3; i++) { fn(small); fn(large); }

  let tSmall = Infinity;
  let tLarge = Infinity;
  for (let i = 0; i < ROUNDS; i++) {
    tSmall = Math.min(tSmall, timeOnce(() => { fn(small); }));
    tLarge = Math.min(tLarge, timeOnce(() => { fn(large); }));
  }

  // ★耗时过短时比值噪声极大（0.1ms vs 0.2ms 的比值毫无意义）。
  //
  //   ★这里原本写的是 `if (tLarge < 1.0) assert.ok(tLarge < 50)` ——
  //   **那是一个恒真断言**：进入分支的前提就是 `tLarge < 1.0`，而 1.0 < 50。
  //   我在注释里写「两条路径都真的断言了东西」，**那句话是错的**。
  //   独立审查者实测：6 个用例里有 5 个**恒走**这条分支，比值断言从不执行。
  //
  //   修法：早退分支改用**紧贴噪声地板**的绝对上界（而非写死的 50ms）。
  //   这样「把耗时从 0.1ms 推到 0.9ms」这类中间地带的回归也会被抓到，
  //   而不是留下 82×〜8621× 的余量。
  const NOISE_FLOOR_MS = 1.0;
  if (tLarge < NOISE_FLOOR_MS) {
    assert.ok(tLarge < NOISE_FLOOR_MS,
      `${label}：耗时 ${tLarge.toFixed(3)}ms —— 应 <${NOISE_FLOOR_MS}ms。`);
    return;
  }

  const ratio = tLarge / Math.max(tSmall, 0.001);
  const exponent = Math.log(ratio) / Math.log(SCALE);
  assert.ok(exponent < EXPONENT_LIMIT,
    `${label}：输入 ${base}→${base * SCALE}（×${SCALE}）耗时最小值 ${tSmall.toFixed(2)}ms→`
    + `${tLarge.toFixed(2)}ms，增长 ${ratio.toFixed(1)}×、指数 ${exponent.toFixed(2)} —— 应 <${EXPONENT_LIMIT}。\n`
    + '★指数接近 2 意味着**二次回溯**：某条正则在每个起始位置都重新贪婪扫描再回退。\n'
    + '  人类文档是攻击者可控输入，一份构造过的文档就能钉死抽取线程。');
}

/**
 * 绝对预算判据——★用于「修复态极快、缺陷态极慢」的场景。
 *
 * <h2>为什么这三条不用增长率</h2>
 *
 * 增长率在这里有个**无解的两难**（2026-09-13 在 main 的 CI 上实证）：
 *
 * - base 小 → `large` 落在 0.1〜2ms 的**噪声地板**，测的是调度器不是代码。
 *   CI 实测把 0.49ms→1.77ms 判成 3.6× 而变红，而同一份代码本机
 *   7 次取最小是干净的 2.01×。
 * - base 大 → 脱离噪声了，但**缺陷态会跑到几百秒**（无锚模式 ×4 增长，
 *   base=400000 时约 1028s/次）——门禁不是变红，而是**挂死**。
 *   一个挂死的门禁比 flaky 的更糟：它连"哪里错了"都报不出来。
 *
 * <p>绝对预算同时解决两头：只需**一次**测量（不比值 ⇒ 不放大噪声），
 * 且在缺陷态能**很快**超预算并报错。
 *
 * <p>实测 n=80000：修复态 ~2.5ms，缺陷态（撤掉左锚）约 10s ——
 * **差 2500 倍**。取 500ms：修复态 125× 余量、缺陷态超 20 倍必红。
 */
function assertWithinBudget(label: string, input: string,
                            fn: (s: string) => unknown, budgetMs = 500): void {
  const ms = timeOf(() => { fn(input); });
  assert.ok(ms < budgetMs,
    `${label}：${input.length} 长度输入耗时 ${ms.toFixed(1)}ms —— 应 <${budgetMs}ms。\n`
    + '★修复态实测 ~2.5ms，缺陷态（撤掉 `(?<![\\d.])` 左锚）同规模约 10s（2500×）。\n'
    + '  超预算说明 ReDoS 左锚被去掉了，长数字串上的全量回退回来了。');
}

/** 自检参照算法的结果落点：可观察的副作用，阻止 V8 把双重循环当死代码消除。 */
let selfCheckSink = 0;

describe('ReDoS 时间预算门禁 — 量增长率而非绝对耗时', () => {
  it('★QuantityIR：长数字串上呈次二次增长', () => {
    // ★改用绝对预算：见 assertWithinBudget 的注释（增长率在此有无解的两难）。
    assertWithinBudget('extractQuantities / 纯数字串',
      '$' + '1'.repeat(80000), s => extractQuantities(s));
  });

  it('★QuantityIR：数字与小数点混排（最坏形态）也呈次二次增长', () => {
    // ★比纯数字更毒：小数点让 `(?:\.\d+)?` 这个可选组也参与回溯。
    assertWithinBudget('extractQuantities / 数字+小数点',
      '1.'.repeat(40000), s => extractQuantities(s));
  });

  it('★QuantityIR：贴着单位的长数字串（回溯最容易被触发的形态）', () => {
    // 末尾放一个**能匹配上**的单位，让正则引擎有理由一路试下去。
    // ★这条正是 2026-09-13 在 main 的 CI 上以 0.49ms→1.77ms 判 3.6× 变红的那条。
    assertWithinBudget('extractQuantities / 长数字+单位',
      '1'.repeat(80000) + '%', s => extractQuantities(s));
  });

  it('★SourceIR：长文档解析呈次二次增长', () => {
    // SourceIR 同样吃人类文档，同样是攻击面。
    assertSubQuadratic(
      'parseSourceIr / 多级标题文档',
      n => Array.from({ length: n }, (_, i) => `${'#'.repeat((i % 6) + 1)} 标题 ${i}\n正文 ${i}`).join('\n'),
      s => parseSourceIr(s),
      // ★base 从 2000 提到 20000：原先 large 仅 1.36ms，在噪声地板附近判增长率
      //   纯属测量噪声（实测 8 次里红 1 次，0.34ms→1.36ms 报 4.0×）。
      //   提高规模让 large 稳定超过 10ms，比值才有意义。
      //   ★20000 仍不够（3.22ms→10.02ms 曾报 3.1×），再提到 40000。
      //   ★规模倍数改为 ×8 后回到 20000（large=160000 行）：40000×8 时堆压力
      //     让修复态指数在满载下升到 1.5 附近，20000 则稳定在 ≤1.24。
      20000,
    );
  });

  it('★SourceIR：长单行（无换行）不得触发回溯', () => {
    assertWithinBudget('parseSourceIr / 超长单行',
      '#'.repeat(80000) + ' 标题', s => parseSourceIr(s));
  });

  it('★SourceIR：**匹配失败**形态（无标题）—— 指数型回溯只活在这里', () => {
    // ★这条补的是上一条的结构性盲区，由独立审查者发现。
    //
    //   上一条的载荷是 `'#'.repeat(n) + ' 标题'`——尾部的「 标题」让
    //   `/^(#{1,6})\s+\S/` **立刻匹配成功**，引擎根本不回溯。
    //   **ReDoS 活在「匹配失败」的形态里。**
    //
    //   实证（把 `#{1,6}` 换成嵌套量词 `(#+)+` 这种典型回归）：
    //     有标题（成功）：16→0ms  20→0ms  24→0ms  28→0ms      ← 完全看不见
    //     无标题（失败）：16→0.2ms 20→3.7ms 24→59ms 28→938ms  ← 指数
    //
    //   即：上一条门禁**抓不到**把模式改成嵌套量词的回归，而那是 28 个字符
    //   就能打死一个线程的指数级漏洞。
    //
    // ★另一个盲区：**尺度**。指数型在 n=20000 时不是「慢」而是「永不返回」，
    //   用 base=20000 反而测不到。故这里用**小 n 的绝对上界**。
    const probe = (n: number): number => {
      const s = '#'.repeat(n);
      parseSourceIr(s);
      const t = process.hrtime.bigint();
      parseSourceIr(s);
      return Number(process.hrtime.bigint() - t) / 1e6;
    };

    for (const n of [16, 20, 24, 28, 32]) {
      const ms = probe(n);
      assert.ok(ms < 20,
        `parseSourceIr('#'.repeat(${n}))（**无标题**，匹配失败形态）耗时 ${ms.toFixed(1)}ms —— 应 <20ms。\n`
        + '★这么小的输入却这么慢 = **指数级**回溯，典型成因是标题模式里出现了\n'
        + '  嵌套量词（如 `(#+)+`）。注意：同样的缺陷在「有标题」的载荷上完全看不见。');
    }
  });

  it('★门禁自身可变红 —— 用已知二次算法验证量具连着被测对象', () => {
    // ★本仓反复记录的教训：「门禁在结构上无法变红」是最危险的假绿。
    //   这条把一个**已知二次**的函数喂给同一套判定逻辑，若判定通过，
    //   说明 assertSubQuadratic 根本测不出二次增长——量具没连上。
    //
    // ★参照算法必须让 V8 **无法化简**：原先的 `acc += 1` 每次迭代极廉价
    //   （1.0.31 发布时 CI 上整条自检只跑了 154ms 就误红），小规模一侧贴着噪声，
    //   且结果被丢弃、可被优化的余地无从排除。现改为逐字符混合哈希（无闭式解），
    //   结果写进模块级 sink（可观察副作用）。
    const quadratic = (s: string): void => {
      let acc = 0;
      for (let i = 0; i < s.length; i++) {
        for (let j = 0; j < s.length; j++) acc = (Math.imul(acc, 31) + (s.charCodeAt(j) ^ i)) | 0;
      }
      selfCheckSink = acc;
    };

    assert.throws(
      () => { assertSubQuadratic('自检', n => 'x'.repeat(n), quadratic, 1000); },
      /指数 .* —— 应 </,
      '已知二次算法未被判定为超线性 —— assertSubQuadratic 失效，本文件所有门禁都是假绿。');
  });
});
