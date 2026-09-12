import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseProposals, proposeEntities, verifyEntityCandidate } from '../../../src/mapping/entity-proposer.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/ai/llm-provider.js';
import { parseSourceIr } from '../../../src/mapping/source-ir.js';
import { extractQuantities } from '../../../src/mapping/quantity-ir.js';

/**
 * Entity 提出器（ADR 0037 §3/§11.5）—— 三段式的第①段。
 *
 * <p>核心契约：**LLM 只能提出候选，不能定义什么叫正确**。
 * 本测试用假 provider 驱动，不打真实 LLM——判定逻辑必须可离线验证。
 */

const DOC = [
  '# 付款审批政策', '',
  '单笔付款超过 $10,000 时需要财务经理审批。',
  '低于该额度由部门主管批准。', '',
].join('\n');

const BY = 'llm:fake/test-model';

/** 假 provider：返回预置文本，记录收到的请求。 */
function fakeProvider(reply: string): LLMProvider & { lastRequest: LLMRequest | undefined } {
  // ★用 `| undefined` 而非 `?`：tsconfig 开了 exactOptionalPropertyTypes，
  //   「属性可为 undefined」与「属性可缺席」是两回事。
  const p = {
    lastRequest: undefined as LLMRequest | undefined,
    async generate(request: LLMRequest): Promise<LLMResponse> {
      p.lastRequest = request;
      return {
        content: reply, model: 'test-model',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
    getName: () => 'fake',
    getModel: () => 'test-model',
  };
  return p;
}

/** 造一条「位置与文本都正确」的提议。 */
function truthful(text: string): string {
  return JSON.stringify([{ text, kind: 'Role', start: DOC.indexOf(text) }]);
}

describe('Entity 提出器 — 三段式第①段', () => {
  it('★位置与文本都对的候选被接受', () => {
    const r = parseProposals(truthful('财务经理'), DOC, 0, BY);

    assert.strictEqual(r.candidates.length, 1, `应接受 1 条，实际 ${JSON.stringify(r)}`);
    assert.strictEqual(r.candidates[0]!.text, '财务经理');
    assert.strictEqual(r.candidates[0]!.proposedKind, 'Role');
    assert.strictEqual(r.candidates[0]!.proposedBy, BY);
    assert.strictEqual(DOC.slice(r.candidates[0]!.span.start, r.candidates[0]!.span.end), '财务经理');
  });

  it('★幻觉闸门：文本不在声称位置上 → 丢弃并报告', () => {
    // LLM 最常见的幻觉：文本对但位置错。这会让双向导航指向错误的地方。
    const wrongPos = JSON.stringify([{ text: '财务经理', kind: 'Role', start: 0 }]);
    const r = parseProposals(wrongPos, DOC, 0, BY);

    assert.strictEqual(r.candidates.length, 0, '位置错的候选必须丢弃。');
    assert.strictEqual(r.rejected.length, 1);
    assert.match(r.rejected[0]!.why, /不符/, `应说明不符，实际：${r.rejected[0]!.why}`);
  });

  it('★幻觉闸门：文档里根本没有的文本 → 丢弃', () => {
    // 凭空编造的实体。
    const invented = JSON.stringify([{ text: '首席合规官', kind: 'Role', start: 20 }]);
    const r = parseProposals(invented, DOC, 0, BY);

    assert.strictEqual(r.candidates.length, 0, '文档里不存在的文本必须丢弃。');
    assert.strictEqual(r.rejected.length, 1);
  });

  it('★被丢弃的条目必须如实报告，不得静默吞掉', () => {
    // 反向守卫：若 rejected 恒为空，「LLM 产出了不合规内容」这件事就消失了，
    // 而那恰恰是评估模型可靠性最重要的信号。
    const mixed = JSON.stringify([
      { text: '财务经理', kind: 'Role', start: DOC.indexOf('财务经理') },  // 对
      { text: '不存在的角色', kind: 'Role', start: 5 },                     // 错
      { text: '部门主管', kind: 'Party', start: 999 },                      // 越界
      { notText: 1 },                                                       // 格式错
    ]);
    const r = parseProposals(mixed, DOC, 0, BY);

    assert.strictEqual(r.candidates.length, 1, '只应接受那条正确的。');
    assert.strictEqual(r.rejected.length, 3, `三条不合规都要报告，实际 ${JSON.stringify(r.rejected)}`);
    assert.ok(r.rejected.every(x => x.why.length > 0), '每条丢弃都要说明原因。');
  });

  it('非 JSON / 非数组输出整体丢弃，不崩', () => {
    for (const bad of ['我找到了这些实体：财务经理', '{"text":"x"}', '']) {
      const r = parseProposals(bad, DOC, 0, BY);
      assert.strictEqual(r.candidates.length, 0);
      assert.strictEqual(r.rejected.length, 1, `输入 ${JSON.stringify(bad)} 应报告 1 条丢弃`);
    }
  });

  it('容忍 LLM 套的 ```json 围栏（prompt 已要求不要，但模型常忘）', () => {
    const fenced = '```json\n' + truthful('部门主管') + '\n```';
    assert.strictEqual(parseProposals(fenced, DOC, 0, BY).candidates.length, 1);
  });

  it('★scope 偏移必须平移回原文（否则候选整体错位）', () => {
    // LLM 看到的是切片，它给的 start 是切片内偏移；必须加上 scope 起点。
    const base = 10;
    const sliced = DOC.slice(base);
    const inSlice = sliced.indexOf('财务经理');
    const r = parseProposals(
      JSON.stringify([{ text: '财务经理', kind: 'Role', start: inSlice }]), DOC, base, BY);

    assert.strictEqual(r.candidates.length, 1,
      `切片内偏移未被平移回原文 —— 实际 ${JSON.stringify(r.rejected)}`);
    assert.strictEqual(r.candidates[0]!.span.start, base + inSlice);
  });

  it('★第②段恒判 REVIEW_REQUIRED —— 机器不得替人下结论', () => {
    // ADR §3：AI 可以提出映射，但不能定义什么叫正确。
    // Entity 的目标是**语义**对应，而 verifier 只能读 kind/value/name/origin
    // （类型层是两引擎合法分叉的层，不在可依赖范围内，见 §5.1）。
    const r = parseProposals(truthful('财务经理'), DOC, 0, BY);
    const verdict = verifyEntityCandidate(r.candidates[0]!);

    assert.strictEqual(verdict.verdict, 'REVIEW_REQUIRED');
    assert.match(verdict.reason, /语义/, '判定理由应说明这是语义判断。');
  });

  it('★temperature 必须为 0：同一文档反复提出应可复现', () => {
    // 候选生成的可复现性是审计的前提——否则「上次为什么提了这条」永远说不清。
    const p = fakeProvider('[]');
    return proposeEntities(DOC, p).then(() => {
      assert.strictEqual(p.lastRequest?.temperature, 0,
        `temperature 应为 0，实际 ${p.lastRequest?.temperature}`);
    });
  });

  it('★scope 限定时只把该节点的文本喂给 LLM', () => {
    const ir = parseSourceIr(DOC);
    const heading = ir.children[0]!;
    const p = fakeProvider('[]');

    return proposeEntities(DOC, p, heading).then(() => {
      assert.strictEqual(p.lastRequest?.prompt,
        DOC.slice(heading.span.start, heading.span.end),
        'scope 限定时应只喂该节点的文本，而不是整篇文档。');
    });
  });

  it('★与 Quantity 分工不重叠：Entity 不碰金额', () => {
    // Quantity 由确定性模块处理（ADR §11）；两边都抽会产生重复候选。
    const moneyTexts = extractQuantities(DOC).map(q => q.text);
    assert.ok(moneyTexts.includes('$10,000'), '前置：文档里应有金额。');

    // 即使 LLM 错误地提出了金额，它也只是一条普通候选——不会被特殊对待，
    // 但契约上 systemPrompt 已明确要求不要输出。此处钉住 prompt 里那条要求。
    const p = fakeProvider('[]');
    return proposeEntities(DOC, p).then(() => {
      assert.match(p.lastRequest?.systemPrompt ?? '', /不要输出金额/,
        'systemPrompt 必须明确要求 LLM 不输出金额等数量 —— 那是确定性模块的职责。');
    });
  });
});
