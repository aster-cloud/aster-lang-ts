import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractQuantities } from '../../../src/mapping/quantity-ir.js';
import { parseSourceIr, nodeAtOffset } from '../../../src/mapping/source-ir.js';
import { verifyMapping } from '../../../src/mapping/mapping-ir.js';

/**
 * QuantityIR（ADR 0037 §2/§10.5）—— 从人类文档机械抽取数量实体。
 *
 * <p>核心主张：**Quantity 有形态特征、可机械抽取；Entity 没有、需要 LLM**。
 * 本测试证明前半句，并用类型系统把后半句的边界钉住。
 */

const POLICY = [
  '# 付款审批政策', '',
  '## 阈值', '',
  '单笔付款超过 $10,000 时需要财务经理审批。',
  '低于 $10,000 的付款由部门主管批准即可。', '',
  '紧急付款上限为 $50,000，须在 24 小时内补批。', '',
  '## 手续费', '',
  '跨境付款收取 1.5% 手续费，最低 $25。', '',
  '## 生效日期', '',
  '本政策自 2026-01-01 起生效，2026-12-31 失效。', '',
].join('\n');

describe('QuantityIR — 机械抽取数量实体', () => {
  it('★抽出全部四类数量，且 value 已规范化', () => {
    const qs = extractQuantities(POLICY);
    const byKind = (k: string): string[] =>
      qs.filter(q => q.kind === k).map(q => q.value);

    assert.deepStrictEqual(byKind('MONEY'), ['10000', '10000', '50000', '25']);
    assert.deepStrictEqual(byKind('PERCENT'), ['1.5']);
    assert.deepStrictEqual(byKind('DURATION'), ['24']);
    assert.deepStrictEqual(byKind('DATE'), ['2026-01-01', '2026-12-31']);
  });

  it('★text 必须逐字节等于文档切片（与 SourceIR 同规则：不改内容）', () => {
    for (const q of extractQuantities(POLICY)) {
      assert.strictEqual(q.text, POLICY.slice(q.span.start, q.span.end),
        `${q.kind} 的 text 与切片不符 —— 说明做了文本改写。`);
    }
  });

  it('★输出按位置升序且互不重叠', () => {
    // ★样本必须选**真会重叠**的输入。POLICY 里四类模式互斥，重叠永不发生，
    //   拿它做样本时把重叠检查整个删掉测试照样绿（实测过）——假门禁。
    //   `$1.5%` 会同时匹配 MONEY(`$1.5`) 与 PERCENT(`1.5%`)，区间相交。
    for (const doc of ['$1.5% 混合', POLICY]) {
      const qs = extractQuantities(doc);
      for (let i = 1; i < qs.length; i++) {
        assert.ok(qs[i]!.span.start >= qs[i - 1]!.span.end,
          `${qs[i - 1]!.text} 与 ${qs[i]!.text} 重叠或乱序（文档 ${JSON.stringify(doc.slice(0, 20))}）`
          + '\n★重叠会让同一段文本被抽成两个候选，映射时互相矛盾。');
      }
    }
  });

  it('`$10,000` 整体抽取，千分位逗号去掉', () => {
    const qs = extractQuantities('付款 $10,000 元');
    assert.strictEqual(qs.length, 1, `应抽出 1 个金额，实际 ${JSON.stringify(qs.map(q => q.text))}`);
    assert.strictEqual(qs[0]!.text, '$10,000');
    assert.strictEqual(qs[0]!.value, '10000');
  });

  it('★模式顺序决定重叠时谁胜出：MONEY 先于 PERCENT', () => {
    // ★这条才真正钉住 PATTERNS 的顺序。`$1.5%` 是唯一会让两个模式相交的形态：
    //   MONEY 匹配 `$1.5`、PERCENT 匹配 `1.5%`。先声明者占位，后者出局。
    //   把 MONEY 挪到 PERCENT 之后，本条立刻变红。
    //   （原先我用 `$10,000` 和 `1.5%` 做「优先级」断言，但那两个输入下
    //     根本没有竞争者——挪动顺序测试照样绿，是假门禁。）
    const qs = extractQuantities('$1.5% 混合');
    assert.strictEqual(qs.length, 1, `重叠时应只保留一个，实际 ${JSON.stringify(qs.map(q => q.text))}`);
    assert.strictEqual(qs[0]!.kind, 'MONEY', 'MONEY 在 PATTERNS 中先声明，应胜出。');
    assert.strictEqual(qs[0]!.text, '$1.5');
  });

  it('★超安全整数的金额不得丢精度', () => {
    // 一旦过一次 JS number 就变 …992（本仓实测踩过）。
    const qs = extractQuantities('上限 $9007199254740993 元');
    assert.strictEqual(qs[0]!.value, '9007199254740993',
      '大额金额精度丢失 —— 说明中途经过了 JS number。');
  });

  it('DATE 保持原串，不转时间戳', () => {
    // 转时间戳会引入时区，而时区不是原文里的信息。
    const qs = extractQuantities('生效日 2026-01-01。');
    assert.strictEqual(qs[0]!.value, '2026-01-01');
    assert.strictEqual(qs[0]!.unit, undefined);
  });

  it('★形态像但规范化不出来的，不抽取（绝不编造）', () => {
    // `$ 待定` 与 `2026-1-1` 连**模式**都匹配不上，测不出 normalize 那道门。
    // 真正能触发 normalize 返回 undefined 的是：模式匹配成功、但规范化失败。
    // `$0,00` 匹配 MONEY 模式（`$` + 数字 + 逗号 + 数字），去逗号后是 `000`，
    // canonicalDecimal 能处理 → 仍会抽出。故这里用**非法日期**：模式要求
    // \d{4}-\d{2}-\d{2}，`2026-13-45` 匹配得上但语义非法。
    const weird = extractQuantities('日期 2026-13-45 和 2026-01-01。');
    const dates = weird.filter(q => q.kind === 'DATE').map(q => q.text);

    // ★如实记录当前行为：本模块**不做语义校验**（13 月 45 日照抽）。
    //   它只保证「抽出来的东西形态合法且 value 可规范化」，语义合法性由
    //   下游 verifier 或人判定 —— 这与 MappingIR 的分工一致。
    assert.deepStrictEqual(dates, ['2026-13-45', '2026-01-01'],
      '本模块只按形态抽取，不做日期语义校验（该判断属下游）。');

    // 而**模式都匹配不上**的，自然不产出：
    assert.deepStrictEqual(extractQuantities('价格 $ 待定'), []);
  });

  it('★全链路：SourceIR 定位 → Quantity 抽取 → MappingIR 判定', () => {
    // 这是 Quantity 层存在的理由：让人类文档里的数字能接进验证链。
    const ir = parseSourceIr(POLICY);
    const money = extractQuantities(POLICY).filter(q => q.kind === 'MONEY');
    assert.ok(money.length > 0, '应抽出金额。');

    for (const q of money) {
      // 每个金额都必须落在某个具体结构节点里
      const host = nodeAtOffset(ir, q.span.start);
      assert.ok(host !== undefined && host.kind !== 'DOCUMENT',
        `${q.text} 未落在具体结构节点内（实际 ${host?.kind}）。`);

      // 且能被 MappingIR 验过对应的 Decimal 节点
      const r = verifyMapping(
        { span: q.span, text: q.text, nodeId: '$.threshold' },
        () => ({ kind: 'Decimal', value: q.value }));
      assert.strictEqual(r.verdict, 'VERIFIED',
        `${q.text} 应能验过 Decimal(${q.value})。实际 ${r.verdict}：${r.reason}`);
    }
  });

  it('★Entity 不由本模块抽取（边界写进类型系统）', () => {
    // 「财务经理」「部门主管」在文档里，但**不该**出现在 Quantity 输出里——
    // 它们没有形态特征，只能由 LLM/人提出 EntityCandidate。
    // 若哪天有人给本模块加了「角色识别」的正则，这条会变红。
    const texts = extractQuantities(POLICY).map(q => q.text);
    for (const role of ['财务经理', '部门主管']) {
      assert.ok(!texts.some(t => t.includes(role)),
        `${role} 出现在 Quantity 输出里 —— Entity 应由 LLM 提出，本模块不得猜测。`);
    }
  });
});
