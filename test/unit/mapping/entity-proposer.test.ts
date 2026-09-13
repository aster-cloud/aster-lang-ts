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

  it('★注入守卫：kind 含标签字符 → 丢弃（防 reason 被渲染成 HTML）', () => {
    // kind 是 **LLM 完全可控**的自由字符串，且原样进入 reason（人类可读文本）。
    // 本仓有 6 处 dangerouslySetInnerHTML——一旦有人把 reason 接进去就是存储型 XSS。
    // ★不能在此做 HTML 转义：那会改变 kind 的值，违反 §12.4「原样保留」。
    //   正确做法是在源头限制**形态**——合法类别名本就不含这些字符。
    const payload = JSON.stringify([
      { text: '财务经理', kind: '<img src=x onerror=alert(1)>', start: DOC.indexOf('财务经理') },
    ]);
    const r = parseProposals(payload, DOC, 0, BY);

    assert.strictEqual(r.candidates.length, 0, '含标签字符的 kind 必须丢弃。');
    assert.match(r.rejected[0]!.why, /标签或控制字符/);
  });

  it('★合法类别（中英文）不得被注入守卫误伤', () => {
    // 反向守卫：若字符白名单收得过紧，正常类别会被拒——那比不设防更糟，
    // 因为它会静默丢掉真实候选。
    for (const kind of ['Role', 'Obligation', '角色', '义务主体', 'Party_A']) {
      const r = parseProposals(
        JSON.stringify([{ text: '财务经理', kind, start: DOC.indexOf('财务经理') }]), DOC, 0, BY);
      assert.strictEqual(r.candidates.length, 1,
        `合法类别 ${JSON.stringify(kind)} 被误拒：${JSON.stringify(r.rejected)}`);
    }
  });

  it('★资源上限：条目数超限整批拒绝，且如实报告', () => {
    // 防「LLM 返回巨量条目」耗尽下游内存。★不静默截断——
    // 调用方必须知道「LLM 返回量异常」这件事。
    const many = JSON.stringify(
      Array.from({ length: 5000 }, () => ({ text: '财务经理', kind: 'Role', start: DOC.indexOf('财务经理') })));
    const r = parseProposals(many, DOC, 0, BY);

    assert.strictEqual(r.candidates.length, 0, '超限应整批拒绝。');
    assert.strictEqual(r.rejected.length, 1);
    assert.match(r.rejected[0]!.why, /条目数超上限/);
  });

  it('★超长 kind → 丢弃（防 reason 变成一大段不可控内容）', () => {
    const r = parseProposals(
      JSON.stringify([{ text: '财务经理', kind: 'x'.repeat(200), start: DOC.indexOf('财务经理') }]),
      DOC, 0, BY);
    assert.strictEqual(r.candidates.length, 0);
    assert.match(r.rejected[0]!.why, /过长/);
  });
});
