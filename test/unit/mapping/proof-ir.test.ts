import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import type { Module as AstModule } from '../../../src/types.js';
import { computeNodeIds } from '../../../src/nodeid/node-id-map.js';
import { isApplicableTo, resolveEffective } from '../../../src/mapping/proof-ir.js';
import type { Proof } from '../../../src/mapping/proof-ir.js';

/**
 * ProofIR（ADR 0037 §2/§6.1）。
 *
 * <p>核心契约：**proof 记录不可变，有效性算出来**。
 * 用真实 IR 驱动——proof 锚定 nodeId + contentHash，改源码后自动失效。
 */

const V1 = [
  'Module demo.approve.', '',
  'Rule approve given amount, produce:',
  '  If amount greater than 10000:',
  '    Return "REFER".',
  '  Otherwise:',
  '    Return "APPROVE".', '',
].join('\n');

const idsOf = (src: string) =>
  computeNodeIds(JSON.parse(JSON.stringify(lowerModule(parse(lex(canonicalize(src))).ast as AstModule))));

/** 找到阈值字面量节点（`10000`）。 */
function thresholdNode(src: string): { nodeId: string; contentHash: string } {
  for (const [id, v] of idsOf(src)) {
    if (v.kind === 'Int') return { nodeId: id, contentHash: v.contentHash };
  }
  throw new Error('找不到 Int 节点');
}

function proofOf(anchor: { nodeId: string; contentHash: string },
                 overrides: Partial<Proof> = {}): Proof {
  return {
    mapping: { span: { start: 0, end: 7 }, text: '$10,000', nodeId: anchor.nodeId },
    verdict: 'VERIFIED',
    subject: { kind: 'VERIFIER', by: 'mapping-ir/v1' },
    rule: { id: 'exact-value', version: '1' },
    verifiedAgainst: anchor,
    reason: '文本解析为 Int 10000，与目标节点一致。',
    recordedAt: '2026-09-13T00:00:00Z',
    ...overrides,
  };
}

const hashLookup = (src: string) => (id: string) => idsOf(src).get(id)?.contentHash;

describe('ProofIR — 不可变记录 + 有效性算出来', () => {
  it('★内容未变 → proof 仍适用', () => {
    const anchor = thresholdNode(V1);
    const r = isApplicableTo(proofOf(anchor), hashLookup(V1));
    assert.deepStrictEqual(r, { applicable: true });
  });

  it('★改了阈值 → proof 自动失效（记录本身不被修改）', () => {
    const anchor = thresholdNode(V1);
    const proof = proofOf(anchor);
    const frozen = JSON.stringify(proof);

    const v2 = V1.replace('10000', '20000');
    assert.notStrictEqual(v2, V1, '★replace 未生效则本用例无效。');

    const r = isApplicableTo(proof, hashLookup(v2));
    assert.strictEqual(r.applicable, false, '阈值已变，proof 不应再适用。');
    assert.strictEqual(r.applicable === false ? r.why : '', 'CONTENT_CHANGED');

    // ★记录本身一个字节都没被改 —— 这是「不可变 + 水位线」的关键。
    assert.strictEqual(JSON.stringify(proof), frozen,
      'proof 记录被修改了 —— 应当只算有效性，绝不原地改写历史事实。');
  });

  it('节点已不存在 → NODE_GONE（与「内容变了」区分开）', () => {
    const anchor = thresholdNode(V1);
    const r = isApplicableTo(proofOf(anchor), () => undefined);
    assert.strictEqual(r.applicable, false);
    assert.strictEqual(r.applicable === false ? r.why : '', 'NODE_GONE');
  });

  it('★仲裁：只在「仍适用」的里面取最新', () => {
    const anchor = thresholdNode(V1);
    const old = proofOf(anchor, { recordedAt: '2026-01-01T00:00:00Z', verdict: 'REVIEW_REQUIRED' });
    const recent = proofOf(anchor, { recordedAt: '2026-09-13T00:00:00Z', verdict: 'VERIFIED' });

    const { effective } = resolveEffective([old, recent], hashLookup(V1));
    assert.strictEqual(effective?.recordedAt, '2026-09-13T00:00:00Z',
      '应取最新的一条。');
  });

  it('★失效的 proof 不得参与仲裁（否则会拿旧版本的结论当现在的答案）', () => {
    // 反向守卫：没有这条，resolveEffective 可以退化成「无脑取最新」——
    // 上面那条照样绿，而一条早已失效的 proof 会被当成当前有效结论。
    const anchor = thresholdNode(V1);
    const stale = proofOf(anchor, { recordedAt: '2099-01-01T00:00:00Z' }); // 时间最新但内容已变

    const v2 = V1.replace('10000', '20000');
    const { effective } = resolveEffective([stale], hashLookup(v2));

    assert.strictEqual(effective, undefined,
      '唯一的 proof 已失效，不应选出任何有效结论。');
  });

  it('★并存的分歧必须如实暴露，不静默吞掉', () => {
    const anchor = thresholdNode(V1);
    const machine = proofOf(anchor, {
      recordedAt: '2026-09-13T00:00:00Z', verdict: 'REJECTED',
      subject: { kind: 'VERIFIER', by: 'mapping-ir/v1' },
    });
    const expert = proofOf(anchor, {
      recordedAt: '2026-09-12T00:00:00Z', verdict: 'VERIFIED',
      subject: { kind: 'DOMAIN_EXPERT', by: 'alice' },
    });

    const { effective, conflicts } = resolveEffective([machine, expert], hashLookup(V1));

    assert.strictEqual(effective?.verdict, 'REJECTED', '按时间应取机器那条。');
    assert.strictEqual(conflicts.length, 1,
      '专家的相反结论必须出现在 conflicts 里 —— 静默吞掉会让「机器与专家分歧」这件事消失。');
    assert.strictEqual(conflicts[0]?.subject.kind, 'DOMAIN_EXPERT');
  });

  it('结论相同的多条 proof 不算冲突', () => {
    const anchor = thresholdNode(V1);
    const a = proofOf(anchor, { recordedAt: '2026-09-13T00:00:00Z' });
    const b = proofOf(anchor, { recordedAt: '2026-09-12T00:00:00Z' });

    const { conflicts } = resolveEffective([a, b], hashLookup(V1));
    assert.strictEqual(conflicts.length, 0, '同结论不应报冲突（否则噪声淹没真分歧）。');
  });

  it('空输入不崩', () => {
    assert.deepStrictEqual(resolveEffective([], () => 'x'), { conflicts: [] });
  });

  it('★proof 必须记录主体与规则（§2 的「谁验的、按什么规则」）', () => {
    const anchor = thresholdNode(V1);
    const p = proofOf(anchor);
    // 这两项是 ADR §2 明确要求 ProofIR 回答的问题；类型上是必填，
    // 此处再钉一次运行时形态，防止将来被改成可选后悄悄缺失。
    assert.ok(p.subject.kind && p.subject.by, 'subject 必须可追溯到具体主体。');
    assert.ok(p.rule.id && p.rule.version,
      'rule 必须带版本 —— 规则本身会演进，旧 proof 要说清当时用的哪一版。');
  });
});
