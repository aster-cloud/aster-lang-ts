/**
 * 规范化文本上的标识符段（run）在原文中的位置，由 canonicalize 自身证明（ADR 0058 §8.2 词汇规范预览用）。
 *
 * ★为什么不用 source-positions 的逐行顺序查找：规范化会删冠词、转写关键词、全角转半角，
 *   顺序查找只找「本行下一处同样文字」。`Return a a.` 删掉的是第一个 `a`（冠词），真正的值是第二个，
 *   顺序查找却落在第一个上——预览按它替换就会换错词，预览文本不带词汇编译失败或含义改变。
 *
 * 做法（探针替换）：把原文里的候选词换成源码中不存在的探针名，再走同一个 canonicalize。
 * 某行的输出与原规范化文本逐段一致（标识符段数、段间文字都相同，只有探针所在的段不同），
 * 探针落在第 k 段，就证明了这个原文位置的词经规范化成为该行第 k 段。探针名不是冠词、不是关键词，
 * 不会被删除或转写；候选是被删的冠词时，换成探针后它留了下来，该行段数对不上，证明失败而不是认错。
 * - 先把所有候选一次性换成探针（一次 canonicalize），逐行核对；
 * - 核对失败的行（多半是同形词里有被删的冠词）再逐个候选单独探测：各行的第 r 个候选在第 r 轮一起探测，
 *   每轮一次 canonicalize，轮数有上限，与文档大小无关；
 * - 某段恰有一个候选被证明才算找到，否则给 undefined，调用方不替换（不猜位置）。
 *
 * canonicalize 保持行数不变、且各步都在行内进行（冠词判定只看本行前后词），所以按行核对是可靠的。
 * 偏移一律是 UTF-16 code unit。
 */
import { foldKey } from '../config/lexicons/identifiers/casefold.js';

/** 原文中的 UTF-16 区间 [start, end) */
export type OffsetRange = readonly [number, number];

/** 规范化文本上的一个标识符段：行号 1 起，列为该行内的 UTF-16 偏移（0 起） */
export interface RunTarget {
  readonly line: number;
  readonly col: number;
}

/** 首轮核对失败后，逐候选探测的最多轮数（每轮一次整篇 canonicalize）；同一行同形候选超出轮数的不再证明 */
export const SINGLE_PROBE_ROUNDS = 8;

/** 与 canonicalizer 的 identifierTokenRegex 同一切分口径（字面量宏、转写都按它切词） */
const IDENT_RUN = /[\p{L}_][\p{L}\p{M}\p{Nd}_]*/gu;

interface Run {
  readonly at: number;
  readonly text: string;
}

/** 一行的标识符段与段间文字：seps.length === runs.length + 1 */
interface Pieces {
  readonly runs: readonly Run[];
  readonly seps: readonly string[];
}

function piecesOf(line: string): Pieces {
  const runs: Run[] = [];
  const seps: string[] = [];
  let cursor = 0;
  for (const m of line.matchAll(IDENT_RUN)) {
    seps.push(line.slice(cursor, m.index));
    runs.push({ at: m.index, text: m[0] });
    cursor = m.index + m[0].length;
  }
  seps.push(line.slice(cursor));
  return { runs, seps };
}

/** 各行在原文中的起点与文字（换行按 \r\n、\r、\n 切分，与 canonicalize 一致） */
function lineTable(source: string): Array<{ start: number; text: string }> {
  const lines: Array<{ start: number; text: string }> = [];
  const re = /\r\n|\r|\n/g;
  let start = 0;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    lines.push({ start, text: source.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  lines.push({ start, text: source.slice(start) });
  return lines;
}

/** 原文中的一个候选词，probe 为它的探针名 */
interface Candidate {
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly probe: string;
}

/**
 * 逐个目标给出其在原文中的区间（证明不了的为 undefined）。
 * `canonical` 须等于 `recanonicalize(source)`；`sameWord(原文词, 规范化段)` 只用来挑候选
 * （宽松即可：证明由探针完成），通常比较折叠键与该词单独规范化后的形态。
 */
export function proveRunSources(
  source: string,
  canonical: string,
  recanonicalize: (text: string) => string,
  targets: readonly RunTarget[],
  sameWord: (sourceRun: string, canonicalRun: string) => boolean,
): Array<OffsetRange | undefined> {
  const original = lineTable(source);
  const canLines = canonical.split('\n');
  if (targets.length === 0 || canLines.length !== original.length) return targets.map(() => undefined);
  const canPieces = new Map<number, Pieces>();
  const piecesAt = (line: number): Pieces => {
    let p = canPieces.get(line);
    if (!p) canPieces.set(line, (p = piecesOf(canLines[line - 1] ?? '')));
    return p;
  };
  // 目标 → 所在行的段下标；不落在段起点上的目标无从证明
  const targetRun = targets.map((t) => piecesAt(t.line).runs.findIndex((r) => r.at === t.col));

  let base = 'zqv';
  while (source.includes(base)) base += 'q';
  // 各行要找的段文字；候选 = 该行原文里与其中某段同词的标识符段
  const wantedByLine = new Map<number, string[]>();
  targets.forEach((t, i) => {
    if (targetRun[i]! < 0) return;
    const text = piecesAt(t.line).runs[targetRun[i]!]!.text;
    const wanted = wantedByLine.get(t.line);
    if (wanted) wanted.push(text);
    else wantedByLine.set(t.line, [text]);
  });
  const candidates: Candidate[] = [];
  const byLine = new Map<number, Candidate[]>();
  for (const [line, wanted] of wantedByLine) {
    const orig = original[line - 1]!;
    const own: Candidate[] = [];
    for (const r of piecesOf(orig.text).runs) {
      if (!wanted.some((w) => sameWord(r.text, w))) continue;
      const start = orig.start + r.at;
      own.push({ line, start, end: start + r.text.length, probe: `${base}${candidates.length + own.length}x` });
    }
    candidates.push(...own);
    byLine.set(line, own);
  }

  // 候选 → 被证明对应的段下标。首轮全部候选一起探测；核对失败的行之后每轮只探测其中一个候选，
  // 各行的第 r 个候选在第 r 轮一起探测（各行互不影响），轮数有上限
  const proven = new Map<Candidate, number>();
  const failed = probeRound(source, canLines, recanonicalize, candidates, byLine, piecesAt, proven);
  for (let r = 0; r < SINGLE_PROBE_ROUNDS; r++) {
    // 从行尾往前探：被删的冠词总在它修饰的词之前，编译器用的同形词多在后面
    const round = [...failed].flatMap((line) => byLine.get(line)!.slice().reverse().slice(r, r + 1));
    if (round.length === 0) break;
    probeRound(source, canLines, recanonicalize, round, byLine, piecesAt, proven);
  }

  return targets.map((t, i) => {
    const hits = (byLine.get(t.line) ?? []).filter((c) => proven.get(c) === targetRun[i]);
    return hits.length === 1 ? [hits[0]!.start, hits[0]!.end] : undefined;
  });
}

/** 原文中把候选词换成各自的探针名 */
function withProbes(source: string, probes: readonly Candidate[]): string {
  let out = '';
  let cursor = 0;
  for (const c of [...probes].sort((a, b) => a.start - b.start)) {
    out += source.slice(cursor, c.start) + c.probe;
    cursor = c.end;
  }
  return out + source.slice(cursor);
}

/**
 * 探测后的一行与原规范化行逐段核对：段数、段间文字相同，非探针段文字相同。
 * 成功时返回 探针名 → 段下标，否则 null。
 */
function matchLine(expected: Pieces, probedLine: string, probes: ReadonlySet<string>): Map<string, number> | null {
  const got = piecesOf(probedLine);
  if (got.runs.length !== expected.runs.length || got.seps.some((s, k) => s !== expected.seps[k])) return null;
  const found = new Map<string, number>();
  for (const [k, r] of got.runs.entries()) {
    if (probes.has(r.text)) found.set(r.text, k);
    else if (r.text !== expected.runs[k]!.text) return null;
  }
  return found;
}

/**
 * 一轮探测：把本轮候选一起换成探针、规范化一次，逐行核对。返回核对失败的行号。
 * 本行的探针只能出现在本行（别的行的探针跑到本行，说明本行受了别处影响，不可信）。
 */
function probeRound(
  source: string,
  canLines: readonly string[],
  recanonicalize: (text: string) => string,
  round: readonly Candidate[],
  byLine: ReadonlyMap<number, readonly Candidate[]>,
  piecesAt: (line: number) => Pieces,
  proven: Map<Candidate, number>,
): Set<number> {
  const lines = new Set(round.map((c) => c.line));
  if (round.length === 0) return lines;
  let probedLines: string[];
  try {
    probedLines = recanonicalize(withProbes(source, round)).split('\n');
  } catch {
    return lines;
  }
  if (probedLines.length !== canLines.length) return lines;
  const allProbes = new Set([...byLine.values()].flat().map((c) => c.probe));
  const roundByLine = new Map<number, Candidate[]>();
  for (const c of round) {
    const own = roundByLine.get(c.line);
    if (own) own.push(c);
    else roundByLine.set(c.line, [c]);
  }
  const failed = new Set<number>();
  for (const [line, own] of roundByLine) {
    const found = matchLine(piecesAt(line), probedLines[line - 1] ?? '', allProbes);
    if (!found || [...found.keys()].some((p) => !own.some((c) => c.probe === p))) {
      failed.add(line);
      continue;
    }
    for (const c of own) {
      const k = found.get(c.probe);
      if (k !== undefined) proven.set(c, k);
    }
  }
  return failed;
}

/** 候选筛选的默认口径：折叠键相同，或该词单独规范化（转写、全角转半角）后折叠键相同 */
export function sameWordUnder(canonicalizeWord: (word: string) => string): (sourceRun: string, canonicalRun: string) => boolean {
  const cache = new Map<string, string>();
  const key = (s: string): string => foldKey(s.normalize('NFKC'));
  return (sourceRun, canonicalRun) => {
    const want = key(canonicalRun);
    if (key(sourceRun) === want) return true;
    let alone = cache.get(sourceRun);
    if (alone === undefined) {
      try {
        alone = key(canonicalizeWord(sourceRun).trim());
      } catch {
        alone = '';
      }
      cache.set(sourceRun, alone);
    }
    return alone === want;
  };
}
