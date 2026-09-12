import type { LLMProvider } from '../ai/llm-provider.js';
import type { EntityCandidate } from './quantity-ir.js';
import type { SourceNode } from './source-ir.js';

/**
 * Entity 提出器 —— 三段式的**第一段**（ADR 0037 §3/§11.5）。
 *
 * <h2>三段式分工，本模块只占第一段</h2>
 *
 * ```
 *   ① LLM 提出        ← 本模块。产出 EntityCandidate，**没有任何判定力**
 *   ② verifier 判定    ← verifyEntityCandidate()，对 Entity 恒给 REVIEW_REQUIRED
 *   ③ 人复核          ← 由人给出 ProofIR（subject=DOMAIN_EXPERT）
 * ```
 *
 * ★ADR §3 的原话是「**AI 可以提出映射，但不能定义什么叫正确**」。本模块把这条
 * 写进类型：它的返回类型是 `EntityCandidate`（候选），**不是** `Proof`（结论）。
 * 调用方拿不到任何「已验证」的东西——那必须由人在第③段给出。
 *
 * <h2>★为什么 Entity 必须走 LLM，而 Quantity 不必</h2>
 *
 * 实测（ADR §11.1）：金额/百分比/时长/日期有稳定形态特征，正则抽取 100%；
 * 而「财务经理」与「财务报表」在字符层面**无从区分**——只能靠语义识别。
 *
 * <h2>★本模块刻意不做的事</h2>
 *
 * - **不定义类别体系**。`proposedKind` 是 LLM 给的自由字符串，本模块不校验、
 *   不归一化、不映射到枚举。理由：类别体系是**领域决策**，由第③段的人确定；
 *   过早把它固化成枚举，会让 LLM 的输出被硬塞进错误的格子里。
 * - **不判定对错**。见 {@link verifyEntityCandidate}。
 * - **不重试/不自我修正**。LLM 返回什么就记什么；格式不合规的条目直接丢弃并
 *   计入 `rejected`，绝不「猜一下它想说什么」。
 */

/** 一次提出的完整结果——★包含被丢弃的条目，便于审计「LLM 到底说了什么」。 */
export interface ProposalResult {
  readonly candidates: readonly EntityCandidate[];
  /**
   * 被丢弃的原始条目及原因。
   *
   * <p>★**必须如实报告**：静默丢弃会让「LLM 产出了不合规内容」这件事消失，
   * 而那恰恰是评估 LLM 可靠性最重要的信号。
   */
  readonly rejected: readonly { readonly raw: string; readonly why: string }[];
  /** 用于 ProofIR 的主体标识，形如 `llm:anthropic/claude-...`。 */
  readonly proposedBy: string;
}

const SYSTEM_PROMPT = `你是一个文本标注助手。给定一段政策文档，找出其中的**语义实体**
（角色、主体、义务等），逐条输出。

严格要求：
1. 只输出 JSON 数组，不要任何解释性文字、不要 Markdown 代码围栏。
2. 每条格式：{"text":"原文片段","kind":"类别","start":起始字符偏移}
3. "text" 必须是文档里**逐字节存在**的片段，不得改写、不得补全、不得翻译。
4. "start" 必须是该片段在文档中的**字符偏移**（从 0 开始）。
5. "kind" 用你认为最贴切的英文类别名（如 Role、Party、Obligation），不要臆造复杂结构。
6. **不确定就不要输出**。宁可少，不可错。
7. 不要输出金额、百分比、日期、时长——那些由另一个确定性模块处理。`;

/**
 * 让 LLM 提出 Entity 候选。
 *
 * <p>★返回的每一条都会被**机械校验**：`text` 必须在 `document` 的声明位置上
 * 逐字节存在。对不上的直接丢弃并计入 `rejected`——这是防 LLM 幻觉的第一道闸，
 * 且它是**确定性**的，不依赖模型自觉。
 *
 * @param scope 可选：只在某个 SourceIR 节点范围内提出（如只看「## 审批」一节）
 */
export async function proposeEntities(
  document: string,
  provider: LLMProvider,
  scope?: SourceNode,
): Promise<ProposalResult> {
  const proposedBy = `llm:${provider.getName()}/${provider.getModel()}`;
  const region = scope === undefined
    ? { start: 0, end: document.length }
    : { start: scope.span.start, end: scope.span.end };
  const text = document.slice(region.start, region.end);

  const response = await provider.generate({
    prompt: text,
    systemPrompt: SYSTEM_PROMPT,
    // ★temperature 0：同一文档反复提出应得到同样结果。候选生成的**可复现性**
    //   是审计的前提——否则「上次为什么提了这条」永远说不清。
    temperature: 0,
  });

  return parseProposals(response.content, document, region.start, proposedBy);
}

/**
 * 解析 LLM 的输出并**逐条机械校验**。
 *
 * <p>导出供测试直接调用——不必真的打 LLM 就能验证解析与校验逻辑。
 *
 * @param offsetBase scope 起点在原文中的偏移（LLM 看到的是切片，偏移要平移回去）
 */
export function parseProposals(
  raw: string,
  document: string,
  offsetBase: number,
  proposedBy: string,
): ProposalResult {
  const candidates: EntityCandidate[] = [];
  const rejected: { raw: string; why: string }[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return { candidates: [], rejected: [{ raw, why: '整体不是合法 JSON' }], proposedBy };
  }
  if (!Array.isArray(parsed)) {
    return { candidates: [], rejected: [{ raw, why: '顶层不是数组' }], proposedBy };
  }

  for (const item of parsed) {
    const asText = JSON.stringify(item);
    if (item === null || typeof item !== 'object') {
      rejected.push({ raw: asText, why: '条目不是对象' });
      continue;
    }
    const o = item as Record<string, unknown>;
    if (typeof o.text !== 'string' || o.text.length === 0
        || typeof o.kind !== 'string' || o.kind.length === 0
        || typeof o.start !== 'number' || !Number.isInteger(o.start)) {
      rejected.push({ raw: asText, why: '缺少 text/kind/start 或类型不对' });
      continue;
    }

    const start = offsetBase + o.start;
    const end = start + o.text.length;

    // ★核心闸门：声称的位置上必须**逐字节**是那段文本。
    //   LLM 最常见的幻觉是「文本对但位置错」或「位置对但文本被改写过」，
    //   两者都会让后续的双向导航指向错误的地方。此处一律丢弃，不做纠正。
    if (end > document.length || document.slice(start, end) !== o.text) {
      rejected.push({
        raw: asText,
        why: `位置 ${start} 上的实际文本是 ${JSON.stringify(document.slice(start, end))}，`
          + `与声称的 ${JSON.stringify(o.text)} 不符`,
      });
      continue;
    }

    candidates.push({
      span: { start, end },
      text: o.text,
      proposedKind: o.kind,
      proposedBy,
    });
  }

  return { candidates, rejected, proposedBy };
}

/** LLM 常在 JSON 外面套 ```json 围栏，尽管 prompt 里已要求不要。 */
function stripCodeFence(s: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(s);
  return m === null ? s.trim() : m[1]!.trim();
}

/**
 * 对 Entity 候选的**确定性判定** —— 三段式的第②段。
 *
 * <p>★**恒返回 `REVIEW_REQUIRED`**，这不是偷懒，是 ADR §3/§5.1 的直接结论：
 *
 * - Entity 的目标是**语义**对应（「财务经理」↔ `Role.FinanceManager`），
 *   而 verifier 只能读 `kind`/`value`/`name`/`origin`/`nodeId`——
 *   **类型层是两引擎合法分叉的层，不在可依赖范围内**（ADR §5.1）。
 * - 机器能做的只有「这段文本确实存在于此」（已在 {@link parseProposals} 做过），
 *   证明不了「它确实指代那个角色」。
 *
 * <p>★把它写成一个**显式函数**而不是省略，是为了让三段式在代码里可见：
 * 谁也不能跳过第②段直接把 LLM 输出当结论。
 */
export function verifyEntityCandidate(candidate: EntityCandidate): {
  readonly verdict: 'REVIEW_REQUIRED';
  readonly reason: string;
} {
  return {
    verdict: 'REVIEW_REQUIRED',
    reason: `Entity「${candidate.text}」的类别 ${candidate.proposedKind} 属**语义**判断，`
      + '机器只能确认该文本存在于声称位置，证明不了它指代该实体 —— 须领域专家确认。',
  };
}
