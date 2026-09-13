import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


import { formatCNL, replaceLineAnchoredPlaceholderForTest } from '../../src/formatter.js';
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

describe('formatCNL — 占位符短路守卫', () => {
  it('★无 `<` 的源码不得走进二次 sanitize（常见路径已线性）', () => {
    // 两条 legacy 占位符模式都**必须**匹配到 `<`，故无 `<` 时必然零匹配，
    // 可整体跳过。这是**可证明**的等价，不依赖语料。
    // 改前端到端 20000 个空行需 1319ms；加守卫后 ~18ms。
    const N = 20000;
    const src = 'Let x be 1' + '\n'.repeat(N) + '.';
    const ms = timeOf(() => { formatCNL(src); });

    assert.ok(ms < 300,
      `无 \`<\` 的全空行源码（${N} 行）耗时 ${ms.toFixed(0)}ms —— 应 <300ms。\n`
      + '★超预算说明 `hasPlaceholder` 短路守卫被去掉了，'
      + '两条 `^\\s*Return\\s+<...>` 的二次回溯回来了。');
  });

  it('★★含 `<` 的攻击载荷也必须线性（短路守卫绕过后的真实攻击面）', () => {
    // ★这条是**真正的漏洞门禁**。此前两条占位符模式是二次的，
    //   载荷里放一个 `<` 就绕过短路守卫：n=40000 实测 5143ms（×4.0）。
    //   改用 `replaceLineAnchoredPlaceholder` 线性实现后 → 23.4ms。
    //
    //   ★只测「无 `<`」的路径是不够的——那正是短路守卫覆盖的那一半，
    //   攻击者当然会绕开它。门禁必须打**绕过后**的那条路。
    const N = 20000;
    const src = 'Let x be 1<' + '\n'.repeat(N) + '.';
    const ms = timeOf(() => { formatCNL(src); });

    assert.ok(ms < 300,
      `含 \`<\` 的全空行载荷（${N} 行）耗时 ${ms.toFixed(0)}ms —— 应 <300ms。\n`
      + '★超预算说明两条占位符模式退回了 `^\\s*Return...` 的二次正则写法。\n'
      + '  修法：用 replaceLineAnchoredPlaceholder（不含前导 \\s* 的 core + 代码层左扫行首）。');
  });

  it('★线性实现必须与原正则逐字节等价（宽字母表对拍）', () => {
    // ★等价性是这次改动的**全部风险**所在——前七次改法都是栽在这里。
    //   字母表必须含 `\r \v \f` NBSP 全角空格 U+2028 U+2029，
    //   否则「零分歧」只是在量语料（本仓已记过这个教训）。
    const R1 = /^\s*Return\s+<expr>\s*\./gm;
    const R2 = /^\s*Return\s+<[^>]+>\s*\./gm;
    const VT = String.fromCharCode(0x0b), FF = String.fromCharCode(0x0c);
    const NBSP = String.fromCharCode(0xa0), FW = String.fromCharCode(0x3000);
    const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);

    const pool = ['Return <expr>.', '  Return <x>.', '\n', '\r', VT, FF, ' ',
      FW, NBSP, LS, PS, 'a', '.', '\n\n', '\tReturn <abc>.', '<', '>'];
    let seed = 7919;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    let replaced = 0;
    for (let i = 0; i < 20000; i++) {
      let src = '';
      const n = 1 + Math.floor(rnd() * 10);
      for (let j = 0; j < n; j++) src += pool[Math.floor(rnd() * pool.length)]!;

      R1.lastIndex = 0; R2.lastIndex = 0;
      const expected = src
        .replace(R1, m => m.replace('<expr>', 'none'))
        .replace(R2, 'Return none.');
      const actual = replaceLineAnchoredPlaceholderForTest(src);
      if (expected !== src) replaced++;
      assert.strictEqual(actual, expected,
        `线性实现与原正则不一致。输入 ${JSON.stringify(src)}`);
    }
    // ★反向守卫：样本必须真的产生过替换，否则上面的相等断言全空洞。
    assert.ok(replaced > 2000,
      `只有 ${replaced}/20000 组发生替换 —— 样本判别力不足。`);
  });

  it('★短路守卫不得改变语义（含/不含 `<` 都要与无守卫一致）', () => {
    // 反向守卫：守卫若判错（例如把含 `<` 的也跳过），占位符就不会被改写。
    // 此处直接对拍「无守卫」的原始链路。
    const sanitizeNoGuard = (t: string): string =>
      t.replace(/produce([^\n]*?)\.\s*:/g, (_m, p1) => `produce${p1}:`)
        .replace(/^\s*Return\s+<expr>\s*\./gm, m => m.replace(/<expr>/, 'none'))
        .replace(/<expr>\s*\./g, 'none.')
        .replace(/\.{2,}/g, '.')
        .replace(/^\s*Return\s+<[^>]+>\s*\./gm, 'Return none.');
    // ★守卫只包住**依赖 `<` 的那两步**；`produce…:` 与 `.{2,}→.` 无条件执行。
    //   我第一版把整条链都短路了，被下面的 `"produce a. : b"` / `"a..b"` 抓到。
    const sanitizeGuarded = (t: string): string => {
      const base = t.replace(/produce([^\n]*?)\.\s*:/g, (_m, p1) => `produce${p1}:`)
        .replace(/\.{2,}/g, '.');
      if (!t.includes('<')) return base;
      return base
        .replace(/^\s*Return\s+<expr>\s*\./gm, m => m.replace(/<expr>/, 'none'))
        .replace(/<expr>\s*\./g, 'none.')
        .replace(/^\s*Return\s+<[^>]+>\s*\./gm, 'Return none.');
    };

    for (const src of [
      'Let x be 1.', 'Return <expr>.', '  Return <x>.', '\n\nReturn <x>.',
      'a\n  Return <x>.', 'no placeholder here', 'x < y', 'produce a. : b',
    ]) {
      assert.strictEqual(sanitizeGuarded(src), sanitizeNoGuard(src),
        `短路守卫改变了语义。输入 ${JSON.stringify(src)}`);
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
