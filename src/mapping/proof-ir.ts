import type { CandidateMapping, VerificationVerdict } from './mapping-ir.js';

/**
 * ProofIR —— 「这条映射为什么成立」的**不可变**记录（ADR 0037 §2/§6.1）。
 *
 * <h2>回答 ADR §2 提出的五个问题</h2>
 *
 * ```
 *   为什么认为这条映射成立？   → rule（判定规则）+ reason（依据）
 *   谁验证的？                 → subject（主体）
 *   使用什么规则？             → rule
 *   对应哪个版本？             → verifiedAgainst.contentHash
 *   现在是否仍然有效？         → isApplicableTo()（算出来，不是存出来）
 * ```
 *
 * <h2>★失效语义：不可变 + 水位线（ADR §6.1）</h2>
 *
 * 沿用本仓既有先例（BYOK 的 `byokQuotaResetAt` 水位线、`audit-log` 的只追加）：
 *
 * ```
 *   proof 记录本身   不可变、只追加     ← 「当时确实验证过」是历史事实
 *   proof 的有效性   由内容指纹算出     ← 不改写历史，只判定「对当前版本是否适用」
 * ```
 *
 * ★**为什么不能原地标 stale**：proof 的价值就在于「在某个确定版本上、由某个
 * 确定主体、按某条确定规则验证过」。原地改写会**销毁这条历史事实**——下次
 * 审计无法回答「那次到底验没验过」。这与本仓审计链不可改写的既有立场一致。
 */

/** 谁做出的判定。 */
export type ProofSubject =
  /** 确定性 verifier（机器证明）。`by` 记模块标识与算法版本。 */
  | { readonly kind: 'VERIFIER'; readonly by: string }
  /** 领域专家（业务语义确认）。`by` 记可追溯的身份标识。 */
  | { readonly kind: 'DOMAIN_EXPERT'; readonly by: string }
  /** 程序员（技术语义确认）。 */
  | { readonly kind: 'ENGINEER'; readonly by: string };

/**
 * 判定所依据的规则。
 *
 * <p>★与 `subject` **分开**记录：同一个主体可以按不同规则做判定，而「按哪条
 * 规则」恰恰是审计时最需要回答的。把它揉进 subject 会让两者都说不清楚。
 */
export interface ProofRule {
  /** 规则标识，如 `exact-value` / `domain-review` 。 */
  readonly id: string;
  /** 规则版本——规则本身会演进，旧 proof 必须能说清「当时用的是哪一版」。 */
  readonly version: string;
}

/** proof 锚定的目标：某个版本的某个节点。 */
export interface ProofAnchor {
  readonly nodeId: string;
  /** 做出判定时该节点子树的内容指纹（`NodeIdMap` 的 contentHash）。 */
  readonly contentHash: string;
}

/** 一条**不可变**的 proof 记录。 */
export interface Proof {
  readonly mapping: CandidateMapping;
  readonly verdict: VerificationVerdict;
  readonly subject: ProofSubject;
  readonly rule: ProofRule;
  readonly verifiedAgainst: ProofAnchor;
  /** 人类可读依据（verifier 的 reason，或人工复核的说明）。 */
  readonly reason: string;
  /**
   * 记录时间（ISO 8601）。★由调用方传入而非本模块取系统时钟——
   * 取时钟会让同一输入产出不同记录，无法复现、无法测试。
   */
  readonly recordedAt: string;
}

/** proof 对当前版本是否仍适用。 */
export type Applicability =
  /** 目标节点内容未变 → 当时的判定对现在仍然成立。 */
  | { readonly applicable: true }
  /** 目标节点内容已变 → 需重新验证。**不代表**当时的判定是错的。 */
  | { readonly applicable: false; readonly why: 'CONTENT_CHANGED'; readonly currentHash: string }
  /** 目标节点已不存在 → 需重新验证。 */
  | { readonly applicable: false; readonly why: 'NODE_GONE' };

/**
 * 判定一条 proof 对**当前**版本是否仍适用。
 *
 * <p>★这是**算出来**的，不是存出来的——proof 记录本身永不修改。
 *
 * @param currentHashOf 按 nodeId 取当前 contentHash；`undefined` 表示节点已不存在
 */
export function isApplicableTo(
  proof: Proof,
  currentHashOf: (nodeId: string) => string | undefined,
): Applicability {
  const current = currentHashOf(proof.verifiedAgainst.nodeId);
  if (current === undefined) {
    return { applicable: false, why: 'NODE_GONE' };
  }
  if (current !== proof.verifiedAgainst.contentHash) {
    return { applicable: false, why: 'CONTENT_CHANGED', currentHash: current };
  }
  return { applicable: true };
}

/**
 * 从一组 proof 中选出对当前版本**有效**的那条。
 *
 * <h2>★仲裁规则（本仓当前的决定）</h2>
 *
 * 同一个 `(span, nodeId)` 上可能存在多条 proof（机器验过一次、专家又复核过一次、
 * 内容变了之后重新验过…）。规则：
 *
 * 1. **只考虑对当前版本仍适用的**（内容指纹匹配）——不适用的直接出局。
 * 2. 在仍适用的里面，**取 `recordedAt` 最新的一条**。
 *
 * ★**为什么不按主体优先级**（例如「专家 > 机器」）：那需要先定义一个跨主体的
 * 权威序，而这是**产品/合规决策**，不是技术决策。在它被明确之前，按时间取最新
 * 是唯一不需要额外假设的规则——「最近一次复核的结论」本身就是一个可辩护的默认。
 *
 * <p>⚠️ 若将来引入主体优先级，必须同时回答：机器判 REJECTED 而专家判 VERIFIED
 * 时谁赢？本模块**刻意不猜**——`conflicts` 字段把并存的分歧如实暴露给调用方。
 */
export function resolveEffective(
  proofs: readonly Proof[],
  currentHashOf: (nodeId: string) => string | undefined,
): { readonly effective?: Proof; readonly conflicts: readonly Proof[] } {
  const applicable = proofs.filter(p => isApplicableTo(p, currentHashOf).applicable);
  if (applicable.length === 0) {
    return { conflicts: [] };
  }

  // 按时间降序；时间相同则保持输入顺序（稳定排序），避免引入隐式随机性。
  const sorted = [...applicable].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const effective = sorted[0]!;

  // 结论不同的其余 proof = 真实分歧，如实暴露，不静默吞掉。
  const conflicts = sorted.slice(1).filter(p => p.verdict !== effective.verdict);
  return { effective, conflicts };
}
