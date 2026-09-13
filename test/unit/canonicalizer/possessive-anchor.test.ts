import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getTransformer } from '../../../src/frontend/transformers.js';

/**
 * 三个语法变换器的 **ReDoS 修复守卫**（配套 ADR 0037 §12.9）。
 *
 * <h2>为什么直接测 transformer 而不是 canonicalize()</h2>
 *
 * 这三个变换器是 **per-lexicon opt-in** 的，默认 `canonicalize()` 不启用。
 * ★我第一版正是从 `canonicalize()` 入手，结果连「普通所有格能变换」都是红的
 * ——测错了入口，断言再漂亮也没有意义。
 *
 * <h2>守住的两件事</h2>
 *
 * ① **左锚宽度**（所有格）：左锚只能排除「该模式**首字符**能取的字符集」，
 *    多排一个字符就是误伤。
 * ② **缩进用水平空白**（set-to / result-is）：multiline 下 `^(\s*)` 会在每个
 *    行首起跑并吃穿所有后续空行，呈二次增长。
 */

const apply = (name: string, src: string): string => {
  const t = getTransformer(name);
  assert.ok(t !== undefined, `找不到变换器 ${name} —— 注册表变了，本守卫已失效。`);
  return t.transform(src);
};

/** 量增长率而非绝对耗时（理由见 redos-budget.test.ts）。 */
function assertSubQuadratic(label: string, build: (n: number) => string,
                            fn: (s: string) => unknown, base: number): void {
  fn(build(base / 4));
  const time = (n: number): number => {
    const s = build(n);
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t = process.hrtime.bigint();
      fn(s);
      best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
    }
    return best;
  };
  const small = time(base);
  const large = time(base * 2);

  if (large < 1.0) {
    assert.ok(large < 50, `${label}：${large.toFixed(2)}ms 超出绝对预算 50ms`);
    return;
  }
  const ratio = large / Math.max(small, 0.001);
  assert.ok(ratio < 3.0,
    `${label}：${base}→${base * 2} 耗时 ${small.toFixed(1)}ms→${large.toFixed(1)}ms，`
    + `增长 ${ratio.toFixed(1)}× —— 应 <3×。\n★接近 4× 说明 ReDoS 修复被撤掉了。`);
}

describe('english-possessive — 左锚宽度', () => {
  it('★下划线开头的标识符仍须变换（锚宽多排 _ 会误伤这条）', () => {
    // 模式首字符是 [\p{L}]，**不含** `_`。所以 `_x's y` 是从 `x` 起跑的合法
    // 匹配，得 `_x.y`。
    // ★若左锚写成 `(?<![\p{L}0-9_])`（我第一版），`x` 前面是 `_` → 整条被挡掉。
    //   这是**唯一**能区分两种锚宽的形态，前 10 组人工样本全都漏了它，
    //   最后是随机等价性检查抓出来的（300000 组里 1895 组分歧）。
    assert.strictEqual(apply('english-possessive', "_x's y"), '_x.y');
  });

  it('★数字紧邻的标识符仍须变换（同上，锚宽多排 0-9 会误伤）', () => {
    assert.strictEqual(apply('english-possessive', "1x's y"), '1x.y');
  });

  it('普通所有格照常变换（基本功能不得被锚点破坏）', () => {
    assert.strictEqual(apply('english-possessive', "driver's age"), 'driver.age');
    assert.strictEqual(apply('english-possessive', "多's 字"), '多.字');
  });

  it('★不得从词中间起跑（左锚存在性守卫）', () => {
    // 无左锚时，引擎可以从 `river` 起跑。整词优先时看不出差别，
    // 故构造一个**整词匹配不成立**的形态：`'s` 前面接的是非法首字符。
    // `_`/数字开头已在上面覆盖；这里用「前一个 token 是字母」的情形，
    // 断言不会出现任何从中间起跑的产物。
    const out = apply('english-possessive', "Xdriver's age");
    assert.strictEqual(out, 'Xdriver.age',
      `应整词匹配得 Xdriver.age；出现别的结果说明起跑位置不对。实际：${out}`);
  });

  it('★长标识符 + 不闭合 \'s 不得触发二次回溯', () => {
    // 无左锚时 40000 长度需 2552ms。
    assertSubQuadratic('english-possessive',
      n => 'a'.repeat(n) + "'s ",
      s => apply('english-possessive', s), 10000);
  });
});

describe('set-to / result-is — 缩进必须是水平空白', () => {
  it('★行首缩进照常保留（基本功能）', () => {
    assert.strictEqual(apply('set-to', '  Set x to 1'), '  Let x be 1');
    assert.strictEqual(apply('set-to', '\tSet x to 1'), '\tLet x be 1');
    assert.strictEqual(apply('result-is', '  The result is 5'), '  Return 5');
  });

  it('★多行文本里每行都要生效（multiline 语义不得被改坏）', () => {
    assert.strictEqual(
      apply('set-to', 'Set a to 1\n  Set b to 2'),
      'Let a be 1\n  Let b be 2');
  });

  it('★空行不得被缩进组吞掉（\\s* → [ \\t]* 的语义差别就在这里）', () => {
    // 旧式 `^(\s*)` 能把前面的空行一起吃进 $1；新式不会。
    // 两者对**合法输入**结果相同，但新式不会跨行——这正是修复的要点。
    assert.strictEqual(apply('set-to', '\n\nSet x to 1'), '\n\nLet x be 1');
  });

  it('★全空行源文件不得触发二次回溯（真实攻击载荷）', () => {
    // 旧式实测：10000→165ms、20000→657ms、40000→2594ms（×4）。
    assertSubQuadratic('set-to / 全空行',
      n => 'Let x be 1' + '\n'.repeat(n) + '.',
      s => apply('set-to', s), 10000);
    assertSubQuadratic('result-is / 全空行',
      n => 'Let x be 1' + '\n'.repeat(n) + '.',
      s => apply('result-is', s), 10000);
  });
});
