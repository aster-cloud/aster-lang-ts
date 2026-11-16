/**
 * 词汇规范预览 `aster/canonicalPreview`（ADR 0058 §8.2）。
 *
 * 把经词汇解析的标识符换成规范名、把词汇字面量宏换成展开后的字符串字面量，关键词与其余文字原样保留。
 * 预览只给评审者看，不保存、不编译；忠实性由语料验收保证：不带词汇编译预览文本与带词汇编译源码的
 * Core IR（忽略 origin）相同。
 *
 * 偏移一律是 UTF-16 code unit（ADR §7.8），与 Monaco / LSP 默认的 positionEncoding 一致。
 */
import type { Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { escapeStringLiteral } from '../frontend/string-escapes.js';
import { foldKey, nfc } from '../config/lexicons/identifiers/casefold.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../config/lexicons/index.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { TokenKind } from '../types.js';
import type { Span } from '../types.js';
import { RESOLVER_VERSION } from '../version.js';
import { resolveDocument } from './resolution.js';
import type { ResolutionSite, ResolvableDocument } from './resolution.js';
import { alignTokensToSource } from './source-positions.js';

import { CANONICAL_PREVIEW_METHOD } from './canonical-preview-contract.js';
import type { CanonicalPreview } from './canonical-preview-contract.js';

export { CANONICAL_PREVIEW_METHOD } from './canonical-preview-contract.js';
export type { CanonicalPreview } from './canonical-preview-contract.js';

/** 一处待替换的源码区间（UTF-16 偏移，end 不含）。 */
interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly canonical: string;
  readonly role: string;
}

type Range = readonly [number, number];

/**
 * 生成规范预览。`doc` 须是以同一 lexicon 与词汇解析 `text` 得到的快照（server 的 CachedDoc）；
 * `lexicon` 为文档的 lexicon，决定标识符切分与字面量宏的引号，缺省为默认 lexicon。
 * 按源码顺序把 `written !== canonical` 的解析位置换成规范名，解析位置未覆盖、折叠后命中
 * `literals` 的标识符换成展开后的字符串字面量。
 */
export function buildCanonicalPreview(text: string, doc: ResolvableDocument, lexicon?: Lexicon): CanonicalPreview {
  const offsets = TextDocument.create('inmemory://canonical-preview', 'aster', 0, text);
  const toRange = (span: Span): Range => [
    offsets.offsetAt({ line: span.start.line - 1, character: span.start.col - 1 }),
    offsets.offsetAt({ line: span.end.line - 1, character: span.end.col - 1 }),
  ];
  const effective = lexicon ?? defaultLexicon();
  const idents = identifierRanges(text, effective, toRange);
  const sites = resolveDocument(doc).sites.map((s) => ({ site: s, at: locate(text, s, idents, toRange) }));

  const replacements: Replacement[] = sites
    .filter(({ site, at }) => at && site.written !== site.canonical)
    .map(({ site, at }) => ({ start: at![0], end: at![1], text: site.canonical, canonical: site.canonical, role: site.role }));

  const covered = sites.flatMap(({ at }) => (at ? [at] : []));
  const literals = doc.vocabulary?.literals;
  if (literals && literals.size > 0) {
    const quotes = effective.punctuation.stringQuotes;
    for (const [start, end] of idents) {
      if (covered.some(([a, b]) => a < end && start < b)) continue;
      const value = literals.get(foldKey(text.slice(start, end)));
      if (value === undefined) continue;
      const literal = quotes.open + escapeStringLiteral(value, quotes.close) + quotes.close;
      replacements.push({ start, end, text: literal, canonical: value, role: 'LITERAL' });
    }
  }
  return apply(text, replacements);
}

/** 按源码偏移升序替换；同一区间只替换一次，与已替换区间重叠者丢弃。preview 区间按已替换长度累计推出。 */
function apply(text: string, replacements: readonly Replacement[]): CanonicalPreview {
  const ordered = [...replacements].sort((a, b) => a.start - b.start || b.end - a.end);
  const mappings: CanonicalPreview['mappings'] = [];
  let out = '';
  let cursor = 0;
  for (const r of ordered) {
    if (r.start < cursor) continue;
    out += text.slice(cursor, r.start);
    const previewStart = out.length;
    out += r.text;
    mappings.push({ source: [r.start, r.end], preview: [previewStart, out.length], canonical: r.canonical, role: r.role });
    cursor = r.end;
  }
  return { text: out + text.slice(cursor), mappings, resolverVersion: RESOLVER_VERSION };
}

/**
 * 解析位置在源码中对应的标识符区间。名字节点的 span 恰为写法本身时直接取用；
 * 声明、参数、构造等节点的 span 覆盖整条结构（如 `Definiere Fahrer hat …`），此时取 span 内
 * 第一个写法相同的标识符 token。找不到时返回 undefined（不替换，不猜位置）。
 */
function locate(
  text: string,
  site: ResolutionSite,
  idents: readonly Range[],
  toRange: (span: Span) => Range
): Range | undefined {
  const [start, end] = toRange(site.span);
  const written = nfc(site.written);
  if (nfc(text.slice(start, end)) === written) return [start, end];
  return idents.find(([a, b]) => start <= a && b <= end && nfc(text.slice(a, b)) === written);
}

/**
 * 不带词汇 tokenize 源码（字面量宏触发词因此仍是标识符 token），返回标识符 token 的源码区间。
 * 等价于 `tokenize(text, lexicon)`，再把 token 位置对齐回原文坐标；词法错误时没有可替换的 token。
 */
function identifierRanges(text: string, lexicon: Lexicon, toRange: (span: Span) => Range): Range[] {
  try {
    const can = canonicalize(text, lexicon);
    return alignTokensToSource(text, can, lex(can, lexicon))
      .filter((t) => (t.kind === TokenKind.IDENT || t.kind === TokenKind.TYPE_IDENT) && t.srcAlign === 'exact')
      .map((t) => toRange({ start: t.start, end: t.end }));
  } catch {
    return [];
  }
}

function defaultLexicon(): Lexicon {
  initializeDefaultLexicons();
  return LexiconRegistry.getDefault();
}

export function registerCanonicalPreviewHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => ResolvableDocument & { text: string },
  getLexiconForDoc?: (uri: string) => Lexicon | undefined
): void {
  connection.onRequest(
    CANONICAL_PREVIEW_METHOD,
    (params: { textDocument: { uri: string } }): CanonicalPreview | null => {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return null;
      const entry = getOrParse(doc);
      return buildCanonicalPreview(entry.text, entry, getLexiconForDoc?.(doc.uri));
    }
  );
}
