/**
 * 快速修复「用作名字」的改写范围（ADR 0064 §6 N1，#404）：只转义该词在**名字位置**上的出现，不碰读作关键词的出现。
 *
 * 同一个词常常既作名字又作关键词（zh 字段 `返回` 与 RETURN 语句、en `if`、de `wenn`）。按词法逐处改写会把关键词用法
 * 也写成转义（`` `返回`「…」 `` → E064）。这里用编译结果判定名字位置：
 *
 * 1. 先只转义诊断所在的那一处（编译器已指出它在名字位置）；
 * 2. 编译改写后的源码（与 LSP 诊断同一词法表 / 别名 / 词汇），凡是落在该词另一处出现上的 E901 / W802 / E808，
 *    或原文没有的错误（如引用旧写法的未知字段 E801），说明那一处也在名字位置，一并转义；迭代到不动点，至多
 *    {@link MAX_EXPANSION_ROUNDS} 轮；
 * 3. 从不转义编译时读作关键词且无诊断的出现；
 * 4. 守卫：扩展后的改写若比原文多出错误，退回只转义诊断那一处；它也多出错误时不给修复。
 *
 * 编译次数上限：原文 1 次 + 只转义诊断处 1 次 + 扩展至多 {@link MAX_EXPANSION_ROUNDS} 次，即 {@link MAX_COMPILES} 次。
 * 每次是规范化 + 词法 + 语法分析 + 名称解析（不做类型检查），只在请求的诊断是这三个码之一时发生。
 */
import type { Range, TextEdit } from 'vscode-languageserver/node.js';
import type { Lexicon } from '../config/lexicons/types.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { checkKeywordNames } from '../frontend/keyword-name-guard.js';
import { checkAliasIdentifiers } from '../policy-package/alias-identifier-guard.js';
import { overlayAliases, type AliasSet } from '../policy-package/alias-validate.js';
import type { Span } from '../types.js';
import { escapeAllOccurrences } from './name-escape.js';
import { parseDocumentWith } from './parse-document.js';
import { resolveDocument } from './resolution.js';

/** 扩展轮数上限：引用一般一轮全部暴露，同一声明里多处名字位置的解析错误逐轮暴露。 */
export const MAX_EXPANSION_ROUNDS = 4;

/** 一次修复至多编译的次数（原文、只转义诊断处、每轮扩展各一次）。 */
export const MAX_COMPILES = 2 + MAX_EXPANSION_ROUNDS;

/** 「用作名字」所修复的诊断码。 */
export const NAME_ESCAPE_CODES: ReadonlySet<string> = new Set([
  ErrorCode.PARSE_KEYWORD_AS_NAME,
  ErrorCode.KEYWORD_RENAMED_AS_NAME,
  ErrorCode.ALIAS_IDENTIFIER_COLLISION,
]);

/** 编译一份源码得到的诊断（0 基 LSP 范围）。`syntax` 表示语法阶段（规范化 / 词法 / 语法分析）的诊断。 */
export interface CheckedDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly range: Range;
  readonly syntax: boolean;
}

export type SourceChecker = (text: string) => readonly CheckedDiagnostic[];

/** LSP 诊断所用的编译上下文。`aliasSet` 只在修复 E808 时给出（LSP 本身不持有租户别名集）。 */
export interface NameEscapeContext {
  readonly lexicon?: Lexicon | undefined;
  readonly vocabulary?: VocabularyScopes | undefined;
  readonly aliasSet?: AliasSet | undefined;
}

function toRange(span: Span | undefined): Range {
  const s = span ?? { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } };
  return {
    start: { line: s.start.line - 1, character: s.start.col - 1 },
    end: { line: s.end.line - 1, character: s.end.col - 1 },
  };
}

/**
 * 与 LSP 诊断同一判定的编译：语法分析、名称解析（语法完整时）、W802；带别名集时叠加别名并跑别名名字守卫（E808）。
 * 不做类型检查——转义只改变名字的拼写，名字位置的错误在名称解析阶段就会出现。
 */
export function lspSourceChecker(ctx: NameEscapeContext): SourceChecker {
  const aliasSet = ctx.aliasSet && Object.keys(ctx.aliasSet).length > 0 ? ctx.aliasSet : undefined;
  const lexicon = ctx.lexicon && aliasSet ? overlayAliases(ctx.lexicon, aliasSet) : ctx.lexicon;
  return (text) => {
    const parsed = parseDocumentWith(text, lexicon, ctx.vocabulary);
    const out: CheckedDiagnostic[] = parsed.parseDiagnostics.map(d => ({
      code: String(d.code), severity: d.severity, range: toRange(d.span), syntax: true,
    }));
    if (!parsed.ast) return out;
    const semantic = [
      ...(aliasSet && ctx.lexicon ? checkAliasIdentifiers(parsed.ast, aliasSet, ctx.lexicon.id, text) : []),
      ...checkKeywordNames(parsed.ast, lexicon, text),
    ];
    const resolution = resolveDocument(parsed);
    if (resolution.complete) semantic.push(...resolution.diagnostics);
    for (const d of semantic) out.push({ code: String(d.code ?? ''), severity: d.severity, range: toRange(d.span), syntax: false });
    return out;
  };
}

export interface NameEscapeResult {
  readonly edits: TextEdit[];
  /** names：诊断处及编译判定的其余名字位置；diagnosed：扩展多出错误，退回只转义诊断处；none：不给修复 */
  readonly mode: 'names' | 'diagnosed' | 'none';
  readonly compiles: number;
}

const NONE = (compiles: number): NameEscapeResult => ({ edits: [], mode: 'none', compiles });

type Pos = { line: number; character: number };

function before(a: Pos, b: Pos): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

/** 出现 [start, end) 是否落在诊断范围上：零宽诊断要求起点重合，否则出现须在范围之内。 */
function lies(occ: Range, d: Range): boolean {
  if (before(occ.start, d.start)) return false;
  const zeroWidth = d.start.line === d.end.line && d.start.character === d.end.character;
  if (zeroWidth) return occ.start.line === d.start.line && occ.start.character === d.start.character;
  return !before(d.end, occ.end);
}

/** 只按码与行比较（转义会让本行后面的列右移，行号不变）。 */
function key(d: CheckedDiagnostic): string {
  return `${d.code}@${d.range.start.line}`;
}

function counts(diags: readonly CheckedDiagnostic[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of diags) if (d.severity === 'error') m.set(key(d), (m.get(key(d)) ?? 0) + 1);
  return m;
}

/**
 * 改写是否比原文多出错误（按码与行计数）。只计语法阶段的错误与落在该词出现行上的错误：原文有语法错误时名称解析不发布，
 * 修复后才出现的、与该词无关的既有错误（别处的未知名字）不算改写引入的。
 */
function addsErrors(candidate: readonly CheckedDiagnostic[], baseline: Map<string, number>, wordLines: ReadonlySet<number>): boolean {
  const seen = new Map<string, number>();
  for (const d of candidate) {
    if (d.severity !== 'error' || !(d.syntax || wordLines.has(d.range.start.line))) continue;
    const n = (seen.get(key(d)) ?? 0) + 1;
    seen.set(key(d), n);
    if (n > (baseline.get(key(d)) ?? 0)) return true;
  }
  return false;
}

/** 按所选出现改写源码。 */
export function applyEscapes(text: string, edits: readonly TextEdit[]): string {
  const lines = text.split('\n');
  const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
  for (const e of sorted) {
    const l = lines[e.range.start.line]!;
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character);
  }
  return lines.join('\n');
}

/** 所选出现转义后，第 i 处出现在改写文本中的范围（同一行前面每处转义右移 2 列；已转义的出现取反引号之内）。 */
function shiftedRange(occs: readonly TextEdit[], chosen: ReadonlySet<number>, i: number): Range {
  const r = occs[i]!.range;
  let shift = 0;
  for (const j of chosen) {
    const o = occs[j]!.range;
    if (o.start.line === r.start.line && o.start.character < r.start.character) shift += 2;
  }
  if (chosen.has(i)) shift += 1;
  return {
    start: { line: r.start.line, character: r.start.character + shift },
    end: { line: r.end.line, character: r.end.character + shift },
  };
}

/**
 * 「用作名字」的编辑：`diagnosed` 是被修复诊断的范围（零宽 E901 为关键词起点）。见文件头的算法与编译上限。
 */
export function nameEscapeEdits(
  text: string,
  word: string,
  diagnosed: Range,
  check: SourceChecker,
  lexicon?: Lexicon,
): NameEscapeResult {
  const occs = escapeAllOccurrences(text, word, lexicon);
  const seed = occs.map((_, i) => i).filter(i => lies(occs[i]!.range, diagnosed));
  if (seed.length === 0) return NONE(0);
  const wordLines = new Set(occs.map(o => o.range.start.line));
  const baseline = counts(check(text));
  const pick = (set: ReadonlySet<number>): TextEdit[] => [...set].sort((a, b) => a - b).map(i => occs[i]!);

  const chosen = new Set(seed);
  const single = check(applyEscapes(text, pick(chosen)));
  let compiles = 2;
  let current = single;
  for (let round = 0; round < MAX_EXPANSION_ROUNDS; round++) {
    // 触发扩展的诊断：本组三个码，或原文没有的错误；只看落在尚未转义的出现上的
    const triggers = current.filter(d => NAME_ESCAPE_CODES.has(d.code)
      || (d.severity === 'error' && !baseline.has(key(d))));
    const added = occs.map((_, i) => i)
      .filter(i => !chosen.has(i) && triggers.some(d => lies(shiftedRange(occs, chosen, i), d.range)));
    if (added.length === 0) break;
    for (const i of added) chosen.add(i);
    current = check(applyEscapes(text, pick(chosen)));
    compiles++;
  }
  if (!addsErrors(current, baseline, wordLines)) return { edits: pick(chosen), mode: 'names', compiles };
  // 扩展后多出错误：退回只转义诊断处（没有扩展时 current 就是 single，同样不给修复）
  if (current !== single && !addsErrors(single, baseline, wordLines)) return { edits: pick(new Set(seed)), mode: 'diagnosed', compiles };
  return NONE(compiles);
}
