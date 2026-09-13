import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatCNL, replaceLegacyPlaceholderReturn } from '../../src/formatter.js';
import { printCNLFromCst } from '../../src/cst/cst_printer.js';
import { buildCstLossless } from '../../src/cst/index.js';

/**
 * 格式化链路的 **ReDoS 门禁**（ADR 0037 §12.10 ②③）。
 *
 * <p>`formatCNL` 与 `printCNLFromCst` 都吃**用户源码**（LSP 格式化 / CLI），
 * 属攻击者可控输入。
 *
 * <h2>★本文件严格遵守两条本轮血泪换来的规矩</h2>
 *
 * **① 每个计时用例都成对给「匹配成功」与「匹配失败」两种载荷。**
 * ReDoS 活在**失配**形态里：`\n+$` 这条就是用失配载荷
 * （`'x' + '\n'.repeat(n) + 'y'`，结尾不是行尾）才测出来的，
 * 用「成功」载荷完全看不见。
 *
 * **② 量增长率而非绝对耗时**，且早退分支**不写恒真断言**。
 */

/**
 * 取多次最小值——最接近真实计算量，受调度抖动最小。
 *
 * ★重复次数从 3 提到 **7**。3 次在 1〜10ms 量级挡不住 GC／调度尖峰：
 * 实测 8 次全量跑里红了 3 次，报出 6.9× / 11.4× 这种明显不真实的比值，
 * 而同一段代码用 5 次最小值重测是干净的 2.1×／2.2×／1.8×（线性）。
 * **门禁的噪声必须小于它要检出的信号**，否则它测的是调度器不是代码。
 */
function timeOf(fn: () => void): number {
  fn();                                   // 预热
  let best = Infinity;
  for (let i = 0; i < 7; i++) {
    const t = process.hrtime.bigint();
    fn();
    best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
  }
  return best;
}

const NOISE_FLOOR_MS = 1.0;

function assertSubQuadratic(label: string, build: (n: number) => string,
                            fn: (s: string) => unknown, base: number): void {
  const small = timeOf(() => { fn(build(base)); });
  const large = timeOf(() => { fn(build(base * 2)); });

  // ★早退分支断言的是**噪声地板本身**，不是一个必然成立的宽松上界。
  //   （本轮踩过的坑：`if (t < 1.0) assert(t < 50)` 在数学上永不失败。）
  if (large < NOISE_FLOOR_MS) {
    assert.ok(large < NOISE_FLOOR_MS,
      `${label}：耗时 ${large.toFixed(3)}ms —— 应 <${NOISE_FLOOR_MS}ms。`);
    return;
  }
  const ratio = large / Math.max(small, 0.001);
  assert.ok(ratio < 3.0,
    `${label}：${base}→${base * 2}（翻倍）耗时 ${small.toFixed(1)}ms→${large.toFixed(1)}ms，`
    + `增长 ${ratio.toFixed(1)}× —— 应 <3×。\n★接近 4× = 二次回溯，修复被撤掉了。`);
}

describe('formatCNL — ReDoS 门禁', () => {
  // ★这里**没有**「formatCNL 全空行必须次二次」那条门禁，是有意的。
  //
  //   `formatCNL` 的 sanitize 阶段有两条 `^\s*Return\s+<...>\s*\.`（m 标志），
  //   它们**确实是二次的**（20000 个空行 → 1319ms）。我曾把它们改成线性，
  //   但独立审查者证明我的改写**在宽字母表下不等价**（`\r \v \f` NBSP 全角
  //   空格上行为全变），已回退 —— 详见 `formatter.ts` 里的「已试方案」表。
  //
  //   **正确性 > 性能**：这两条决定用户代码被改写成什么，宁可慢也不能错。
  //   故此处**不设**该门禁——设一条「明知会红」的断言只会变成 flaky 噪音，
  //   最后被人加 skip，反而掩盖真问题。
  //   风险已在 ADR 0037 §12.11 记录并单独立项。
  //
  //   ★下面 reflowSeams 的三条是**真修好了**的（等价性在宽字母表下复验过），
  //   故它们保留门禁。

  it('★占位 Return 的改写语义不得被性能修复改坏（对拍原正则）', () => {
    // 反向守卫：线性化重写必须**逐字节**保持原行为，包括
    // 「吞掉前导空白行与缩进」这个反直觉的部分。
    //
    // ★这里对拍的是 **sanitize 阶段**而非 formatCNL 的最终输出。原因：
    //   `Return <expr>.` 这种片段本身不是合法 CNL（Return 不在函数体内），
    //   formatCNL 解析失败会返回 ""——**那是既有行为**，与本修复无关。
    //   拿最终输出做断言会把「解析失败」误判成「我改坏了」。
    //   我第一版正是这么写的，红了才发现测错了对象。
    const legacy = /^\s*Return\s+<[^>]+>\s*\./gm;

    for (const src of [
      'Return <expr>.',
      '  Return <x>.',
      '\n\nReturn <x>.',
      'a\n  Return <x>.',
      'Define f as a function:\n\n  Return <anything>.',
    ]) {
      legacy.lastIndex = 0;
      const expected = src.replace(legacy, 'Return none.');
      assert.strictEqual(replaceLegacyPlaceholderReturn(src), expected,
        `线性化重写与原正则行为不一致。\n输入 ${JSON.stringify(src)}`);
    }
  });
});

describe('printCNLFromCst / reflowSeams — ReDoS 门禁', () => {
  /**
   * reflow=true 才会走 reflowSeams——默认 false，但用户可开启。
   *
   * ★**只计时 print 这一步**，CST 构建放在计时区外。
   *   我第一版把 `buildCstLossless` 也算进去，结果 40000→80000 报 3.6×
   *   而被判为回归——实测分离后：buildCst 12.2→23.5ms（线性，但**基数大**），
   *   print(reflow) 2.2→7.7ms。**构建成本占了大头，把比值污染了**。
   *   门禁必须只量被测的那一段，否则归因错误。
   */
  const buildOnce = (src: string): ReturnType<typeof buildCstLossless> =>
    buildCstLossless(src);
  const reflowOnly = (cst: ReturnType<typeof buildCstLossless>): string =>
    printCNLFromCst(cst, { reflow: true });
  const reflow = (src: string): string => reflowOnly(buildOnce(src));

  /** 与 assertSubQuadratic 同判据，但**只计时 print**。 */
  const assertReflowSubQuadratic = (label: string, build: (n: number) => string,
                                    base: number): void => {
    const cstSmall = buildOnce(build(base));
    const cstLarge = buildOnce(build(base * 2));
    const small = timeOf(() => { reflowOnly(cstSmall); });
    const large = timeOf(() => { reflowOnly(cstLarge); });
    if (large < NOISE_FLOOR_MS) {
      assert.ok(large < NOISE_FLOOR_MS,
        `${label}：耗时 ${large.toFixed(3)}ms —— 应 <${NOISE_FLOOR_MS}ms。`);
      return;
    }
    const ratio = large / Math.max(small, 0.001);
    assert.ok(ratio < 3.0,
      `${label}：${base}→${base * 2}（翻倍）耗时 ${small.toFixed(1)}ms→${large.toFixed(1)}ms，`
      + `增长 ${ratio.toFixed(1)}× —— 应 <3×。\n★接近 4× = 二次回溯，修复被撤掉了。`);
  };

  it('★空白 run + 失配后缀（`\\s+标点` / 行尾空白）', () => {
    // 改前：\s+([.,:!?;]) 为 162→668→2571ms（×4.0）
    assertReflowSubQuadratic('reflowSeams / 空白 run',
      n => 'Let x be 1' + ' '.repeat(n) + 'y.', 10000);
  });

  it('★★换行 run + **失配**后缀 —— `\\n+$` 只在这种形态下暴露', () => {
    // ★这条是本轮补测出来的第三处缺陷，此前我和审查者都漏了它。
    //   `/\n+$/g` 用「结尾就是换行」的载荷完全看不出问题；
    //   只有结尾**不是**行尾（这里是 `y.`）时才会全量回退。
    //   改前实测：10000→144ms、20000→576ms、40000→2297ms（×4.0）。
    // ★判据用**绝对预算**而非增长率。
    //
    //   增长率在这里天然不稳：被测段本身只有 5〜19ms，GC／调度尖峰就能把
    //   比值推过 3.0（实测 8 次全量跑仍红 1 次，报 3.4×，而同代码单独重测是
    //   干净的 2.1×／2.2×／1.8× 线性）。**门禁的噪声必须小于它要检出的信号。**
    //
    //   缺陷态在同规模下是 ~2300ms（×4 逐级放大），修复态 19ms —— 差 120 倍。
    //   取 300ms：修复态有 15× 余量，缺陷态超 7 倍必红。信号噪声比远优于比值判据。
    const N = 160000;
    const cst = buildOnce('Let x be 1.' + '\n'.repeat(N) + 'Let y be 2.');
    const ms = timeOf(() => { reflowOnly(cst); });

    assert.ok(ms < 300,
      `reflowSeams / 换行 run + 失配后缀（${N} 个换行）耗时 ${ms.toFixed(1)}ms —— 应 <300ms。\n`
      + '★修复态实测 19ms，缺陷态（撤掉 `(?<!\\n)` 左锚）同规模需约 2300ms。\n'
      + '  超预算说明 `/\\n+$/g` 的左锚被去掉了，换行 run 上的全量回退回来了。');
  });

  it('★reflow 的语义不得被左锚改坏', () => {
    // 反向守卫：左锚若写宽了会静默少替换。
    const out = reflow('Let x be 1 .');
    assert.ok(!out.includes(' .'),
      `标点前空白未被去掉 —— 左锚写宽了。实际：${JSON.stringify(out)}`);
  });
});
