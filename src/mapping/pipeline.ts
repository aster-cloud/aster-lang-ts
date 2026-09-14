import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { parse } from '../parser.js';
import { lowerModule } from '../lower_to_core.js';
import { computeNodeIds } from '../nodeid/node-id-map.js';
import { parseSourceIr, type SourceNode } from './source-ir.js';
import { extractQuantities, type Quantity } from './quantity-ir.js';
import { generateCandidates, collectLiteralNodes } from './candidate-generator.js';
import { verifyMapping, type CandidateMapping, type VerificationResult,
  type VerifiableNode } from './mapping-ir.js';

/**
 * 可验证语义桥的**端到端接线**（ADR 0037 §7）。
 *
 * <h2>★为什么需要这个文件</h2>
 *
 * ADR 0037 建了六个模块（SourceIR / QuantityIR / MappingIR / ProofIR /
 * CandidateGenerator / EntityProposer），但**没有任何生产路径调用它们**
 * ——实测六个模块的生产调用数全为 0，也不在 `src/index.ts` 的导出面内。
 * 即：**地基铺好了，线没接**。
 *
 * <p>本文件把它们串成一条可观测的链路：
 *
 * <pre>
 *   人类文档
 *     ├─ parseSourceIr ──────────► 文档结构（Document/Section/Span）
 *     ├─ extractQuantities ──────► 数量实体（确定性，零 AI）
 *     └─ canonicalize→lex→parse→lower
 *           ├─ computeNodeIds ───► 稳定节点 ID
 *           ├─ generateCandidates► 候选映射（机械切片，不猜）
 *           └─ verifyMapping ────► 判定：VERIFIED / REVIEW_REQUIRED / REJECTED
 * </pre>
 *
 * <h2>★本模块刻意不做的事</h2>
 *
 * - **不调 LLM**。Entity 提出是三段式的第①段，需要 provider，由调用方
 *   显式传入结果（见 {@link BridgeResult.entityCandidates} 的说明）。
 *   把 LLM 调用埋进"主链路"会让一条本该确定性的流水线变得不可复现。
 * - **不产出 Proof**。`REVIEW_REQUIRED` 的候选必须由**人**给出 ProofIR
 *   （`subject = DOMAIN_EXPERT`），机器不得代签（ADR §3）。
 * - **不吞错**。任何跳过/失败都进 {@link BridgeResult.diagnostics}。
 */

/** 一条候选及其判定结果。 */
export interface VerifiedCandidate {
  readonly mapping: CandidateMapping;
  readonly result: VerificationResult;
  /**
   * 目标节点在**本次判定时**的内容指纹（`NodeIdMap` 的 contentHash）。
   *
   * <p>★**必须随候选一起交出去**：人工复核记录 Proof 时要用它锚定
   * 「当时看到的是哪一版内容」。内容一变，`isApplicableTo` 才能算出
   * `CONTENT_CHANGED` 而不是悄悄沿用旧结论。
   *
   * <p>★这个字段是**接 UI 时补的**：此前 `BridgeResult` 不含它，
   * 导致复核面板拿不到 hash、提交必被服务端拒（要求 64 位十六进制）。
   * 单测全绿也发现不了——因为没有任何测试真的走完"取候选 → 提交结论"。
   * 又一次「验了对象，没验连线」。
   *
   * <p>节点不在 NodeIdMap 中时为 `undefined`（正常情况下不会发生，
   * 真发生了 diagnostics 里会有「路径口径可能漂移」）。
   */
  readonly contentHash: string | undefined;
}

/** 端到端结果。★所有"没做成"的事都在 `diagnostics` 里，不静默丢弃。 */
export interface BridgeResult {
  /** 文档结构（人类视角）。源文本无法解析时为 `undefined`。 */
  readonly sourceIr: SourceNode | undefined;
  /** 确定性抽取的数量实体。 */
  readonly quantities: readonly Quantity[];
  /** 候选映射及其判定。 */
  readonly verified: readonly VerifiedCandidate[];
  /** 按判定分组的计数——UI 的复核队列直接用这个。 */
  readonly summary: {
    readonly verified: number;
    readonly reviewRequired: number;
    readonly rejected: number;
  };
  /**
   * 过程中所有「没做成」的事：解析失败、节点被跳过、区间切不出来……
   *
   * <p>★**必须如实报告**。静默跳过会让调用方以为「全都生成了」，
   * 而实际上某些节点从双向导航里消失了——那种缺失极难发现。
   */
  readonly diagnostics: readonly string[];
}

/**
 * 跑通「人类文档 → 结构化 → 抽取 → 候选 → 验证」全链路。
 *
 * <p>★`source` 必须是**可编译的 Aster 源码**。对于"任意文字"，当前的定位是：
 * SourceIR 与 QuantityIR 对任意文本都能工作（它们只依赖形态特征），
 * 而候选映射与验证需要源码能 lower 成 Core IR。两者在本函数里**分别降级**
 * ——编译不了时仍返回文档结构与数量实体，并在 diagnostics 里说明原因。
 */
export function runSemanticBridge(source: string): BridgeResult {
  const diagnostics: string[] = [];

  // ── 第 1 层：人类文档结构（对任意文本都成立）──────────────────
  let sourceIr: SourceNode | undefined;
  try {
    sourceIr = parseSourceIr(source);
  } catch (e) {
    diagnostics.push(`SourceIR 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 第 2 层：确定性数量抽取（对任意文本都成立，零 AI）─────────
  let quantities: readonly Quantity[] = [];
  try {
    quantities = extractQuantities(source);
  } catch (e) {
    diagnostics.push(`QuantityIR 抽取失败：${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 第 3 层：候选映射 + 验证（需要源码可编译）─────────────────
  // ★这一层**会失败**，且失败是常态（任意文字不是合法 Aster 源码）。
  //   失败时前两层的结果仍然有效——这正是分层降级的意义。
  let verified: readonly VerifiedCandidate[] = [];
  try {
    const canonical = canonicalize(source);
    const ir = lowerModule(parse(lex(canonical)).ast);

    const identities = computeNodeIds(ir);
    const nodes = collectLiteralNodes(ir);
    if (nodes.length === 0) {
      diagnostics.push('IR 里没有带 origin 的字面量节点——无候选可生成。');
    }

    const generated = generateCandidates(canonical, nodes);
    for (const s of generated.skipped) {
      diagnostics.push(`跳过节点 ${s.nodeId}：${s.why}`);
    }

    // ★`resolve` 的节点必须从 **IR 本身**取值，不能从 NodeIdentity 取。
    //
    //   我第一版从 `computeNodeIds` 的返回值里读 `value`/`name`——实测
    //   `NodeIdentity` 只有 `{nodeId, contentHash, kind}`，**根本没有 value**，
    //   于是 `verifyMapping` 拿不到值、把每条候选都判成 REJECTED。
    //   端到端 demo 一跑就暴露了（2 条候选全 REJECTED，而它们本该 VERIFIED）。
    //   ★这也说明"接线"本身必须端到端验证——单看两侧模块的单测都是绿的。
    const byId = collectVerifiableNodes(ir);
    // identities 仅用于校验路径口径一致（两边都由同一套 segmentOf 规则生成）。
    for (const id of byId.keys()) {
      if (!identities.has(id)) {
        diagnostics.push(`节点 ${id} 不在 NodeIdMap 中——路径口径可能漂移。`);
      }
    }

    verified = generated.candidates.map(mapping => ({
      mapping,
      result: verifyMapping(mapping, id => byId.get(id)),
      contentHash: identities.get(mapping.nodeId)?.contentHash,
    }));
  } catch (e) {
    // ★不把编译失败当成错误——"任意文字"本就编译不了。
    //   如实记录，让调用方知道第 3 层没跑，而不是以为跑了但没结果。
    diagnostics.push(
      `源码无法编译成 Core IR，候选映射层已跳过：`
      + `${e instanceof Error ? e.message : String(e)}`);
  }

  let v = 0, r = 0, j = 0;
  for (const c of verified) {
    if (c.result.verdict === 'VERIFIED') v++;
    else if (c.result.verdict === 'REVIEW_REQUIRED') r++;
    else j++;
  }

  return {
    sourceIr,
    quantities,
    verified,
    summary: { verified: v, reviewRequired: r, rejected: j },
    diagnostics,
  };
}

/**
 * 按与 {@link collectLiteralNodes} **完全相同**的路径规则遍历 IR，
 * 产出 `nodeId → VerifiableNode`（带 `value`/`name`）。
 *
 * <p>★为什么不复用 `computeNodeIds` 的返回值：`NodeIdentity` 只有
 * `{nodeId, contentHash, kind}`，**不含 value**。用它做 `resolve` 会让
 * `verifyMapping` 永远比不出值，把所有候选判成 REJECTED。
 *
 * <p>★路径规则必须与 `collectLiteralNodes` / `NodeIdMap` **三方一致**，
 * 否则候选的 nodeId 与这里的键对不上——那种错会表现为"节点不存在"，
 * 极易被误读成 IR 有问题。
 */
function collectVerifiableNodes(ir: unknown): Map<string, VerifiableNode> {
  const out = new Map<string, VerifiableNode>();
  walkVerifiable(ir, '$', out);
  return out;
}

function walkVerifiable(node: unknown, path: string, out: Map<string, VerifiableNode>): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;

  if (typeof obj.kind === 'string') {
    out.set(path, {
      kind: obj.kind,
      ...(obj.value === undefined ? {} : { value: obj.value }),
      ...(typeof obj.name === 'string' ? { name: obj.name } : {}),
    });
  }

  for (const [field, value] of Object.entries(obj)) {
    if (field === 'origin') continue;
    if (Array.isArray(value)) {
      value.forEach((el, i) => walkVerifiable(el, `${path}.${field}${segmentOfPath(el, i)}`, out));
    } else {
      walkVerifiable(value, `${path}.${field}`, out);
    }
  }
}

/** 与 `collectLiteralNodes.segmentOf` / `NodeIdMap.segmentOf` 同规则（三方必须一致）。 */
function segmentOfPath(element: unknown, index: number): string {
  if (element !== null && typeof element === 'object' && !Array.isArray(element)) {
    const el = element as Record<string, unknown>;
    if (typeof el.name === 'string' && el.name !== '_') return `{${el.name}}`;
    if (typeof el.path === 'string') return `{${el.path}}`;
  }
  return `[${index}]`;
}
