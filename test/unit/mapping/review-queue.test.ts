import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildReviewQueue, recordHumanProof } from '../../../src/mapping/review-queue.js';
import { isApplicableTo } from '../../../src/mapping/proof-ir.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/ai/llm-provider.js';

/**
 * 三段式第③段：人工复核队列（ADR 0037 §3）。
 *
 * <p>核心契约：**机器只做前两段，Proof 只能由人产出**。
 */

const DOC = [
  'Module policy.payment.',
  '',
  'Rule approve, produce:',
  '  Return 10000.',
  '',
].join('\n');

/** 假 provider：返回预置 JSON，记录收到的请求。 */
function fakeProvider(reply: string): LLMProvider & { calls: number } {
  const p = {
    calls: 0,
    async generate(_req: LLMRequest): Promise<LLMResponse> {
      p.calls++;
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

describe('复核队列 — 不传 provider（LLM 是可选增强）', () => {
  it('★没有 LLM 时整条链路照样跑', () => {
    // ★LLM 不得成为主链路依赖。没有它，映射类验证仍然完整。
    return buildReviewQueue(DOC).then(q => {
      assert.ok(q.counts.verified >= 1,
        `应有已证明的候选，实际 ${JSON.stringify(q.counts)}`);
      assert.strictEqual(q.items.filter(i => i.source.kind === 'ENTITY').length, 0,
        '未传 provider 时不应有 Entity 类待复核项。');
    });
  });
});

describe('复核队列 — 传 provider（三段式完整）', () => {
  it('★LLM 候选必须落在待复核队列，而不是被当成结论', () => {
    // ADR §3：AI 可以提出映射，但不能定义什么叫正确。
    const reply = JSON.stringify([
      { text: 'approve', kind: 'Role', start: DOC.indexOf('approve') },
    ]);
    const p = fakeProvider(reply);

    return buildReviewQueue(DOC, p).then(q => {
      assert.strictEqual(p.calls, 1, 'provider 应被调用一次。');
      const entities = q.items.filter(i => i.source.kind === 'ENTITY');
      assert.strictEqual(entities.length, 1,
        `LLM 候选应进入待复核队列，实际 ${JSON.stringify(q.items)}`);
      assert.match(entities[0]!.reason, /语义/,
        '待复核理由应说明这是语义判断（机器证不了）。');
    });
  });

  it('★LLM 的幻觉必须被拦下并**如实报告**，不得静默丢弃', () => {
    // 位置错的候选——最常见也最危险的幻觉（会让双向导航跳错位置）。
    const reply = JSON.stringify([{ text: 'approve', kind: 'Role', start: 0 }]);
    const p = fakeProvider(reply);

    return buildReviewQueue(DOC, p).then(q => {
      assert.strictEqual(q.items.filter(i => i.source.kind === 'ENTITY').length, 0,
        '位置错的候选必须被丢弃。');
      assert.ok(q.diagnostics.some(d => d.includes('LLM 提案被丢弃')),
        `丢弃必须如实报告——那是评估模型可靠性最重要的信号。实际：${JSON.stringify(q.diagnostics)}`);
    });
  });

  it('★LLM 失败不得让整条链路失败', () => {
    // ★降级而非全盘失败：映射类结果与 LLM 无关，必须保留。
    const broken: LLMProvider = {
      async generate() { throw new Error('connection refused'); },
      getName: () => 'broken',
      getModel: () => 'x',
    };

    return buildReviewQueue(DOC, broken).then(q => {
      assert.ok(q.counts.verified >= 1,
        'LLM 挂了，但映射类验证结果必须仍然有效。');
      assert.ok(q.diagnostics.some(d => d.includes('Entity 提出失败')),
        '必须说明 LLM 为何没跑。');
    });
  });
});

describe('人工复核 — Proof 只能由人产出', () => {
  const item = {
    text: '10000',
    span: { start: 0, end: 5 },
    reason: '需人工确认',
    source: { kind: 'MAPPING' as const, nodeId: '$.decls{approve}.body.statements[0].expr' },
  };

  it('★产出的 Proof 必须锚定到真实节点的 contentHash', () => {
    const proof = recordHumanProof(
      DOC, item, item.source.nodeId,
      { kind: 'DOMAIN_EXPERT', by: 'alice@example.com' },
      'VERIFIED', '该金额与业务规则一致，已与财务核对。',
      '2026-09-14T00:00:00Z');

    assert.strictEqual(proof.subject.kind, 'DOMAIN_EXPERT');
    assert.ok(proof.verifiedAgainst.contentHash.length === 64,
      `contentHash 应是 SHA-256 十六进制，实际 ${proof.verifiedAgainst.contentHash}`);
    assert.strictEqual(proof.recordedAt, '2026-09-14T00:00:00Z',
      '时间必须由调用方传入——取系统时钟会让同一输入产出不同记录，无法复现。');
  });

  it('★空理由必须被拒绝（没有理由的批准等于没有复核）', () => {
    assert.throws(
      () => recordHumanProof(DOC, item, item.source.nodeId,
        { kind: 'ENGINEER', by: 'bob' }, 'VERIFIED', '   ', '2026-09-14T00:00:00Z'),
      /理由不得为空/,
      '空壳 proof 没有任何审计价值，必须拒绝记录。');
  });

  it('★不存在的节点必须被拒绝', () => {
    assert.throws(
      () => recordHumanProof(DOC, item, '$.nope',
        { kind: 'ENGINEER', by: 'bob' }, 'VERIFIED', '理由', '2026-09-14T00:00:00Z'),
      /节点不存在/,
      'proof 必须锚定真实节点，否则它记录的是一个不存在之物的结论。');
  });

  it('★内容变了以后，旧 proof 必须被判为不再适用（而非悄悄沿用）', () => {
    // ★这是 ProofIR 不可变设计的意义：proof 本身永不修改，
    //   "还适不适用"是**算出来**的。
    const proof = recordHumanProof(
      DOC, item, item.source.nodeId,
      { kind: 'DOMAIN_EXPERT', by: 'alice' },
      'VERIFIED', '已核对。', '2026-09-14T00:00:00Z');

    const same = isApplicableTo(proof, () => proof.verifiedAgainst.contentHash);
    assert.strictEqual(same.applicable, true, '内容未变时应仍适用。');

    const changed = isApplicableTo(proof, () => 'f'.repeat(64));
    assert.strictEqual(changed.applicable, false, '内容变了必须判不适用。');
    if (!changed.applicable) {
      assert.strictEqual(changed.why, 'CONTENT_CHANGED');
    }

    const gone = isApplicableTo(proof, () => undefined);
    assert.strictEqual(gone.applicable, false, '节点没了必须判不适用。');
  });
});
