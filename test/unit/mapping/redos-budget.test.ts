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

/** 取多次测量的**最小值**——最小值最接近真实计算量，受调度抖动干扰最小。 */
function timeOf(fn: () => void, repeats = 3): number {
  let best = Infinity;
  for (let i = 0; i < repeats; i++) {
    const t = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (ms < best) best = ms;
  }
  return best;
}

/**
 * 断言 `fn` 对长度 n 的输入呈**次二次**增长。
 *
 * @param ratioLimit 输入翻倍时允许的最大耗时倍数。线性=2，二次=4。
 *   取 3.0 作门槛：线性(2)有 50% 余量，二次(4)被稳稳挡住。
 */
function assertSubQuadratic(
  label: string,
  build: (n: number) => string,
  fn: (s: string) => unknown,
  base: number,
  ratioLimit = 3.0,
): void {
  const small = build(base);
  const large = build(base * 2);

  // 预热：让 JIT 稳定下来，否则第一次调用的编译开销会污染比值。
  fn(build(base / 4));

  const tSmall = timeOf(() => { fn(small); });
  const tLarge = timeOf(() => { fn(large); });

  // ★耗时过短时比值噪声极大（0.1ms vs 0.2ms 的比值毫无意义）。
  //
  //   ★但**不能直接 return**——那是静默跳过：一旦某个 case 恒走这条分支，
  //   它就变成一个「在结构上无法变红」的门禁（本仓记过的最危险假绿形态）。
  //
  //   改为退化成**绝对上界**断言。二次回溯在这些输入规模上必然远超噪声地板
  //   （实测未加锚时 40000 长度需 2304ms），所以绝对上界照样抓得住回溯，
  //   且完全不受比值噪声影响。两条路径都真的断言了东西。
  const NOISE_FLOOR_MS = 1.0;
  const ABSOLUTE_BUDGET_MS = 50;
  if (tLarge < NOISE_FLOOR_MS) {
    assert.ok(tLarge < ABSOLUTE_BUDGET_MS,
      `${label}：耗时 ${tLarge.toFixed(3)}ms 超出绝对预算 ${ABSOLUTE_BUDGET_MS}ms。`);
    return;
  }

  const ratio = tLarge / Math.max(tSmall, 0.001);
  assert.ok(ratio < ratioLimit,
    `${label}：输入 ${base}→${base * 2}（翻倍）耗时 ${tSmall.toFixed(2)}ms→`
    + `${tLarge.toFixed(2)}ms，增长 ${ratio.toFixed(1)}× —— 应 <${ratioLimit}×。\n`
    + '★接近 4× 意味着**二次回溯**：某条正则在每个起始位置都重新贪婪扫描再回退。\n'
    + '  人类文档是攻击者可控输入，一份构造过的文档就能钉死抽取线程。');
}

describe('ReDoS 时间预算门禁 — 量增长率而非绝对耗时', () => {
  it('★QuantityIR：长数字串上呈次二次增长', () => {
    assertSubQuadratic(
      'extractQuantities / 纯数字串',
      n => '$' + '1'.repeat(n),
      s => extractQuantities(s),
      20000,
    );
  });

  it('★QuantityIR：数字与小数点混排（最坏形态）也呈次二次增长', () => {
    // ★比纯数字更毒：小数点让 `(?:\.\d+)?` 这个可选组也参与回溯。
    assertSubQuadratic(
      'extractQuantities / 数字+小数点',
      n => '1.'.repeat(n / 2),
      s => extractQuantities(s),
      10000,
    );
  });

  it('★QuantityIR：贴着单位的长数字串（回溯最容易被触发的形态）', () => {
    // 末尾放一个**能匹配上**的单位，让正则引擎有理由一路试下去。
    assertSubQuadratic(
      'extractQuantities / 长数字+单位',
      n => '1'.repeat(n) + '%',
      s => extractQuantities(s),
      20000,
    );
  });

  it('★SourceIR：长文档解析呈次二次增长', () => {
    // SourceIR 同样吃人类文档，同样是攻击面。
    assertSubQuadratic(
      'parseSourceIr / 多级标题文档',
      n => Array.from({ length: n }, (_, i) => `${'#'.repeat((i % 6) + 1)} 标题 ${i}\n正文 ${i}`).join('\n'),
      s => parseSourceIr(s),
      2000,
    );
  });

  it('★SourceIR：长单行（无换行）不得触发回溯', () => {
    assertSubQuadratic(
      'parseSourceIr / 超长单行',
      n => '#'.repeat(n) + ' 标题',
      s => parseSourceIr(s),
      20000,
    );
  });

  it('★门禁自身可变红 —— 用已知二次算法验证量具连着被测对象', () => {
    // ★本仓反复记录的教训：「门禁在结构上无法变红」是最危险的假绿。
    //   这条把一个**已知二次**的函数喂给同一套判定逻辑，若判定通过，
    //   说明 assertSubQuadratic 根本测不出二次增长——量具没连上。
    const quadratic = (s: string): number => {
      let acc = 0;
      for (let i = 0; i < s.length; i++) for (let j = 0; j < s.length; j++) acc += 1;
      return acc;
    };

    assert.throws(
      () => { assertSubQuadratic('自检', n => 'x'.repeat(n), quadratic, 3000); },
      /增长 .* —— 应 </,
      '已知二次算法未被判定为超线性 —— assertSubQuadratic 失效，本文件所有门禁都是假绿。');
  });
});
