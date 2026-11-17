/**
 * 词汇规范预览 `aster/canonicalPreview`（ADR 0058 §8.2）。
 *
 * 把经词汇解析的标识符换成规范名、把词汇字面量宏换成展开后的字符串字面量，关键词与其余文字原样保留。
 * 预览只给评审者看，不保存、不编译；忠实性由语料验收保证：不带词汇编译预览文本与带词汇编译源码的
 * Core IR（忽略 origin）相同。
 *
 * 替换位置一律由 canonicalize 自身证明（canonical-runs.ts）：规范化会删冠词、转写关键词，
 * 原文里同形的词（`Return a a.` 里被删的冠词 `a`）不能凭文字相同认作编译器用的那个词。
 * ★失败闭锁：任何一处该替换的位置证明不了（含探测预算耗尽）、或两处替换区间冲突，就不给预览（返回 null，
 *   与「文档不存在」同一契约）。只替换一部分的文本不带词汇编译后含义不同，比没有预览更糟。
 *   宏值写成字面量后不能原样往返时同样不给预览（见 roundTrips）。
 *
 * 偏移一律是 UTF-16 code unit（ADR §7.8），与 Monaco / LSP 默认的 positionEncoding 一致。
 */
import type { Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { canonicalize, literalMacroRuns } from '../frontend/canonicalizer.js';
import type { CanonicalizerOptions } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { nfc } from '../config/lexicons/identifiers/casefold.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../config/lexicons/index.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { TokenKind } from '../types.js';
import type { Span } from '../types.js';
import { RESOLVER_VERSION } from '../version.js';
import { resolveDocument } from './resolution.js';
import type { ResolutionSite, ResolvableDocument } from './resolution.js';
import { alignTokensToSource } from './source-positions.js';
import { DEFAULT_PROBE_BUDGET, proveRunSources, sameWordUnder } from './canonical-runs.js';
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
export function buildCanonicalPreview(
  text: string,
  doc: ResolvableDocument,
  lexicon?: Lexicon,
  options: CanonicalPreviewOptions = {},
): CanonicalPreview | null {
  const effective = lexicon ?? defaultLexicon();
  const prove: Prove = {
    sameWord: sameWordUnder((w) => canonicalize(w, effective)),
    budget: options.probeBudget ?? DEFAULT_PROBE_BUDGET,
  };
  const sites = siteReplacements(text, doc, effective, prove);
  const literals = sites && literalReplacements(text, doc, effective, prove);
  return sites && literals ? apply(text, [...sites, ...literals]) : null;
}

/** 预览选项：probeBudget 为逐候选探测的工作量预算（见 canonical-runs.ts），测试用来触发失败闭锁 */
export interface CanonicalPreviewOptions {
  readonly probeBudget?: number;
}

interface Prove {
  readonly sameWord: (sourceRun: string, canonicalRun: string) => boolean;
  readonly budget: number;
}

/**
 * 解析位置的替换。解析位置的 span 来自按顺序查找对齐的 token，可能落在同形的被删冠词上，
 * 所以先把它换回解析所用的规范化 token（带词汇规范化文本上的位置），再由探针证明其原文位置。
 * 任何一处证明不了返回 null。
 */
function siteReplacements(text: string, doc: ResolvableDocument, lexicon: Lexicon, prove: Prove): Replacement[] | null {
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
    return null;
  }
  if (located.some((l) => !l.target)) return null;
  const found = proveRunSources(text, can, recanonicalize, located.map((l) => l.target!), prove.sameWord, prove.budget);
  const out: Replacement[] = [];
  for (const [i, { site }] of located.entries()) {
    const at = found[i];
    if (!at) return null;
    const [start, firstEnd] = at;
    // 写法跨多段（点分路径）时只证明了首段，其余段须与写法逐字相同
    const end = site.written.length === firstEnd - start ? firstEnd : start + site.written.length;
    if (end !== firstEnd && nfc(text.slice(start, end)) !== nfc(site.written)) return null;
    out.push({ start, end, text: site.canonical, canonical: site.canonical, role: site.role });
  }
  return out;
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

/**
 * 字面量宏的替换：编译器在规范化文本上展开的每一处，证明其原文位置后换成字符串字面量。
 * 任何一处证明不了、或宏值写成字面量后不能原样往返（见 roundTrips），返回 null。
 */
function literalReplacements(text: string, doc: ResolvableDocument, lexicon: Lexicon, prove: Prove): Replacement[] | null {
  const literals = doc.vocabulary?.literals;
  if (!literals || literals.size === 0) return [];
  const quotes = lexicon.punctuation.stringQuotes;
  const recanonicalize = (s: string): string => canonicalize(s, lexicon);
  let can: string;
  try {
    can = recanonicalize(text);
  } catch {
    return null;
  }
  const lineStarts = [0];
  for (let i = can.indexOf('\n'); i >= 0; i = can.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const runs = literalMacroRuns(can, literals, quotes);
  const targets = runs.map((r): RunTarget => {
    let line = lineStarts.length;
    while (lineStarts[line - 1]! > r.offset) line--;
    return { line, col: r.offset - lineStarts[line - 1]! };
  });
  const found = proveRunSources(text, can, recanonicalize, targets, prove.sameWord, prove.budget);
  const out: Replacement[] = [];
  for (const [i, r] of runs.entries()) {
    const at = found[i];
    const lit = quotes.open + r.value + quotes.close;
    if (!at || !roundTrips(lit, r.value, lexicon)) return null;
    out.push({ start: at[0], end: at[1], text: lit, canonical: r.value, role: 'LITERAL' });
  }
  return out;
}

/**
 * 字面量 `lit`（开引号 + 宏值 + 闭引号）能否原样往返：不带词汇规范化不改写它，且 lex 后恰为一个字符串 token、值即宏值。
 * ★编译器先规范化、后展开宏，宏值原样拼进引号（不转义，aster-lang-ts#345）；预览文本却要再经一次规范化与 lex。
 *   规范化会改写字符串内部（弯引号 “ ” ‘ ’ 改成 ASCII 引号、制表符改成空格），lexer 会解释反斜杠转义、
 *   在结束引号处截断；凡此种种，两条路径得到的值不同，预览无从忠实，整份预览失败闭锁。
 *   换行等控制字符另行拒绝：单个字面量的往返证明不了整份文档按行规范化（缩进、续行）不受影响，
 *   且原样写进预览评审者也看不见。
 */
function roundTrips(lit: string, value: string, lexicon: Lexicon): boolean {
  if (/\p{Cc}/u.test(value)) return false;
  try {
    if (canonicalize(lit, lexicon) !== lit) return false;
    const tokens = lex(lit, lexicon).filter((t) => t.kind !== TokenKind.EOF);
    return tokens.length === 1 && tokens[0]!.kind === TokenKind.STRING && tokens[0]!.value === value;
  } catch {
    return false;
  }
}

/**
 * 按源码偏移升序替换；preview 区间按已替换长度累计推出。同一区间、同一替换文字的重复项只替换一次；
 * 区间重叠而替换不同时无从取舍，返回 null（失败闭锁）。
 */
function apply(text: string, replacements: readonly Replacement[]): CanonicalPreview | null {
  const ordered = [...replacements].sort((a, b) => a.start - b.start || b.end - a.end);
  const mappings: CanonicalPreview['mappings'] = [];
  let out = '';
  let cursor = 0;
  let last: Replacement | undefined;
  for (const r of ordered) {
    if (r.start < cursor) {
      if (last && r.start === last.start && r.end === last.end && r.text === last.text) continue;
      return null;
    }
    last = r;
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

/**
 * 注册 `aster/canonicalPreview`。预览按解析快照缓存：getOrParse 对同一文档版本返回同一对象，
 * 快照与 lexicon 都未变时直接复用上次结果（预览窗格随光标频繁请求，而一次预览要多轮 canonicalize 探测）。
 * 以快照为 WeakMap 键，文档换版本或关闭后旧快照被回收，缓存随之释放。
 */
export function registerCanonicalPreviewHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => ResolvableDocument & { text: string },
  getLexiconForDoc?: (uri: string) => Lexicon | undefined
): void {
  const cache = new WeakMap<object, { readonly lexicon: Lexicon | undefined; readonly preview: CanonicalPreview | null }>();
  connection.onRequest(
    CANONICAL_PREVIEW_METHOD,
    (params: { textDocument: { uri: string } }): CanonicalPreview | null => {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return null;
      const entry = getOrParse(doc);
      const lexicon = getLexiconForDoc?.(doc.uri);
      const hit = cache.get(entry);
      if (hit && hit.lexicon === lexicon) return hit.preview;
      const preview = buildCanonicalPreview(entry.text, entry, lexicon);
      cache.set(entry, { lexicon, preview });
      return preview;
    }
  );
}
