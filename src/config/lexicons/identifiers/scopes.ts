/**
 * @module config/lexicons/identifiers/scopes
 *
 * 按角色与作用域组织的词汇视图（ADR 0051）。构建时不覆盖：同键的全部候选都保留，
 * 由解析器按位置判定。canonicalScopesJson 的输出须与 Java 实现逐字节一致。
 */
import { compareCodePoints, foldKey, nfc } from './casefold.js';
import { IdentifierKind } from './types.js';
import type { DomainVocabulary, IdentifierMapping } from './types.js';

export type Role = 'TYPE' | 'FIELD' | 'MEMBER' | 'FUNCTION';

export interface Candidate {
  /** 源码写法（NFC） */
  readonly written: string;
  /** 规范名 */
  readonly canonical: string;
  readonly kind: IdentifierKind;
  /** 字段 / 枚举成员所属的规范父名 */
  readonly parent?: string;
  /** term 为主词条的 localized；synonym 为 aliases */
  readonly source: 'term' | 'synonym';
}

export interface VocabularyScopes {
  readonly schemaVersion: 1;
  readonly types: ReadonlyMap<string, Candidate[]>;
  readonly fields: ReadonlyMap<string, ReadonlyMap<string, Candidate[]>>;
  readonly enumMembers: ReadonlyMap<string, ReadonlyMap<string, Candidate[]>>;
  readonly functions: ReadonlyMap<string, Candidate[]>;
  /** foldKey(触发词) → 字面量内容 */
  readonly literals: ReadonlyMap<string, string>;
}

export type VocabularyScopeErrorCode =
  | 'field_parent_required'
  | 'member_parent_required'
  | 'literal_conflict';

export class VocabularyScopeError extends Error {
  constructor(
    readonly code: VocabularyScopeErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'VocabularyScopeError';
  }
}

function push<K>(map: Map<K, Candidate[]>, key: K, cand: Candidate): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(cand);
  else map.set(key, [cand]);
}

function pushScoped(
  map: Map<string, Map<string, Candidate[]>>,
  parent: string,
  key: string,
  cand: Candidate
): void {
  let inner = map.get(parent);
  if (!inner) {
    inner = new Map();
    map.set(parent, inner);
  }
  push(inner, key, cand);
}

/** 展开一条映射为候选：localized 为 term，aliases 为 synonym。 */
function candidatesOf(m: IdentifierMapping): Candidate[] {
  const make = (written: string, source: 'term' | 'synonym'): Candidate => ({
    written: nfc(written),
    canonical: m.canonical,
    kind: m.kind,
    ...(m.parent === undefined ? {} : { parent: m.parent }),
    source,
  });
  return [make(m.localized, 'term'), ...(m.aliases ?? []).map((a) => make(a, 'synonym'))];
}

function addLiteral(literals: Map<string, string>, cand: Candidate): void {
  const key = foldKey(cand.written);
  const prev = literals.get(key);
  if (prev !== undefined && prev !== cand.canonical) {
    throw new VocabularyScopeError('literal_conflict', `字面量宏触发词 "${cand.written}" 对应多个内容`);
  }
  literals.set(key, cand.canonical);
}

export function buildVocabularyScopes(vocab: DomainVocabulary): VocabularyScopes {
  const types = new Map<string, Candidate[]>();
  const fields = new Map<string, Map<string, Candidate[]>>();
  const enumMembers = new Map<string, Map<string, Candidate[]>>();
  const functions = new Map<string, Candidate[]>();
  const literals = new Map<string, string>();

  const place = (m: IdentifierMapping, cand: Candidate): void => {
    const key = foldKey(cand.written);
    switch (m.kind) {
      case IdentifierKind.STRUCT:
        return push(types, key, cand);
      case IdentifierKind.FUNCTION:
        return push(functions, key, cand);
      case IdentifierKind.LITERAL:
        return addLiteral(literals, cand);
      case IdentifierKind.FIELD:
        if (m.parent === undefined) {
          throw new VocabularyScopeError('field_parent_required', `字段 "${m.localized}" 缺少 parent`);
        }
        return pushScoped(fields, m.parent, key, cand);
      case IdentifierKind.ENUM_VALUE:
        if (m.parent === undefined) {
          throw new VocabularyScopeError('member_parent_required', `枚举成员 "${m.localized}" 缺少 parent`);
        }
        return pushScoped(enumMembers, m.parent, key, cand);
    }
  };

  const all = [
    ...vocab.structs,
    ...vocab.fields,
    ...vocab.functions,
    ...(vocab.enumValues ?? []),
    ...(vocab.literals ?? []),
  ];
  for (const m of all) {
    for (const cand of candidatesOf(m)) place(m, cand);
  }

  return { schemaVersion: 1, types, fields, enumMembers, functions, literals };
}

/**
 * 在一个折叠键索引中查找写法。exact 为 NFC 后逐码点相等的候选；
 * folded 为折叠键相同的全部候选（包含 exact），由解析器决定精确优先。
 */
export function lookup(
  map: ReadonlyMap<string, Candidate[]>,
  written: string
): { exact: Candidate[]; folded: Candidate[] } {
  const w = nfc(written);
  const folded = map.get(foldKey(w)) ?? [];
  return { exact: folded.filter((c) => c.written === w), folded: [...folded] };
}

// ---- 规范 JSON ----

/** 对象用 Map 表示：避免 "__proto__" 之类键名污染原型，排序由序列化器统一负责。 */
type Json = string | number | Map<string, Json> | Json[];

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    compareCodePoints(a.canonical, b.canonical) ||
    compareCodePoints(a.written, b.written) ||
    compareCodePoints(a.kind, b.kind) ||
    compareCodePoints(a.source, b.source) ||
    compareCodePoints(a.parent ?? '', b.parent ?? '')
  );
}

function candidateJson(c: Candidate): Json {
  const o = new Map<string, Json>([
    ['canonical', nfc(c.canonical)],
    ['kind', c.kind],
    ['source', c.source],
    ['written', nfc(c.written)],
  ]);
  if (c.parent !== undefined) o.set('parent', nfc(c.parent));
  return o;
}

function bucketsJson(map: ReadonlyMap<string, Candidate[]>): Json {
  const o = new Map<string, Json>();
  for (const [k, list] of map) o.set(nfc(k), [...list].sort(compareCandidates).map(candidateJson));
  return o;
}

function scopedJson(map: ReadonlyMap<string, ReadonlyMap<string, Candidate[]>>): Json {
  const o = new Map<string, Json>();
  for (const [parent, inner] of map) o.set(nfc(parent), bucketsJson(inner));
  return o;
}

function serialize(v: Json): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return '[' + v.map(serialize).join(',') + ']';
  const keys = [...v.keys()].sort(compareCodePoints);
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(v.get(k)!)).join(',') + '}';
}

/**
 * 规范 JSON：无空白、对象键按码点排序、候选数组按 (canonical, written) 排序、字符串 NFC、
 * 含 schemaVersion。字符串转义与 JSON.stringify 一致（仅 " \ 与 U+0000-U+001F 转义，其余原样 UTF-8）。
 */
export function canonicalScopesJson(scopes: VocabularyScopes): string {
  const literals = new Map<string, Json>();
  for (const [k, v] of scopes.literals) literals.set(nfc(k), nfc(v));
  return serialize(
    new Map<string, Json>([
      ['enumMembers', scopedJson(scopes.enumMembers)],
      ['fields', scopedJson(scopes.fields)],
      ['functions', bucketsJson(scopes.functions)],
      ['literals', literals],
      ['schemaVersion', scopes.schemaVersion],
      ['types', bucketsJson(scopes.types)],
    ])
  );
}
