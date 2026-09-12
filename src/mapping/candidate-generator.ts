import type { CandidateMapping } from './mapping-ir.js';

/**
 * 确定性候选映射生成器（ADR 0037 §3/§7）。
 *
 * <h2>为什么这一层不需要 AI</h2>
 *
 * ADR §3 的链路是 `LLM/启发式/人 → 候选映射 → 确定性 verifier`。但对
 * **`.aster` 源码**而言，「哪段文本对应哪个 IR 节点」这个问题**已经有确定答案**——
 * Core IR 的 `origin` 就是。实测（tier1 全语料）：
 *
 * ```
 *   字面量节点总数                        1802
 *   带 origin 的                          1802
 *   精确值 kind + 有 origin（可机械生成）  1798  (99.8%)
 * ```
 *
 * 且 `origin` 切片**逆回精确的源码文本**：
 *
 * ```
 *   Int 10000   L4C26-C31  → 源码切片 "10000"
 *   String REFER L5C12-C19 → 源码切片 "\"REFER\""
 * ```
 *
 * ★**把这 99.8% 交给概率模型是净损失**：LLM 会引入幻觉、不可复现、且需要
 * verifier 事后擦屁股，而机械读取零误差、可重放。LLM 应当被推到它真正不可
 * 替代的地方——**非 `.aster` 的人类文本**（Policy / SOP / 合同），那里没有
 * `origin` 可读。
 *
 * <h2>★前提：canonical 文本与源码逐行逐列对齐</h2>
 *
 * `origin` 记的是 **canonical 文本**的行列。本生成器直接按它切**原始源码**，
 * 前提是两者对齐——这由 ADR §4.0/§8 的一系列修复保证（运算符不再翻译成符号、
 * `is` 前缀不再改写、标点归一化不吃 `!=` 前空格），现 tier1 全语料
 * **223/223 逐行等长**。
 *
 * 若该前提被破坏，本模块会**产出错位的候选**且不报错——故
 * {@link generateCandidates} 内置了自检：切片必须非空，否则跳过并计入 `skipped`。
 */

/** 生成器需要的最小节点信息（与 `NodeIdMap` 的输出对齐）。 */
export interface OriginatedNode {
  readonly nodeId: string;
  readonly kind: string;
  /** canonical 文本中的位置，1-based 行列，`end` 为**开区间**（指向末字符之后）。 */
  readonly origin: {
    readonly start: { readonly line: number; readonly col: number };
    readonly end: { readonly line: number; readonly col: number };
  };
}

export interface GenerationResult {
  readonly candidates: readonly CandidateMapping[];
  /**
   * 被跳过的节点及原因。★**必须如实报告**——静默跳过会让调用方以为
   * 「全都生成了」，而实际上某些节点从双向导航里消失了。
   */
  readonly skipped: readonly { readonly nodeId: string; readonly why: string }[];
}

/**
 * 从「源码 + 带 origin 的节点」机械生成候选映射。
 *
 * <p>★本函数**不做任何猜测**：它只是把 `origin` 翻译成字符偏移并切片。
 * 切不出东西就跳过并记录，绝不编造。
 *
 * @param source 原始源码（与 canonical 逐行逐列对齐，见模块说明）
 * @param nodes  带 origin 的节点（通常来自 Core IR 遍历）
 */
export function generateCandidates(
  source: string,
  nodes: readonly OriginatedNode[],
): GenerationResult {
  const lineStarts = computeLineStarts(source);
  const candidates: CandidateMapping[] = [];
  const skipped: { nodeId: string; why: string }[] = [];

  for (const node of nodes) {
    const start = toOffset(lineStarts, source.length, node.origin.start.line, node.origin.start.col);
    const end = toOffset(lineStarts, source.length, node.origin.end.line, node.origin.end.col);

    if (start === undefined || end === undefined) {
      skipped.push({ nodeId: node.nodeId, why: 'origin 的行列超出源码范围' });
      continue;
    }
    if (end <= start) {
      // ★零宽或倒置区间：多半是 end 位置未被真实计算（占位值）。
      //   生成一条零宽候选毫无意义，且会让 verifier 判 REJECTED 制造噪声。
      skipped.push({ nodeId: node.nodeId, why: `区间非法或为零宽：[${start}, ${end})` });
      continue;
    }

    const text = source.slice(start, end);
    if (text.trim().length === 0) {
      // ★自检：切片全是空白说明 canonical 与源码没对齐（见模块说明的前提）。
      //   此时产出的候选必然错位——宁可跳过并报告，也不交出一条错的。
      skipped.push({ nodeId: node.nodeId, why: '切片为空白——canonical 与源码可能未对齐' });
      continue;
    }

    candidates.push({ span: { start, end }, text, nodeId: node.nodeId });
  }

  return { candidates, skipped };
}

/** 每行起始的字符偏移（`lineStarts[i]` = 第 `i+1` 行的起点）。 */
function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/**
 * 1-based 行列 → 字符偏移。越界返回 `undefined`（由调用方跳过并报告）。
 *
 * <p>★允许 `col` 指向行末之后一位（`end` 是开区间，可能正好落在行尾），
 * 但不允许越过整个源码长度。
 */
function toOffset(lineStarts: readonly number[], sourceLength: number,
                  line: number, col: number): number | undefined {
  if (!Number.isInteger(line) || !Number.isInteger(col) || line < 1 || col < 1) {
    return undefined;
  }
  if (line > lineStarts.length) return undefined;
  const offset = lineStarts[line - 1]! + (col - 1);
  return offset > sourceLength ? undefined : offset;
}

/**
 * 从 Core IR 里收集所有带 origin 的**字面量**节点。
 *
 * <p>只收字面量（带 `value` 的节点）——它们是 {@link generateCandidates} 之后
 * 能被 verifier **机械证明**的那一类。其余节点（`Call`/`If`/`Func`…）的映射
 * 需要人或 LLM 提出，不在本模块范围内。
 */
export function collectLiteralNodes(ir: unknown): OriginatedNode[] {
  const out: OriginatedNode[] = [];
  walk(ir, '$', out);
  return out;
}

function walk(node: unknown, path: string, out: OriginatedNode[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;

  if (typeof obj.kind === 'string' && 'value' in obj && isOrigin(obj.origin)) {
    out.push({ nodeId: path, kind: obj.kind, origin: obj.origin });
  }

  for (const [field, value] of Object.entries(obj)) {
    if (field === 'origin') continue;
    if (Array.isArray(value)) {
      value.forEach((el, i) => walk(el, `${path}.${field}${segmentOf(el, i)}`, out));
    } else {
      walk(value, `${path}.${field}`, out);
    }
  }
}

/** 与 `NodeIdMap.segmentOf` 同规则——路径必须与 nodeId 一致，否则两边对不上。 */
function segmentOf(element: unknown, index: number): string {
  if (element !== null && typeof element === 'object' && !Array.isArray(element)) {
    const el = element as Record<string, unknown>;
    // ★与 NodeIdMap 同规则：`_` 是占位符不是名字，必须退回下标，
    //   否则同一函数体里的多条裸表达式语句会塌成同一个 nodeId。
    if (typeof el.name === 'string' && el.name !== '_') return `{${el.name}}`;
    if (typeof el.path === 'string') return `{${el.path}}`;
  }
  return `[${index}]`;
}

function isOrigin(v: unknown): v is OriginatedNode['origin'] {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const pos = (p: unknown): boolean =>
    p !== null && typeof p === 'object'
    && typeof (p as Record<string, unknown>).line === 'number'
    && typeof (p as Record<string, unknown>).col === 'number';
  return pos(o.start) && pos(o.end);
}
