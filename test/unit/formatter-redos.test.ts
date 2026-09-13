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

/** 取 3 次最小值——最接近真实计算量，受调度抖动最小。 */
function timeOf(fn: () => void): number {
  fn();                                   // 预热
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
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
  it('★全空行源文件不得触发二次增长（真实攻击载荷）', () => {
    // 改前实测：5000→85ms、10000→326ms、20000→1319ms（×3.8〜4.0）。
    // 成因是 `^\s*Return\s+<...>\s*\.` 在 m 标志下于**每个**行首起跑。
    assertSubQuadratic('formatCNL / 全空行',
      n => 'Let x be 1' + '\n'.repeat(n) + '.',
      s => formatCNL(s), 10000);
  });

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
  /** reflow=true 才会走 reflowSeams——默认 false，但用户可开启。 */
  const reflow = (src: string): string => {
    const cst = buildCstLossless(src);
    return printCNLFromCst(cst, { reflow: true });
  };

  it('★空白 run + 失配后缀（`\\s+标点` / 行尾空白）', () => {
    // 改前：\s+([.,:!?;]) 为 162→668→2571ms（×4.0）
    assertSubQuadratic('reflowSeams / 空白 run',
      n => 'Let x be 1' + ' '.repeat(n) + 'y.',
      s => reflow(s), 10000);
  });

  it('★★换行 run + **失配**后缀 —— `\\n+$` 只在这种形态下暴露', () => {
    // ★这条是本轮补测出来的第三处缺陷，此前我和审查者都漏了它。
    //   `/\n+$/g` 用「结尾就是换行」的载荷完全看不出问题；
    //   只有结尾**不是**行尾（这里是 `y.`）时才会全量回退。
    //   改前实测：10000→144ms、20000→576ms、40000→2297ms（×4.0）。
    assertSubQuadratic('reflowSeams / 换行 run + 失配后缀',
      n => 'Let x be 1.' + '\n'.repeat(n) + 'Let y be 2.',
      s => reflow(s), 10000);
  });

  it('★reflow 的语义不得被左锚改坏', () => {
    // 反向守卫：左锚若写宽了会静默少替换。
    const out = reflow('Let x be 1 .');
    assert.ok(!out.includes(' .'),
      `标点前空白未被去掉 —— 左锚写宽了。实际：${JSON.stringify(out)}`);
  });
});
