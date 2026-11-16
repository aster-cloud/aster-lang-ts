/**
 * 找出源码里「值与名字」token 在原文中的区间（ADR 0058 §7.5 `layout_structural_hides_value`）。
 *
 * 值 token = 关键词、标点、空白、注释以外的 token：标识符、数字、字符串、布尔与 null 字面量。
 * 关键词候选按词法表拼写找出：主拼写 + 别名 + 版本冻结的 aliasSet，以及解析器在任何 locale 下都认的
 * 英文规范拼写（KW / en-US，如 zh 源码里的 `then`/`else`）；多词关键词须整段连续匹配。
 * 拼写只是候选：每个候选再按解析器角色判定（先看基线 AST，判不了再换成探针名重解析，次数有上限），被读作名字的仍是值。
 *
 * 分词走生产同款 canonicalize → lex，token 位置在规范化文本上；规范化保持行数不变，
 * 于是逐行把值 token 按顺序在原文该行里找回（引号、全角字符宽松匹配，因为规范化会改写它们）。
 * 找不到、或值与冠词/关键词同形（可能认错到被删的冠词上）时退回整行——宁可多拒，不可漏判。
 */
import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { parseWithLexicon } from '../parser.js';
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

/** 某个表里除字面量以外的条目：[kind, 拼写] */
function nonLiteralEntries(table: Partial<Record<string, string | readonly string[] | undefined>>): Array<[string, string]> {
  return Object.entries(table)
    .filter(([kind]) => !LITERAL_KEYWORDS.has(kind))
    .flatMap(([kind, v]): Array<[string, string]> =>
      (v === undefined ? [] : typeof v === 'string' ? [v] : [...v]).map((s): [string, string] => [kind, s]));
}

const lowerWords = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * 全部关键词拼写（小写；含词法表转写规则作用后的形态与 markers 内的裸拼写）→ 该关键词的英文规范词。
 * 英文词用来在 AST 里认出被关键词翻译器改写过的名字（de 的参数 `gegeben` 在 AST 里叫 `given`）。
 */
function keywordSpellings(lexicon: Lexicon): Map<string, Set<string>> {
  const spellings = new Map<string, Set<string>>();
  const english = (kind: string, s: string): string[] => {
    const en = (EN_US.keywords as Partial<Record<string, string>>)[kind];
    return [...lowerWords(s), ...(en ? lowerWords(en) : [])];
  };
  const entries: Array<[string, string, string[]]> = [
    ...nonLiteralEntries(lexicon.keywords).map(([k, s]): [string, string, string[]] => [k, s, english(k, s)]),
    ...nonLiteralEntries(lexicon.aliases ?? {}).map(([k, s]): [string, string, string[]] => [k, s, english(k, s)]),
    ...nonLiteralEntries(EN_US.keywords).map(([k, s]): [string, string, string[]] => [k, s, lowerWords(s)]),
    ...nonLiteralEntries(KW).map(([k, s]): [string, string, string[]] => [k, s, lowerWords(s)]),
  ];
  for (const [, s, en] of entries) {
    const variants = new Set<string>();
    spellingAdder(lexicon, variants)(s);
    for (const v of variants) spellings.set(v, new Set([...(spellings.get(v) ?? []), ...en]));
  }
  return spellings;
}

/** 返回一个把拼写（小写、转写后形态、去 markers 形态）加入 `into` 的函数 */
function spellingAdder(lexicon: Lexicon, into: Set<string>): (s: string) => void {
  // 与 canonicalize 一致：词法表的转写规则（如 de 的 ue→ü）也作用于关键词拼写
  const rules = (lexicon.canonicalization.customRules ?? []).flatMap((rule) => {
    const compiled = compileGuardedRegex(rule.pattern, 'g');
    return compiled.ok ? [{ re: compiled.regex, replacement: rule.replacement }] : [];
  });
  const markers = lexicon.punctuation.markers;
  const add = (s: string): void => {
    const lower = s.toLowerCase();
    into.add(lower);
    into.add(rules.reduce((t, r) => t.replace(r.re, r.replacement), lower));
    if (markers?.open && markers.close && s.length > markers.open.length + markers.close.length
      && s.startsWith(markers.open) && s.endsWith(markers.close)) {
      add(s.slice(markers.open.length, s.length - markers.close.length));
    }
  };
  return add;
}

/** 一条关键词拼写：小写词序列与其英文规范词 */
export type KeywordSeq = { words: string[]; english: ReadonlySet<string> };

/** 关键词拼写按首词索引（长的在前，便于最长匹配） */
function keywordIndex(spellings: Map<string, Set<string>>): Map<string, KeywordSeq[]> {
  const index = new Map<string, KeywordSeq[]>();
  for (const [s, english] of spellings) {
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    index.set(words[0]!, [...(index.get(words[0]!) ?? []), { words, english }]);
  }
  for (const list of index.values()) list.sort((a, b) => b.words.length - a.words.length);
  return index;
}

/**
 * 与冠词或关键词（含多词关键词中的单词）同形的词：规范化会删掉冠词、关键词不算值，
 * 原文里同形的非值词可能排在真正的值之前，逐行按序找回时会认错位置，故这类值一律按整行计。
 */
function ambiguousWords(lexicon: Lexicon, spellings: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  const add = spellingAdder(lexicon, out);
  (lexicon.canonicalization.articles ?? []).forEach(add);
  for (const s of spellings.keys()) s.split(/\s+/).filter(Boolean).forEach(add);
  return out;
}

const wordOf = (t: Token | undefined): string | null =>
  t && WORD_KINDS.has(t.kind) && typeof t.value === 'string' ? t.value.toLowerCase() : null;

/** AST 里出现的全部字符串（小写，点分名拆开；节点类型 kind 除外）：关键词形态的值若真被读作名字，必在其中 */
function astStrings(node: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof node === 'string') {
    const lower = node.toLowerCase();
    into.add(lower);
    lower.split('.').forEach((part) => into.add(part));
  } else if (Array.isArray(node)) {
    node.forEach((n) => astStrings(n, into));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (k !== 'kind') astStrings(v, into);
  }
  return into;
}

type Pos = { line: number; col: number };
type Spanned = { kind?: unknown; name?: unknown; span?: { start: Pos; end: Pos }; nameSpan?: { start: Pos } };

const posKey = (p: Pos): string => `${p.line}:${p.col}`;
const posBefore = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.col < b.col);

/**
 * AST 中必为名字的位置：类型名、参数、字段、声明名的起点。落在这些位置上的词不必探测，直接是值
 * （运算符 `and`/`not` 也是 Name 节点，故 Name 不在此列，仍须另行判定）。
 */
function namePositions(node: unknown, inList = false, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((n) => namePositions(n, inList, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const n = node as Spanned;
  if ((n.kind === 'TypeName' || inList) && n.span) into.add(posKey(n.span.start));
  if (n.nameSpan) into.add(posKey(n.nameSpan.start));
  for (const [k, v] of Object.entries(node)) namePositions(v, k === 'params' || k === 'fields', into);
  return into;
}

/** 运算符所占的 token 区间：infix 为二元运算，prefix 为一元 `not`（其后不紧跟括号才算，见 roleJudge） */
type OperatorSpan = { start: Pos; end: Pos; prefix: boolean };

/**
 * 解析器读作运算符的位置。二元运算降为 `Call(Name(op), [left, right])`，目标在首个实参之后——
 * 用户函数调用 `f(x)`、`apply f to x` 的目标都在实参之前，所以「目标在首参之后」只可能是运算符。
 * 一元 `not x` 降为 `Call(Name('not'), [x])`，调用起点就是目标起点。
 */
function operatorSpans(node: unknown, into: OperatorSpan[] = []): OperatorSpan[] {
  if (Array.isArray(node)) {
    node.forEach((n) => operatorSpans(n, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const n = node as Spanned & { target?: Spanned; args?: Spanned[] };
  const target = n.target;
  if (n.kind === 'Call' && target?.kind === 'Name' && target.span && Array.isArray(n.args)) {
    const first = n.args[0]?.span;
    if (first && posBefore(first.start, target.span.start)) {
      into.push({ start: target.span.start, end: target.span.end, prefix: false });
    } else if (target.name === 'not' && n.args.length === 1 && n.span && posKey(n.span.start) === posKey(target.span.start)) {
      into.push({ start: target.span.start, end: target.span.end, prefix: true });
    }
  }
  for (const v of Object.values(node)) operatorSpans(v, into);
  return into;
}

/** 单次 validate 最多为判定词角色重解析的次数；超出预算的词一律按值计（宁可多拒） */
export const ROLE_PROBE_BUDGET = 16;

/** 词角色判定：settle 只读基线 AST（零次额外解析），判不了时返回 null，再由 probe 重解析 */
export type RoleJudge = {
  /** true = 值，false = 关键词，null = 须重解析 */
  settle(i: number, seq: KeywordSeq): boolean | null;
  /** 把第 i 个 token 换成探针名重解析；true = 值。解析抛错或预算用尽都按值计 */
  probe(i: number): boolean;
};

/**
 * 按解析器角色判定拼写像关键词的词。基线只解析一次，多数词由基线 AST 直接判定：
 * - 拼写（或其英文规范词）不在 AST 字符串里 → 不可能被读作名字，是关键词；
 * - 落在类型名、参数、字段、声明名的起点 → 是值；
 * - 落在解析器读作运算符的位置（二元运算的目标、不带括号的一元 not）→ 是关键词。
 * 其余的词才换成源码里没有的探针名重解析：探针进了 AST 且没有新增诊断，说明解析器在这个位置把它当名字读，即是值。
 * 基线解析有诊断（源码不完整）时，除运算符位置外一律判为值，不重解析。
 * 重解析是整篇解析，单次调用最多 ROLE_PROBE_BUDGET 次，保证上限内任何源码的代价都是常数次整篇解析。
 * `parse` 仅供测试注入。
 */
export function roleJudge(
  tokens: readonly Token[],
  lexicon: Lexicon,
  parse: typeof parseWithLexicon = parseWithLexicon,
): RoleJudge {
  const base = parse(tokens, lexicon);
  const names = astStrings(base.ast);
  const positions = namePositions(base.ast);
  const operators = operatorSpans(base.ast);
  const baseDiagnostics = base.diagnostics.length;
  // 基线有诊断即 AST 不完整（恢复解析可能丢掉名字）：「不在 AST 里」与探针结果都不再能证明是关键词，
  // 只有 AST 里明确读作运算符的位置算关键词，其余一律按值计——校验自己闭锁，不靠保存路径先编译
  const incomplete = baseDiagnostics > 0;
  const baseText = JSON.stringify(base.ast).toLowerCase();
  let probe = 'zqprobe';
  while (baseText.includes(probe)) probe += 'q';
  let budget = ROLE_PROBE_BUDGET;
  const isOperator = (i: number): boolean => {
    const at = tokens[i]!.start;
    return operators.some((op) => !posBefore(at, op.start) && posBefore(at, op.end)
      && !(op.prefix && tokens[i + 1]?.kind === TokenKind.LPAREN));
  };
  return {
    settle(i, seq): boolean | null {
      if (incomplete) return !isOperator(i);
      if (![...seq.words, ...seq.english].some((w) => names.has(w))) return false;
      if (positions.has(posKey(tokens[i]!.start))) return true;
      if (isOperator(i)) return false;
      return null;
    },
    probe(i): boolean {
      if (budget <= 0) return true;
      budget--;
      const t = tokens[i]!;
      const upper = typeof t.value === 'string' && /^\p{Lu}/u.test(t.value);
      const probed = tokens.slice();
      probed[i] = { ...t, kind: upper ? TokenKind.TYPE_IDENT : TokenKind.IDENT, value: upper ? probe.toUpperCase() : probe };
      try {
        const r = parse(probed, lexicon);
        return r.diagnostics.length <= baseDiagnostics && JSON.stringify(r.ast).toLowerCase().includes(probe);
      } catch {
        return true;
      }
    },
  };
}

/** 值 token 候选；带 probe 的须重解析才能定，由调用方决定要不要花这次解析 */
type ValueCandidate = { token: Token; probe?: () => boolean };

/**
 * 从非 trivia 的 token 流中挑出值 token。拼写像关键词（含多词关键词）的词按解析器角色逐个判定，
 * 不只看拼写：`Rule f given return as Int …: Return return.` 里第二个 `return` 是参数引用，是值。
 */
function valueTokens(tokens: readonly Token[], lexicon: Lexicon, spellings: Map<string, Set<string>>): ValueCandidate[] {
  const index = keywordIndex(spellings);
  const judge = roleJudge(tokens, lexicon);
  const out: ValueCandidate[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (LITERAL_KINDS.has(t.kind)) {
      out.push({ token: t });
      i++;
      continue;
    }
    const word = wordOf(t);
    if (word === null || t.kind === TokenKind.KEYWORD) {
      i++;
      continue;
    }
    const match = (index.get(word) ?? []).find((seq) => seq.words.every((w, j) => wordOf(tokens[i + j]) === w));
    if (!match) {
      out.push({ token: t });
      i++;
      continue;
    }
    for (let j = 0; j < match.words.length; j++) {
      const k = i + j;
      const settled = judge.settle(k, match);
      if (settled === null) out.push({ token: tokens[k]!, probe: () => judge.probe(k) });
      else if (settled) out.push({ token: tokens[k]! });
    }
    i += match.words.length;
  }
  return out;
}

const QUOTES = '"\'`“”‘’„‚«»「」『』';
/** u 模式下只能转义语法字符：`\-` 在字符类外是非法转义（`"truck-driver"` 会让 RegExp 抛错） */
const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

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

const overlaps = (a: OffsetRange, b: OffsetRange): boolean => Math.max(a[0], b[0]) < Math.min(a[1], b[1]);

/**
 * 值 token 在原文中的区间，按出现顺序。源码无法分词时返回 null（调用方应视为无法证明不重叠）。
 * 给出 `structural` 时，须重解析才能定角色的词只在它可能落到的区间（所在整行）与结构 span 重叠时才判定，
 * 其余按值计——不与任何结构 span 重叠的值不会导致拒绝，不必花这次解析。
 */
export function valueTokenRanges(source: string, lexicon: Lexicon, structural?: readonly OffsetRange[]): OffsetRange[] | null {
  let canonical: string;
  let tokens: Token[];
  try {
    canonical = canonicalize(source, lexicon);
    tokens = lex(canonical, lexicon).filter((t) => t.channel !== 'trivia');
  } catch {
    return null;
  }
  const spellings = keywordSpellings(lexicon);
  let candidates: ValueCandidate[];
  try {
    candidates = valueTokens(tokens, lexicon, spellings);
  } catch {
    return null;
  }
  const ambiguous = ambiguousWords(lexicon, spellings);
  const original = lineTable(source);
  const canonLines = canonical.split('\n');
  // 不变式：canonicalize 保持行数不变；万一对不上就无法逐行找回，每个值都按整篇源码计（宁可多拒）
  const linesAligned = canonLines.length === original.length;
  const wholeLines = (from: number, to: number): OffsetRange => [
    original[from - 1]!.start,
    original[to - 1]!.start + original[to - 1]!.text.length,
  ];
  // 一个值 token 下面最多映射到的区间：所在的整行（跨行 token 为其各行）
  const widest = (t: Token): OffsetRange =>
    linesAligned ? wholeLines(t.start.line, Math.min(t.end.line, original.length)) : [0, source.length];
  const relevant = (t: Token): boolean => structural === undefined || structural.some((s) => overlaps(widest(t), s));
  // 关键词形态的词与冠词/关键词同形，作为值时按整行计、不推进逐行游标，先剔除不影响其余 token 的找回位置
  const values = candidates.filter((c) => !c.probe || !relevant(c.token) || c.probe()).map((c) => c.token);
  if (!linesAligned) return values.map((): OffsetRange => [0, source.length]);
  const cursor = new Map<number, number>();

  return values.map((t): OffsetRange => {
    const line = t.start.line;
    const orig = original[line - 1]!;
    if (t.end.line !== line) return wholeLines(line, Math.min(t.end.line, original.length));
    const raw = (canonLines[line - 1] ?? '').slice(t.start.col - 1, t.end.col - 1);
    if (ambiguous.has(raw.toLowerCase())) return wholeLines(line, line);
    const found = raw ? findLoose(orig.text, raw, cursor.get(line) ?? 0) : null;
    if (!found) return wholeLines(line, line);
    cursor.set(line, found.at + found.len);
    return [orig.start + found.at, orig.start + found.at + found.len];
  });
}
