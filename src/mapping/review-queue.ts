import type { LLMProvider } from '../ai/llm-provider.js';
import { computeNodeIds } from '../nodeid/node-id-map.js';
import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { parse } from '../parser.js';
import { lowerModule } from '../lower_to_core.js';
import { proposeEntities, verifyEntityCandidate } from './entity-proposer.js';
import type { Proof, ProofSubject } from './proof-ir.js';
import { runSemanticBridge, type BridgeResult } from './pipeline.js';

/**
 * 人工复核队列（ADR 0037 §3 三段式的**第③段**）。
 *
 * <h2>三段式：机器只做前两段</h2>
 *
 * <pre>
 *   ① 提出   LLM / 确定性生成器  →  候选（**没有任何判定力**）
 *   ② 判定   确定性 verifier     →  VERIFIED / REVIEW_REQUIRED / REJECTED
 *   ③ 复核   **人**              →  Proof（subject = DOMAIN_EXPERT / ENGINEER）
 * </pre>
 *
 * <p>★ADR §3 原话：「AI 可以提出映射，但**不能定义什么叫正确**」。
 * 本模块把这条写进类型：
 *
 * <ul>
 *   <li>{@link buildReviewQueue} 只产出 {@link ReviewItem}（待复核项），
 *       <b>不产出 Proof</b>；</li>
 *   <li>{@link recordHumanProof} 是唯一能产出 Proof 的入口，且它
 *       <b>要求调用方传入人的身份</b>——机器无法自行调用它来"批准"自己。</li>
 * </ul>
 *
 * <h2>★这也正是 UI 需要的数据结构</h2>
 *
 * 一个复核界面要展示的就是 {@link ReviewQueue}：
 * 三类计数（已证明 / 待复核 / 已拒绝）+ 每条待复核项的
 * 「原文片段 ↔ 目标节点 ↔ 为什么机器证不了」。
 */

/** 待复核项的来源。 */
export type ReviewSource =
  /** 来自候选映射验证（机器判 REVIEW_REQUIRED）。 */
  | { readonly kind: 'MAPPING'; readonly nodeId: string }
  /** 来自 LLM 的 Entity 提出（对 Entity 恒需人复核）。 */
  | { readonly kind: 'ENTITY'; readonly proposedBy: string; readonly proposedKind: string };

/** 一条待人工复核的项。★它**不是**结论，只是"机器证不了、请人看"。 */
export interface ReviewItem {
  /** 原文片段——UI 直接高亮这段。 */
  readonly text: string;
  /** 原文位置，用于双向导航。 */
  readonly span: { readonly start: number; readonly end: number };
  /** 机器为什么证不了（人类可读）。 */
  readonly reason: string;
  readonly source: ReviewSource;
}

/** 复核队列。★`verified`/`rejected` 只给计数，UI 不需要逐条渲染它们。 */
export interface ReviewQueue {
  readonly items: readonly ReviewItem[];
  readonly counts: {
    readonly verified: number;
    readonly reviewRequired: number;
    readonly rejected: number;
  };
  /** 过程中所有"没做成"的事——★不静默丢弃。 */
  readonly diagnostics: readonly string[];
}

/**
 * 把一份文档变成**待复核队列**。
 *
 * @param provider 可选。传入则跑三段式第①段（LLM 提出 Entity）；
 *                 不传则只有映射类待复核项。
 *                 ★LLM 是**可选增强**，不是主链路依赖——没有它整条链路照样跑。
 */
export async function buildReviewQueue(
  document: string,
  provider?: LLMProvider,
): Promise<ReviewQueue> {
  const bridge: BridgeResult = runSemanticBridge(document);
  const diagnostics = [...bridge.diagnostics];
  const items: ReviewItem[] = [];

  // ── 映射类待复核：机器判了 REVIEW_REQUIRED 的候选 ──────────────
  for (const c of bridge.verified) {
    if (c.result.verdict !== 'REVIEW_REQUIRED') continue;
    items.push({
      text: c.mapping.text,
      span: c.mapping.span,
      reason: c.result.reason,
      source: { kind: 'MAPPING', nodeId: c.mapping.nodeId },
    });
  }

  // ── Entity 类待复核：LLM 提出 → verifier 恒判 REVIEW_REQUIRED ──
  if (provider !== undefined) {
    try {
      const proposal = await proposeEntities(document, provider);
      for (const r of proposal.rejected) {
        // ★幻觉闸门丢弃的条目**必须如实报告**——那是评估模型可靠性最重要的信号。
        diagnostics.push(`LLM 提案被丢弃：${r.why}（原始：${r.raw.slice(0, 80)}）`);
      }
      for (const cand of proposal.candidates) {
        const v = verifyEntityCandidate(cand);
        items.push({
          text: cand.text,
          span: cand.span,
          reason: v.reason,
          source: {
            kind: 'ENTITY',
            proposedBy: cand.proposedBy,
            proposedKind: cand.proposedKind,
          },
        });
      }
    } catch (e) {
      // ★LLM 失败不得让整条链路失败——前面的映射类结果仍然有效。
      diagnostics.push(
        `Entity 提出失败（LLM 不可用或返回异常），映射类结果不受影响：`
        + `${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    items,
    counts: {
      verified: bridge.summary.verified,
      reviewRequired: bridge.summary.reviewRequired + items.filter(
        i => i.source.kind === 'ENTITY').length,
      rejected: bridge.summary.rejected,
    },
    diagnostics,
  };
}

/**
 * 记录一条**人工**复核结论，产出不可变 Proof。
 *
 * <p>★这是全模块**唯一**能产出 Proof 的入口，且它强制要求 `subject`
 * 是人（`DOMAIN_EXPERT` / `ENGINEER`）——**机器不得代签**（ADR §3）。
 * 若允许传 `VERIFIER`，那这个函数就变成了"机器给自己发证书"。
 *
 * @param document 原文（用于按 nodeId 取 contentHash，保证 proof 锚定到
 *                 **做出判定时**的那一版内容）
 * @param nodeId   复核目标
 * @param subject  复核人身份——必须可追溯
 * @param verdict  人的结论
 * @param rationale 人的理由（自然语言，**必填**：没有理由的批准等于没有复核）
 */
export function recordHumanProof(
  document: string,
  item: ReviewItem,
  nodeId: string,
  subject: Extract<ProofSubject, { kind: 'DOMAIN_EXPERT' | 'ENGINEER' }>,
  verdict: 'VERIFIED' | 'REJECTED',
  rationale: string,
  now: string,
): Proof {
  if (rationale.trim().length === 0) {
    // ★空理由的"批准"没有任何审计价值——宁可拒绝记录，也不留一条空壳 proof。
    throw new Error('复核理由不得为空：没有理由的批准等于没有复核。');
  }

  const ir = lowerModule(parse(lex(canonicalize(document))).ast);
  const identity = computeNodeIds(ir).get(nodeId);
  if (identity === undefined) {
    throw new Error(
      `节点不存在：${nodeId}。proof 必须锚定到真实节点，`
      + '否则它记录的是一个不存在之物的结论。');
  }

  return {
    mapping: { span: item.span, text: item.text, nodeId },
    verdict,
    subject,
    rule: { id: 'human-review', version: '1' },
    // ★锚定到**做出判定时**那一版的内容指纹。内容一变，
    //   `isApplicableTo` 会算出 CONTENT_CHANGED——而不是悄悄沿用旧结论。
    verifiedAgainst: { nodeId, contentHash: identity.contentHash },
    reason: rationale,
    recordedAt: now,
  };
}
