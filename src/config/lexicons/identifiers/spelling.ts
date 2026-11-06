/**
 * @module config/lexicons/identifiers/spelling
 *
 * 通用写法解析（与引擎名称解析同口径）：NFC 精确匹配优先，其次折叠键匹配；
 * 同一层命中多个不同项即撞名，精确层撞名不退回折叠层。
 * 供下游（如 aster-cloud 执行输入映射）按策略写法 / 规范名 / 词汇词条查找声明项，避免各自重写规则。
 */
import { compareCodePoints, foldKey, nfc } from './casefold.js';

/** 写法索引：NFC 精确键与折叠键各一张，桶内按项身份去重。 */
export interface SpellingIndex<T> {
  readonly exact: ReadonlyMap<string, readonly T[]>;
  readonly folded: ReadonlyMap<string, readonly T[]>;
}

export type SpellingMatch<T> =
  | { readonly kind: 'none' }
  | { readonly kind: 'one'; readonly item: T }
  /** items 按身份键码点序排列 */
  | { readonly kind: 'conflict'; readonly items: readonly T[] };

function add<T>(table: Map<string, T[]>, key: string, item: T, keyOf: (item: T) => string): void {
  const bucket = table.get(key) ?? [];
  if (!bucket.some((x) => keyOf(x) === keyOf(item))) bucket.push(item);
  table.set(key, bucket);
}

/**
 * 建索引。
 * @param spellingsOf 某项接受的全部写法（作者写法、规范名、词汇本地化名与同义词等）
 * @param keyOf 项的身份键（通常为规范名）；身份相同的项在同一桶内只算一个
 */
export function buildSpellingIndex<T>(
  items: Iterable<T>,
  spellingsOf: (item: T) => Iterable<string>,
  keyOf: (item: T) => string
): SpellingIndex<T> {
  const exact = new Map<string, T[]>();
  const folded = new Map<string, T[]>();
  for (const item of items) {
    for (const spelling of spellingsOf(item)) {
      add(exact, nfc(spelling), item, keyOf);
      add(folded, foldKey(spelling), item, keyOf);
    }
  }
  for (const table of [exact, folded]) {
    for (const bucket of table.values()) bucket.sort((a, b) => compareCodePoints(keyOf(a), keyOf(b)));
  }
  return { exact, folded };
}

function matchOf<T>(bucket: readonly T[] | undefined): SpellingMatch<T> | null {
  if (!bucket || bucket.length === 0) return null;
  return bucket.length === 1 ? { kind: 'one', item: bucket[0]! } : { kind: 'conflict', items: bucket };
}

/** 解析写法：精确优先，其次折叠；都未命中为 none。 */
export function resolveSpelling<T>(index: SpellingIndex<T>, written: string): SpellingMatch<T> {
  return matchOf(index.exact.get(nfc(written))) ?? matchOf(index.folded.get(foldKey(written))) ?? { kind: 'none' };
}
