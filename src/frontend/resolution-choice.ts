/**
 * @module frontend/resolution-choice
 *
 * 名称解析 R1 / R2 共用的候选选择规则（ADR 0051 §6.2）：精确优先、折叠唯一、
 * 同层多个不同规范名即歧义；源码声明按原写法与规范名双向匹配；词汇后接规范名直写。
 */
import { compareCodePoints, foldKey, nfc } from '../config/lexicons/identifiers/casefold.js';
import { lookup } from '../config/lexicons/identifiers/scopes.js';
import type { Candidate } from '../config/lexicons/identifiers/scopes.js';
import type { ResolvedRole } from '../types.js';

/** 参与匹配的一项：written 为可匹配的写法，canonical 为命中后的规范名。 */
export interface Entry {
  readonly written: string;
  readonly canonical: string;
  readonly role: ResolvedRole;
}

export type Choice =
  | { readonly kind: 'hit'; readonly entry: Entry }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly Entry[] }
  | { readonly kind: 'miss' };

export const MISS: Choice = { kind: 'miss' };

/** 关键词构造器（Ok/Err/Some/None）：语法关键词，不查词汇。 */
export const KEYWORD_CTORS: ReadonlySet<string> = new Set(['Ok', 'Err', 'Some', 'None']);

function distinct(entries: readonly Entry[]): Entry[] {
  const seen = new Map<string, Entry>();
  for (const e of entries) seen.set(`${e.role}\u0000${e.canonical}`, e);
  return [...seen.values()];
}

/** 精确命中优先；无精确时折叠命中唯一才采用；同层多个不同规范名即歧义。 */
export function choose(exact: readonly Entry[], folded: readonly Entry[]): Choice {
  for (const layer of [exact, folded]) {
    const uniq = distinct(layer);
    if (uniq.length === 1) return { kind: 'hit', entry: uniq[0]! };
    if (uniq.length > 1) return { kind: 'ambiguous', candidates: uniq };
  }
  return MISS;
}

/** 源码声明（含导入）：按原写法与规范名双向匹配。 */
export function chooseDecl(decls: readonly Entry[], written: string): Choice {
  const w = nfc(written);
  const key = foldKey(w);
  const exact = decls.filter((d) => d.written === w || d.canonical === w);
  const folded = decls.filter((d) => foldKey(d.written) === key || foldKey(d.canonical) === key);
  return choose(exact, folded);
}

export interface VocabMap {
  readonly map: ReadonlyMap<string, Candidate[]>;
  readonly role: ResolvedRole;
}

export function toEntries(cands: readonly Candidate[], role: ResolvedRole): Entry[] {
  return cands.map((c) => ({ written: c.written, canonical: c.canonical, role }));
}

/** 词汇（§6.2 第 4 步）后接规范名直写（第 5 步）。 */
export function chooseVocab(maps: readonly VocabMap[], written: string): Choice {
  const exact = maps.flatMap((m) => toEntries(lookup(m.map, written).exact, m.role));
  const folded = maps.flatMap((m) => toEntries(lookup(m.map, written).folded, m.role));
  const picked = choose(exact, folded);
  if (picked.kind !== 'miss') return picked;
  const w = nfc(written);
  const direct = maps.flatMap((m) => toEntries(byCanonical(m.map).get(w) ?? [], m.role));
  return choose(direct, []);
}

/** 规范名 → 候选的反向索引，按词汇映射缓存，避免每次未命中都全表扫描。 */
const canonicalIndex = new WeakMap<ReadonlyMap<string, Candidate[]>, Map<string, Candidate[]>>();

function byCanonical(map: ReadonlyMap<string, Candidate[]>): Map<string, Candidate[]> {
  const cached = canonicalIndex.get(map);
  if (cached) return cached;
  const index = new Map<string, Candidate[]>();
  for (const c of [...map.values()].flat()) index.set(c.canonical, [...(index.get(c.canonical) ?? []), c]);
  canonicalIndex.set(map, index);
  return index;
}

export function formatCandidates(cands: readonly Entry[]): string {
  return cands
    .map((c) => `${c.canonical} (${c.written})`)
    .sort(compareCodePoints)
    .join(', ');
}
