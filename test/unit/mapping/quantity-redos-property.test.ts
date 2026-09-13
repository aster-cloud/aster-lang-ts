import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';

import { extractQuantities } from '../../../src/mapping/quantity-ir.js';

/**
 * ReDoS 修复的**穷举式**验证（property-based）。
 *
 * <h2>为什么需要这一层</h2>
 *
 * `quantity-ir.test.ts` 里的语义守卫用的是**人工挑的 9 组样本**。那只能证明
 * 「这 9 组没变」，证明不了「所有输入都没变」——而 `(?<![\d.])` 左锚是**改了
 * 正则**的修复，语义等价性需要覆盖面远大于人工样本的证据。
 *
 * <p>本文件用 fast-check 生成成千上万组输入，逐条比对**加锚前后**的匹配结果。
 *
 * <h2>★放在 test/unit/ 而不是 test/property/</h2>
 *
 * `package.json` 的 `test:unit:run` 只扫 `dist/test/unit/**` 与
 * `dist/test/type-checker/**`——**`test/property/` 不在 CI 里**。
 * 把安全回归放进一个不跑的目录等于没有守卫（本仓反复记录过这类假门禁）。
 */

/**
 * 加锚**之前**的完整模式表——★必须**四条全列**，且顺序与实现一致。
 *
 * <p>★这里踩过一个坑，值得记下来：我最初只列了 PERCENT/DURATION 两条（因为只
 * 有这两条加了锚），结果 property 立刻报出反例 `"$0%"`——但那**不是实现的
 * 问题，是这个基准函数写错了**。
 *
 * <p>`$0%` 里 MONEY 先声明、先占位 `[0,2)`，PERCENT 的 `[1,3)` 与之重叠被丢。
 * 少列 MONEY 的基准函数看不到这次占位，于是以为 PERCENT 应该被保留。
 *
 * <p>★教训：对照基准必须复刻**整条流水线**，漏掉任一环节，差异会被归咎到
 * 被测代码头上（本仓记过的「量具自身的缺陷」）。
 */
const LEGACY: ReadonlyArray<RegExp> = [
  /[$€£¥]\s?\d[\d,]*(?:\.\d+)?/g,                                              // MONEY
  /\d{4}-\d{2}-\d{2}/g,                                                        // DATE
  /\d+(?:\.\d+)?\s?%/g,                                                        // PERCENT（未加锚）
  /\d+(?:\.\d+)?\s?(?:小时|分钟|天|秒|hours?|minutes?|days?|seconds?)/g,        // DURATION（未加锚）
];

/** 用旧模式跑完整流水线（含「先声明者占位」的去重），返回 [文本, 起点]。 */
function legacyExtract(doc: string): { text: string; start: number }[] {
  const claimed: { start: number; end: number }[] = [];
  const out: { text: string; start: number }[] = [];
  for (const re of LEGACY) {
    re.lastIndex = 0;
    for (let m = re.exec(doc); m !== null; m = re.exec(doc)) {
      const start = m.index;
      const end = start + m[0].length;
      if (claimed.some(c => start < c.end && end > c.start)) continue;
      claimed.push({ start, end });
      out.push({ text: m[0], start });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 现行实现的抽取结果，口径与 {@link legacyExtract} 对齐。 */
function currentExtract(doc: string): { text: string; start: number }[] {
  return extractQuantities(doc).map(q => ({ text: q.text, start: q.span.start }));
}

const key = (x: { text: string; start: number }): string => `${x.start}:${x.text}`;

/**
 * 偏向「容易触发差异」的生成器：数字、小数点、单位、空白、货币符号的任意拼接。
 *
 * <p>★纯随机字符串几乎不会命中这两个模式，等于没测。这里用**结构化片段**
 * 拼装，让生成的输入大概率包含 `数字+单位` 形态。
 */
const FRAGMENT = fc.oneof(
  fc.constantFrom('0', '1', '9', '10', '100', '1.5', '0.5', '12.75', '00', '1.'),
  fc.constantFrom('%', '天', '小时', '分钟', '秒', 'days', 'day', 'hours', 'h'),
  fc.constantFrom('', ' ', '  ', '\t', '\n'),
  fc.constantFrom('$', '，', '。', 'x', '-', '.'),
);

const DOC = fc.array(FRAGMENT, { minLength: 0, maxLength: 24 }).map(xs => xs.join(''));

describe('QuantityIR ReDoS 修复 — property-based 验证', () => {
  it('★加锚只会**减少**匹配，且减掉的必然是「从数字中间起跑」的伪片段', () => {
    // ★这条修正了我先前的一个错误论断。
    //
    //   我原先说「加锚语义完全不变」，依据是 9 组人工样本。property 测试
    //   立刻给出反例：`"1.51.5%"`
    //     旧模式 → ["51.5%"]     ← 从第 4 位起跑，抽出一个**凭空造出来的值**
    //     新模式 → []            ← 左锚看到前面是 "."，拒绝起跑
    //
    //   进一步实测旧模式在畸形数字上的表现：
    //     "12.34.56%" → ["34.56%"]
    //     "1..5%"     → ["5%"]
    //     "..5%"      → ["5%"]
    //
    //   ★这些都是**错的**：`12.34.56%` 不是合法数量，抽出 `34.56%` 等于伪造
    //     一个值，而它随后会被 MappingIR 拿去与 IR 节点比对。所以左锚不只是
    //     ReDoS 修复，**它顺带修掉了一个「静默伪造数量」的缺陷**。
    //
    //   故正确的性质不是「完全相等」，而是：
    //     ① 新结果是旧结果的**子集**（只减不增，绝不新增匹配）
    //     ② 被减掉的那些，起跑位置前面必然是数字或小数点（= 从数字中间起跑）
    fc.assert(
      fc.property(DOC, (doc: string) => {
        const now = currentExtract(doc);
        const before = legacyExtract(doc);
        const beforeKeys = new Set(before.map(key));
        const nowKeys = new Set(now.map(key));

        // ① 只减不增
        for (const x of now) {
          assert.ok(beforeKeys.has(key(x)),
            `新增了旧模式没有的匹配 ${JSON.stringify(x)} —— 加锚不该产生新匹配。`
            + `\n输入 ${JSON.stringify(doc)}`);
        }

        // ② 减掉的必然是「从数字中间起跑」的伪片段
        for (const x of before) {
          if (nowKeys.has(key(x))) continue;
          const prev = x.start > 0 ? doc[x.start - 1]! : '';
          assert.ok(/[\d.]/.test(prev),
            `被减掉的 ${JSON.stringify(x)} 前面是 ${JSON.stringify(prev)}，`
            + '不是数字/小数点 —— 说明锚点误伤了合法匹配。'
            + `\n输入 ${JSON.stringify(doc)}`);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('★锚点必须真的在起作用 —— 存在输入使新旧结果不同（反向守卫）', () => {
    // ★这条是**本文件最重要的一条**，它补的是我自己写的前一条的漏洞。
    //
    //   前一条断言的是「只减不增」+「减掉的是伪片段」。变异验证（拆掉两处
    //   锚点重跑）发现它**依然全绿**——因为锚点没了之后 now === before，
    //   两个方向都**空洞地成立**。我只断言了变化的**方向**，没断言变化
    //   **发生过**。这正是本仓记过的「测试锁形状不锁内容」。
    //
    //   故补上这条：必须存在至少一个输入，新旧结果确有差异。
    //
    // ★★这条的**第一版仍然是假绿**，由独立审查者用变异找出来：
    //
    //   原写法是 `witnesses.filter(...).length > 0`——一个**逻辑或**。
    //   把 DURATION 的锚 `(?<![\d.])` 削弱成 `(?<!\d)`（精确复活「静默伪造
    //   数量」缺陷：`1.2.3 小时` → 伪造出 `2.3 小时`），**11/11 依然全绿**，
    //   因为 `1.51.5%` 走的是 PERCENT、锚完好、仍有差异 → OR 条件满足。
    //
    //   ★**一个还活着的锚点替所有其他锚点背书**。更讽刺的是
    //   `1.2.3 小时` 就在见证集里，但它在变异后与基准相等、对 OR 贡献 0，
    //   于是无人察觉。
    //
    //   修法：**逐 kind 分别钉死**，不许任何一条搭别人的便车。
    const WITNESSES: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
      // [输入, 现行应抽出的, 旧模式（无锚）会抽出的伪造值]
      ['1.51.5%',        [], ['51.5%']],
      ['12.34.56%',      [], ['34.56%']],
      ['1..5%',          [], ['5%']],
      ['..5%',           [], ['5%']],
      ['1.2.3 小时',      [], ['2.3 小时']],      // ← DURATION，必须单独钉
      ['12.34.56 days',  [], ['34.56 days']],   // ← DURATION 英文单位，同样单独钉
      ['1..5 hours',     [], ['5 hours']],
    ];

    for (const [doc, expectedNow, expectedLegacy] of WITNESSES) {
      // ① 现行实现**不得**抽出任何伪造数量
      assert.deepStrictEqual(currentExtract(doc).map(x => x.text), [...expectedNow],
        `${JSON.stringify(doc)} 不是合法数量，不应抽出任何值。\n`
        + '★抽出了值说明该 kind 的左锚 `(?<![\\d.])` 失效或被削弱'
        + '（例如改成 `(?<!\\d)` 就只挡数字、不挡小数点）。');

      // ② 基准确实会抽出伪造值——否则上面那条是空洞的
      assert.deepStrictEqual(legacyExtract(doc).map(x => x.text), [...expectedLegacy],
        `基准函数未复现旧行为 —— 对照基准本身失效了。输入 ${JSON.stringify(doc)}`);
    }
  });

  it('★任意输入下输出都无重叠、按位置升序（不变式，非样本）', () => {
    fc.assert(
      fc.property(DOC, (doc: string) => {
        const qs = extractQuantities(doc);
        for (let i = 1; i < qs.length; i++) {
          assert.ok(qs[i]!.span.start >= qs[i - 1]!.span.end,
            `重叠或乱序：${JSON.stringify(doc)} → ${JSON.stringify(qs.map(q => q.text))}`);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('★任意输入下 text 都逐字节等于切片（不变式）', () => {
    fc.assert(
      fc.property(DOC, (doc: string) => {
        for (const q of extractQuantities(doc)) {
          assert.strictEqual(q.text, doc.slice(q.span.start, q.span.end));
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('★纯 ASCII 随机串也不得破坏不变式（补齐结构化生成器的盲区）', () => {
    // 结构化生成器偏向「像数量」的输入，可能漏掉奇怪的字符组合。
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 120 }), (doc: string) => {
        const beforeKeys = new Set(legacyExtract(doc).map(key));
        for (const x of currentExtract(doc)) {
          assert.ok(beforeKeys.has(key(x)),
            `新增匹配 ${JSON.stringify(x)}，输入 ${JSON.stringify(doc)}`);
        }
        for (const q of extractQuantities(doc)) {
          assert.strictEqual(q.text, doc.slice(q.span.start, q.span.end));
        }
      }),
      { numRuns: 2000 },
    );
  });
});
