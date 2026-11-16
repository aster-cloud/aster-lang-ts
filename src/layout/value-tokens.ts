/**
 * 找出源码里「值与名字」token 在原文中的区间（ADR 0058 §7.5 `layout_structural_hides_value`）。
 *
 * 值 token = 关键词、标点、空白、注释以外的 token：标识符、数字、字符串、布尔与 null 字面量。
 * 关键词按词法表判定：主拼写 + 别名 + 版本冻结的 aliasSet，以及解析器在任何 locale 下都认的
 * 英文规范拼写（KW / en-US，如 zh 源码里的 `then`/`else`）；多词关键词须整段连续匹配。
 *
 * 分词走生产同款 canonicalize → lex，token 位置在规范化文本上；规范化保持行数不变，
 * 于是逐行把值 token 按顺序在原文该行里找回（引号、全角字符宽松匹配，因为规范化会改写它们）。
 * 找不到时退回整行——宁可多拒，不可漏判。
 */
import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { KW } from '../frontend/tokens.js';
import { EN_US } from '../config/lexicons/en-US.js';
import { compileGuardedRegex } from '../config/lexicons/regex-guard.js';
import type { Lexicon } from '../config/lexicons/types.js';
import type { SemanticTokenKind } from '../config/token-kind.js';
import { TokenKind } from '../types.js';
import type { Token } from '../types.js';

/** 原文中的 UTF-16 区间 [start, end) */
export type OffsetRange = readonly [number, number];

const WORD_KINDS: ReadonlySet<TokenKind> = new Set([TokenKind.IDENT, TokenKind.TYPE_IDENT, TokenKind.KEYWORD]);
const LITERAL_KINDS: ReadonlySet<TokenKind> = new Set([
  TokenKind.STRING, TokenKind.INT, TokenKind.FLOAT, TokenKind.LONG, TokenKind.DECIMAL, TokenKind.BOOL, TokenKind.NULL,
]);

/** 词法表并入版本冻结的别名（按 kind 取并集） */
export function withAliasSet(lexicon: Lexicon, aliasSet?: Record<string, readonly string[]>): Lexicon {
  if (!aliasSet || Object.keys(aliasSet).length === 0) return lexicon;
  const aliases: Partial<Record<SemanticTokenKind, readonly string[]>> = { ...lexicon.aliases };
  for (const [kind, words] of Object.entries(aliasSet)) {
    const k = kind as SemanticTokenKind;
    aliases[k] = [...new Set([...(aliases[k] ?? []), ...words])];
  }
  return { ...lexicon, aliases };
}

/** 字面量关键词（真、假、null、none）是值，不算关键词 */
const LITERAL_KEYWORDS: ReadonlySet<string> = new Set(['TRUE', 'FALSE', 'NULL', 'NONE']);

/** 某个表里除字面量以外的全部拼写 */
function nonLiteralSpellings(table: Partial<Record<string, string | readonly string[] | undefined>>): string[] {
  return Object.entries(table)
    .filter(([kind]) => !LITERAL_KEYWORDS.has(kind))
    .flatMap(([, v]) => (v === undefined ? [] : typeof v === 'string' ? [v] : [...v]));
}

/** 全部关键词拼写，按首词索引为小写词序列（长的在前，便于最长匹配） */
function keywordIndex(lexicon: Lexicon): Map<string, string[][]> {
  // 与 canonicalize 一致：词法表的转写规则（如 de 的 ue→ü）也作用于关键词拼写
  const rules = (lexicon.canonicalization.customRules ?? []).flatMap((rule) => {
    const compiled = compileGuardedRegex(rule.pattern, 'g');
    return compiled.ok ? [{ re: compiled.regex, replacement: rule.replacement }] : [];
  });
  const markers = lexicon.punctuation.markers;
  const spellings = new Set<string>();
  const add = (s: string): void => {
    const lower = s.toLowerCase();
    spellings.add(lower);
    spellings.add(rules.reduce((t, r) => t.replace(r.re, r.replacement), lower));
    if (markers?.open && markers.close && s.length > markers.open.length + markers.close.length
      && s.startsWith(markers.open) && s.endsWith(markers.close)) {
      add(s.slice(markers.open.length, s.length - markers.close.length));
    }
  };
  [
    ...nonLiteralSpellings(lexicon.keywords),
    ...nonLiteralSpellings(lexicon.aliases ?? {}),
    ...nonLiteralSpellings(EN_US.keywords),
    ...nonLiteralSpellings(KW),
  ].forEach(add);

  const index = new Map<string, string[][]>();
  for (const s of spellings) {
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    index.set(words[0]!, [...(index.get(words[0]!) ?? []), words]);
  }
  for (const list of index.values()) list.sort((a, b) => b.length - a.length);
  return index;
}

const wordOf = (t: Token | undefined): string | null =>
  t && WORD_KINDS.has(t.kind) && typeof t.value === 'string' ? t.value.toLowerCase() : null;

/** 从非 trivia 的 token 流中挑出值 token（多词关键词整段跳过） */
function valueTokens(tokens: readonly Token[], lexicon: Lexicon): Token[] {
  const index = keywordIndex(lexicon);
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (LITERAL_KINDS.has(t.kind)) {
      out.push(t);
      i++;
      continue;
    }
    const word = wordOf(t);
    if (word === null || t.kind === TokenKind.KEYWORD) {
      i++;
      continue;
    }
    const match = (index.get(word) ?? []).find((seq) => seq.every((w, j) => wordOf(tokens[i + j]) === w));
    if (match) {
      i += match.length;
      continue;
    }
    out.push(t);
    i++;
  }
  return out;
}

const QUOTES = '"\'`“”‘’„‚«»「」『』';
const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

/** 宽松匹配：引号互通、ASCII 与全角互通、空白串与空格/tab 串互通 */
function loosePattern(raw: string): string {
  let out = '';
  let inSpace = false;
  for (const ch of raw) {
    if (ch === ' ') {
      if (!inSpace) out += '[ \\t]+';
      inSpace = true;
      continue;
    }
    inSpace = false;
    const cp = ch.codePointAt(0)!;
    if (QUOTES.includes(ch)) out += `[${escapeRe(QUOTES)}]`;
    else if (cp >= 0x21 && cp <= 0x7e) out += `(?:${escapeRe(ch)}|${escapeRe(String.fromCodePoint(cp + 0xfee0))})`;
    else out += escapeRe(ch);
  }
  return out;
}

/** 在原文一行里从 from 起找 raw；先要求两侧不是词字符，再放宽（CJK 无空格时 token 紧挨着） */
function findLoose(line: string, raw: string, from: number): { at: number; len: number } | null {
  const body = loosePattern(raw);
  for (const pattern of [`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, body]) {
    const re = new RegExp(pattern, 'gu');
    re.lastIndex = from;
    const m = re.exec(line);
    if (m) return { at: m.index, len: m[0].length };
  }
  return null;
}

/** 各行在原文中的起点与长度（换行按 \r\n、\r、\n 切分，与 canonicalize 一致） */
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

/**
 * 值 token 在原文中的区间，按出现顺序。源码无法分词时返回 null（调用方应视为无法证明不重叠）。
 */
export function valueTokenRanges(source: string, lexicon: Lexicon): OffsetRange[] | null {
  let canonical: string;
  let tokens: Token[];
  try {
    canonical = canonicalize(source, lexicon);
    tokens = lex(canonical, lexicon).filter((t) => t.channel !== 'trivia');
  } catch {
    return null;
  }
  const values = valueTokens(tokens, lexicon);
  const original = lineTable(source);
  const canonLines = canonical.split('\n');
  // 行数对不上就无法逐行找回：每个值都按整篇源码计
  if (canonLines.length !== original.length) return values.map((): OffsetRange => [0, source.length]);
  const cursor = new Map<number, number>();
  const wholeLines = (from: number, to: number): OffsetRange => [
    original[from - 1]!.start,
    original[to - 1]!.start + original[to - 1]!.text.length,
  ];

  return values.map((t): OffsetRange => {
    const line = t.start.line;
    const orig = original[line - 1]!;
    if (t.end.line !== line) return wholeLines(line, Math.min(t.end.line, original.length));
    const raw = (canonLines[line - 1] ?? '').slice(t.start.col - 1, t.end.col - 1);
    const found = raw ? findLoose(orig.text, raw, cursor.get(line) ?? 0) : null;
    if (!found) return wholeLines(line, line);
    cursor.set(line, found.at + found.len);
    return [orig.start + found.at, orig.start + found.at + found.len];
  });
}
