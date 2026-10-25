import type { CandidateMapping } from './mapping-ir.js';
import { forEachIrNode } from '../nodeid/node-id-map.js';

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
 * <h2>★坐标系：先在 canonical 文本上切，再重定位回原文</h2>
 *
 * `origin` 记的是 **canonical 文本**的行列。canonicalize 保持行数不变，但会改变行内长度
 * （英文删冠词、de 转写关键字、zh 括号函数头重排等），所以 canonical 偏移不能直接当原文偏移用。
 * {@link generateCandidates} 在 canonical 上切出文本，{@link relocateToSource} 再在原文同一行里
 * 找到同一段文本（按该行内的出现序号对应），产出**原文坐标**的候选——调用方（复核面板、
 * 双向导航）拿到的区间一律指向用户自己的文档。找不到就跳过并报告，绝不推算。
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
 * @param source canonical 文本（origin 的行列以它为准）；结果须再经 {@link relocateToSource}
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
    const start = toOffset(lineStarts, source.length, node.origin.start.line, node.origin.start.col, false);
    const end = toOffset(lineStarts, source.length, node.origin.end.line, node.origin.end.col, true);

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
 * <p>★`end` 是开区间，允许正好落在行尾（`allowLineEnd`）；`start` 必须指向该行的真实字符。
 * 二者都不允许越过**该行**的行尾——否则切片会静默跨进下一行。
 */
function toOffset(lineStarts: readonly number[], sourceLength: number,
                  line: number, col: number, allowLineEnd: boolean): number | undefined {
  if (!Number.isInteger(line) || !Number.isInteger(col) || line < 1 || col < 1) {
    return undefined;
  }
  if (line > lineStarts.length) return undefined;
  const lineStart = lineStarts[line - 1]!;
  const lineEnd = line < lineStarts.length ? lineStarts[line]! - 1 : sourceLength;
  const offset = lineStart + (col - 1);
  return offset > lineEnd || (offset === lineEnd && !allowLineEnd) ? undefined : offset;
}

/**
 * 把 canonical 坐标的候选重定位到原文坐标。
 *
 * <p>做法：候选起点所在行号在两边相同（canonicalize 保持行数）。数出候选文本在 canonical
 * 该行内、起点之前出现了几次，再在原文同一行里取同序号的出现位置。字面量文本（数字、带引号的
 * 字符串、布尔）不被 canonicalize 改写，所以序号一一对应。
 *
 * <p>★任何对不上的情况都跳过并报告：两边行数不同、该文本在两边同一行的出现次数不同
 * （canonicalize 增删了同样的子串，如智能引号归一化后 `“x” plus "x"` 多出一个 `"x"`，
 * 按序号配对会配错）、原文该行找不到该文本。宁可少一条候选，也不交出一条指错位置的。
 */
export function relocateToSource(
  source: string,
  canonical: string,
  generated: GenerationResult,
): GenerationResult {
  const canStarts = computeLineStarts(canonical);
  const srcStarts = computeLineStarts(source);
  const skipped = [...generated.skipped];
  if (canStarts.length !== srcStarts.length) {
    for (const c of generated.candidates) {
      skipped.push({ nodeId: c.nodeId, why: `原文与 canonical 行数不同（${srcStarts.length} ≠ ${canStarts.length}），无法定位原文位置` });
    }
    return { candidates: [], skipped };
  }

  const candidates: CandidateMapping[] = [];
  for (const c of generated.candidates) {
    const line = lineIndexOf(canStarts, c.span.start);
    const canLineEnd = line + 1 < canStarts.length ? canStarts[line + 1]! - 1 : canonical.length;
    const lineEnd = line + 1 < srcStarts.length ? srcStarts[line + 1]! - 1 : source.length;
    const canCount = countOccurrences(canonical, c.text, canStarts[line]!, canLineEnd + 1);
    const srcCount = countOccurrences(source, c.text, srcStarts[line]!, lineEnd + 1);
    if (canCount !== srcCount) {
      skipped.push({ nodeId: c.nodeId, why: `候选文本 ${JSON.stringify(c.text)} 在第 ${line + 1} 行的出现次数不同（原文 ${srcCount}，canonical ${canCount}），无法唯一定位` });
      continue;
    }
    const ordinal = countOccurrences(canonical, c.text, canStarts[line]!, c.span.start);
    // 两边次数相等且候选自身就是 canonical 该行的第 ordinal 次出现，故原文必有第 ordinal 次。
    const start = nthOccurrence(source, c.text, srcStarts[line]!, lineEnd, ordinal)!;
    candidates.push({ ...c, span: { start, end: start + c.text.length } });
  }
  return { candidates, skipped };
}

/** 偏移所在的行（0-based）。 */
function lineIndexOf(lineStarts: readonly number[], offset: number): number {
  let line = 0;
  while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= offset) line++;
  return line;
}

/** `text` 在 `[from, to)` 内起始的出现次数（允许重叠，与 {@link nthOccurrence} 同口径）。 */
function countOccurrences(s: string, text: string, from: number, to: number): number {
  let n = 0;
  for (let i = s.indexOf(text, from); i !== -1 && i < to; i = s.indexOf(text, i + 1)) n++;
  return n;
}

/** 起点落在 `[from, lineEnd]` 内的第 `ordinal` 次（0-based）出现；没有则为 `undefined`。 */
function nthOccurrence(s: string, text: string, from: number, lineEnd: number, ordinal: number): number | undefined {
  let n = 0;
  for (let i = s.indexOf(text, from); i !== -1 && i <= lineEnd; i = s.indexOf(text, i + 1)) {
    if (n === ordinal) return i;
    n++;
  }
  return undefined;
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
  forEachIrNode(ir, (node, nodeId) => {
    if ('value' in node && isOrigin(node.origin)) {
      out.push({ nodeId, kind: node.kind as string, origin: node.origin });
    }
  });
  return out;
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
