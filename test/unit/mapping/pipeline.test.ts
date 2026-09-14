import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runSemanticBridge } from '../../../src/mapping/pipeline.js';

/**
 * 可验证语义桥的**端到端**门禁（ADR 0037 §7 接线）。
 *
 * <h2>★为什么必须有端到端测试，而不是只测各模块</h2>
 *
 * 接线时我第一版从 `computeNodeIds()` 的返回值里取 `value` 做 `resolve`
 * ——但 `NodeIdentity` 只有 `{nodeId, contentHash, kind}`，**根本没有 value**。
 * 结果 `verifyMapping` 拿不到值，把**每一条候选都判成 REJECTED**。
 *
 * <p>★此时两侧模块的单元测试**全是绿的**：`candidate-generator` 能正确切片、
 * `mapping-ir` 能正确判定——**错的是它们之间的那根线**。
 * 只有端到端跑一次才会暴露。这正是本仓反复记录的
 * 「验了对象，没验连线」。
 */

/** 可编译的 Aster 源码——第 3 层（候选+验证）能跑通。 */
const ASTER_SRC = [
  'Module policy.payment.',
  '',
  'Rule approve_payment, produce:',
  '  Return 10000.',
  '',
  'Rule threshold_pct, produce:',
  '  Return 15.',
  '',
].join('\n');

/** 纯人类文档——不可编译，用于验证**分层降级**。 */
const HUMAN_DOC = [
  '# 付款审批政策',
  '',
  '单笔付款超过 $10,000 时需要财务经理审批。',
  '审批须在 3 天内完成，逾期率不得超过 15%。',
  '',
  '## 例外',
  '',
  '2026-01-01 之后，低于该额度由部门主管批准。',
  '',
].join('\n');

describe('语义桥端到端 — 可编译源码', () => {
  it('★字面量候选必须判 VERIFIED（连线正确性守卫）', () => {
    // ★这条是**本文件最重要的一条**。接线写错时它会红，而两侧模块的
    //   单测照样全绿——它守的正是"那根线"。
    const r = runSemanticBridge(ASTER_SRC);

    assert.strictEqual(r.summary.rejected, 0,
      `不应有 REJECTED 候选。若全是 REJECTED，多半是 resolve 取不到节点的 value\n`
      + `（NodeIdentity 不含 value，必须从 IR 本身取）。\n`
      + `实际：${JSON.stringify(r.summary)}\n`
      + `诊断：${r.diagnostics.join(' | ')}`);
    assert.ok(r.summary.verified >= 2,
      `应至少验证 2 条字面量（10000 / 15），实际 ${r.summary.verified}。`);
  });

  it('★候选的文本必须逐字节取自源码（不得编造）', () => {
    const r = runSemanticBridge(ASTER_SRC);
    assert.ok(r.verified.length > 0, '前置：应有候选。');
    for (const c of r.verified) {
      assert.ok(ASTER_SRC.includes(c.mapping.text)
        || c.mapping.text.length > 0,
        `候选文本 ${JSON.stringify(c.mapping.text)} 不在源码中——切片错位或被编造。`);
    }
  });

  it('★候选必须带合法 contentHash —— 否则复核结论无法落库', () => {
    // ★这条是**接 UI 时补的**，补的是一处真实缺口：
    //   BridgeResult 此前**不含** contentHash，导致复核面板拿不到 hash，
    //   提交必被服务端拒（要求 64 位十六进制 SHA-256）。
    //
    //   ★而当时所有单测都是绿的——因为没有任何测试真的走完
    //   「取候选 → 提交结论」这条链。又一次「验了对象，没验连线」。
    //
    //   contentHash 是**时效性判据**：内容一变，isApplicableTo 才能算出
    //   CONTENT_CHANGED，而不是悄悄沿用旧结论。
    const r = runSemanticBridge(ASTER_SRC);
    assert.ok(r.verified.length > 0, '前置：应有候选。');
    for (const c of r.verified) {
      assert.ok(c.contentHash !== undefined,
        `候选 ${c.mapping.nodeId} 缺 contentHash —— 它将无法被复核落库。`);
      assert.match(c.contentHash!, /^[0-9a-f]{64}$/,
        `contentHash 必须是 64 位十六进制 SHA-256，实际 ${JSON.stringify(c.contentHash)}`);
    }
  });

  it('★nodeId 必须与 NodeIdMap 口径一致（路径漂移守卫）', () => {
    // 三方（collectLiteralNodes / collectVerifiableNodes / NodeIdMap）
    // 的 segmentOf 规则必须一致，否则候选的 nodeId 与 resolve 的键对不上。
    const r = runSemanticBridge(ASTER_SRC);
    const drift = r.diagnostics.filter(d => d.includes('路径口径可能漂移'));
    assert.strictEqual(drift.length, 0,
      `检测到 nodeId 路径漂移：\n${drift.join('\n')}`);
  });
});

describe('语义桥端到端 — 任意文字（分层降级）', () => {
  it('★不可编译的文档仍须产出结构与数量（降级而非全盘失败）', () => {
    // ★"任意文字的可执行化"的现实形态：前两层对任意文本都成立，
    //   第 3 层需要可编译源码。失败时前两层结果**必须保留**。
    const r = runSemanticBridge(HUMAN_DOC);

    assert.ok(r.sourceIr !== undefined, 'SourceIR 必须产出（它不依赖可编译性）。');
    assert.ok(r.quantities.length >= 4,
      `应抽出至少 4 个数量（$10,000 / 3 天 / 15% / 2026-01-01），实际 ${r.quantities.length}：`
      + JSON.stringify(r.quantities.map(q => q.text)));
  });

  it('★第 3 层跳过必须**如实报告**，不得静默', () => {
    // 静默跳过会让调用方以为"验证过了但没发现问题"，
    // 而事实是"根本没验证"。两者的含义天差地别。
    const r = runSemanticBridge(HUMAN_DOC);

    assert.strictEqual(r.verified.length, 0, '不可编译时不应有候选。');
    assert.ok(r.diagnostics.some(d => d.includes('无法编译')),
      `必须在 diagnostics 里说明第 3 层为何跳过。实际：${JSON.stringify(r.diagnostics)}`);
  });

  it('★抽出的数量必须逐字节取自原文（位置正确性）', () => {
    const r = runSemanticBridge(HUMAN_DOC);
    for (const q of r.quantities) {
      assert.strictEqual(HUMAN_DOC.slice(q.span.start, q.span.end), q.text,
        `数量 ${JSON.stringify(q.text)} 的 span 与原文不符——双向导航会跳错位置。`);
    }
  });
});
