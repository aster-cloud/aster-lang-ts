/**
 * 词汇规范预览 `aster/canonicalPreview`（ADR 0058 §8.2）。
 *
 * 把经词汇解析的标识符换成规范名、把词汇字面量宏换成展开后的字符串字面量，关键词与其余文字原样保留。
 * 预览只给评审者看，不保存、不编译；忠实性由语料验收保证：不带词汇编译预览文本与带词汇编译源码的
 * Core IR（忽略 origin）相同。
 *
 * 替换位置一律由 canonicalize 自身证明（canonical-runs.ts）：规范化会删冠词、转写关键词，
 * 原文里同形的词（`Return a a.` 里被删的冠词 `a`）不能凭文字相同认作编译器用的那个词。
 * 证明不了的位置不替换——预览在该处保留原写法，不会换错词。
 *
 * 偏移一律是 UTF-16 code unit（ADR §7.8），与 Monaco / LSP 默认的 positionEncoding 一致。
 */
import type { Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { canonicalize, literalMacroRuns } from '../frontend/canonicalizer.js';
import type { CanonicalizerOptions } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { escapeStringLiteral } from '../frontend/string-escapes.js';
import { nfc } from '../config/lexicons/identifiers/casefold.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../config/lexicons/index.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { TokenKind } from '../types.js';
import type { Span } from '../types.js';
import { RESOLVER_VERSION } from '../version.js';
import { resolveDocument } from './resolution.js';
import type { ResolutionSite, ResolvableDocument } from './resolution.js';
import { alignTokensToSource } from './source-positions.js';
import { proveRunSources, sameWordUnder } from './canonical-runs.js';
import type { RunTarget } from './canonical-runs.js';

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
 * `lexicon` 为文档的 lexicon，决定规范化与字面量宏的引号，缺省为默认 lexicon。
 * `written !== canonical` 的解析位置换成规范名；字面量宏取编译器展开的那批词（不带词汇的规范化文本上
 * 按 literalMacroRuns 命中），换成展开后的字符串字面量。
 */
export function buildCanonicalPreview(text: string, doc: ResolvableDocument, lexicon?: Lexicon): CanonicalPreview {
  const effective = lexicon ?? defaultLexicon();
  const sameWord = sameWordUnder((w) => canonicalize(w, effective));
  return apply(text, [
    ...siteReplacements(text, doc, effective, sameWord),
    ...literalReplacements(text, doc, effective, sameWord),
  ]);
}

type SameWord = (sourceRun: string, canonicalRun: string) => boolean;

/**
 * 解析位置的替换。解析位置的 span 来自按顺序查找对齐的 token，可能落在同形的被删冠词上，
 * 所以先把它换回解析所用的规范化 token（带词汇规范化文本上的位置），再由探针证明其原文位置。
 */
function siteReplacements(text: string, doc: ResolvableDocument, lexicon: Lexicon, sameWord: SameWord): Replacement[] {
  const sites = resolveDocument(doc).sites.filter((s) => s.written !== s.canonical);
  if (sites.length === 0) return [];
  const options: Lexicon | CanonicalizerOptions = doc.vocabulary ? { lexicon, vocabulary: doc.vocabulary } : lexicon;
  const recanonicalize = (s: string): string => canonicalize(s, options);
  let can: string;
  let located: Array<{ site: ResolutionSite; target: RunTarget | undefined }>;
  try {
    can = recanonicalize(text);
    const tokens = lex(can, lexicon);
    const aligned = alignTokensToSource(text, can, tokens);
    const offsets = TextDocument.create('inmemory://canonical-preview', 'aster', 0, text);
    const toRange = (span: Span): Range => [
      offsets.offsetAt({ line: span.start.line - 1, character: span.start.col - 1 }),
      offsets.offsetAt({ line: span.end.line - 1, character: span.end.col - 1 }),
    ];
    const canLines = can.split('\n');
    const idents = aligned.flatMap((t, i): IdentToken[] => {
      const c = tokens[i]!;
      if ((c.kind !== TokenKind.IDENT && c.kind !== TokenKind.TYPE_IDENT) || c.start.line !== c.end.line) return [];
      const [a, b] = toRange({ start: t.start, end: t.end });
      const text = (canLines[c.start.line - 1] ?? '').slice(c.start.col - 1, c.end.col - 1);
      return [{ a, b, exact: t.srcAlign === 'exact', line: c.start.line, col: c.start.col - 1, text }];
    });
    located = sites.map((site) => ({ site, target: canonicalTarget(site, idents, toRange) }));
  } catch {
    return [];
  }
  const found = proveRunSources(text, can, recanonicalize, located.map((l) => l.target ?? { line: 0, col: -1 }), sameWord);
  return located.flatMap(({ site }, i) => {
    const at = found[i];
    if (!at) return [];
    const [start, firstEnd] = at;
    // 写法跨多段（点分路径）时只证明了首段，其余段须与写法逐字相同
    const end = site.written.length === firstEnd - start ? firstEnd : start + site.written.length;
    if (end !== firstEnd && nfc(text.slice(start, end)) !== nfc(site.written)) return [];
    return [{ start, end, text: site.canonical, canonical: site.canonical, role: site.role }];
  });
}

/** 带词汇规范化文本上的标识符 token：[a, b) 为其对齐后的原文区间，line / col / text 为规范化文本上的位置与文字 */
interface IdentToken {
  readonly a: number;
  readonly b: number;
  readonly exact: boolean;
  readonly line: number;
  readonly col: number;
  readonly text: string;
}

/**
 * 解析位置在带词汇规范化文本上的起点。名字节点的 span 落在某个 token 内（点分路径的一段）时按 token 内偏移换算；
 * 声明、参数、构造等节点的 span 覆盖整条结构（如 `Definiere Fahrer hat …`），此时取 span 内
 * 第一个写法相同的标识符 token（span 恰为整个 token 也属此列，含原文找不到同样文字、位置是推算的 token，
 * 如全角写法）。token 内偏移换算只用于精确对齐的 token（原文文字与规范化文字相同）。位置由调用方再行证明。
 * `idents` 按原文位置升序（对齐结果单调），二分找到 span 起点处再顺序扫到 span 终点。
 */
function canonicalTarget(site: ResolutionSite, idents: readonly IdentToken[], toRange: (span: Span) => Range): RunTarget | undefined {
  const [s, e] = toRange(site.span);
  const written = nfc(site.written);
  let lo = 0;
  let hi = idents.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (idents[mid]!.b <= s) lo = mid + 1;
    else hi = mid;
  }
  for (let i = Math.max(0, lo - 1); i < idents.length && idents[i]!.a <= e; i++) {
    const t = idents[i]!;
    if (t.exact && t.a <= s && e <= t.b) {
      const at = t.col + (s - t.a);
      if (nfc(t.text.slice(s - t.a, s - t.a + site.written.length)) === written) return { line: t.line, col: at };
    } else if (s <= t.a && t.b <= e && nfc(t.text) === written) {
      return { line: t.line, col: t.col };
    }
  }
  return undefined;
}

/** 字面量宏的替换：编译器在规范化文本上展开的每一处，证明其原文位置后换成字符串字面量。 */
function literalReplacements(text: string, doc: ResolvableDocument, lexicon: Lexicon, sameWord: SameWord): Replacement[] {
  const literals = doc.vocabulary?.literals;
  if (!literals || literals.size === 0) return [];
  const quotes = lexicon.punctuation.stringQuotes;
  const recanonicalize = (s: string): string => canonicalize(s, lexicon);
  let can: string;
  try {
    can = recanonicalize(text);
  } catch {
    return [];
  }
  const lineStarts = [0];
  for (let i = can.indexOf('\n'); i >= 0; i = can.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const runs = literalMacroRuns(can, literals, quotes);
  const targets = runs.map((r): RunTarget => {
    let line = lineStarts.length;
    while (lineStarts[line - 1]! > r.offset) line--;
    return { line, col: r.offset - lineStarts[line - 1]! };
  });
  const found = proveRunSources(text, can, recanonicalize, targets, sameWord);
  return runs.flatMap((r, i) => {
    const at = found[i];
    if (!at) return [];
    const literal = quotes.open + escapeStringLiteral(r.value, quotes.close) + quotes.close;
    return [{ start: at[0], end: at[1], text: literal, canonical: r.value, role: 'LITERAL' }];
  });
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
