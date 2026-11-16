/**
 * 类型位置补全（ADR 0058 §8.1）。
 *
 * 类型位置：字段 / 参数 / Let 注解的类型关键词之后、返回类型关键词之后、
 * 类型参数列表内、类型别名 `as` 之后。其它位置（表达式、语句开头）不给类型项。
 * 候选来自本文档声明（Data / Enum / 类型别名 / 导入别名）与按 lexicon 本地化的内置类型；
 * 不补全导入模块的成员（ADR 0051 §16.3 R58 延后）。
 */
import type { CompletionItem } from 'vscode-languageserver/node.js';
import { CompletionItemKind } from 'vscode-languageserver/node.js';
import { TokenKind } from '../frontend/tokens.js';
import type { Token, Module as AstModule } from '../types.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { SemanticTokenKind } from '../config/token-kind.js';
import { foldKey } from '../config/lexicons/identifiers/casefold.js';
import { VERDICT_TYPE_NAME } from '../typecheck/verdict_signatures.js';
import { typeText } from './completion.js';

type Pos = { line: number; character: number };
type Coord = { readonly line: number; readonly col: number };

/** 语句边界：换行与冒号（标题行结束）。缩进变化的 token 总跟在换行之后，且文末会合成零宽 DEDENT，一律忽略。 */
const BOUNDARY_KINDS: ReadonlySet<unknown> = new Set([TokenKind.NEWLINE, TokenKind.COLON]);
const SKIP_KINDS: ReadonlySet<unknown> = new Set([TokenKind.COMMENT, TokenKind.INDENT, TokenKind.DEDENT]);

/**
 * 该文档语言中某关键字的全部写法（规范拼写 + 别名），每种写法按空白切成小写词序列：
 * 多词关键字（`option of`、de `Option aus`、de `Ergebnis aus`）在 token 流里是多个 token，须按序列匹配。
 */
function phrasesOf(lexicon: Lexicon, kind: SemanticTokenKind): string[][] {
  const words = [lexicon.keywords[kind], ...(lexicon.aliases?.[kind] ?? [])].filter((w): w is string => !!w);
  return words.map((w) => w.toLowerCase().split(/\s+/).filter(Boolean)).filter((p) => p.length > 0);
}

/**
 * 不随 lexicon 本地化的类型构造词：`list of T`、`map K to V`、`Pair of A and B` 的 of
 * 在所有语言里都按英文书写（type-parser 直接匹配这些字面量，lexicon 中没有对应类别）。
 */
const LIST_OF: readonly string[] = ['list', 'of'];
const MAP: readonly string[] = ['map'];
const OF: readonly string[] = ['of'];

/** words 中以下标 end（不含）结尾的一段是否恰为 phrase */
function endsWith(words: readonly string[], end: number, phrase: readonly string[]): boolean {
  if (end < phrase.length) return false;
  return phrase.every((w, i) => words[end - phrase.length + i] === w);
}
const endsWithAny = (words: readonly string[], end: number, phrases: readonly (readonly string[])[]): boolean =>
  phrases.some((p) => endsWith(words, end, p));
/** words 中任意位置是否出现 phrases 之一 */
const containsAny = (words: readonly string[], phrases: readonly (readonly string[])[]): boolean =>
  words.some((_, i) => endsWithAny(words, i + 1, phrases));

const valueOf = (t: Token | undefined): string => (typeof t?.value === 'string' ? t.value.toLowerCase() : '');
const endsAtOrBefore = (a: Coord, b: Coord): boolean => a.line < b.line || (a.line === b.line && a.col <= b.col);

/** 光标之前的有效 token（不含注释 / 缩进 / EOF，也不含正在输入的名字前缀，按出现顺序）。 */
function tokensBefore(tokens: readonly Token[], pos: Pos): Token[] {
  const cursor: Coord = { line: pos.line + 1, col: pos.character + 1 };
  const before = tokens.filter((t) => t.end && !SKIP_KINDS.has(t.kind) && t.kind !== TokenKind.EOF && endsAtOrBefore(t.end, cursor));
  const last = before[before.length - 1];
  const typing = last && last.end.line === cursor.line && last.end.col === cursor.col
    && (last.kind === TokenKind.IDENT || last.kind === TokenKind.TYPE_IDENT);
  if (typing) before.pop();
  return before;
}

/** 句点后紧跟空白才是语句结束；`foo.bar` 中的点不是边界 */
function dotEndsStatement(t: Token, next: Token | undefined): boolean {
  return t.kind === TokenKind.DOT && (!next || next.start.line !== t.end.line || next.start.col > t.end.col);
}

/** before 中当前语句（换行 / 冒号 / 语句句点之后）的起始下标 */
function statementStart(before: readonly Token[]): number {
  let from = before.length;
  while (from > 0 && !BOUNDARY_KINDS.has(before[from - 1]!.kind) && !dotEndsStatement(before[from - 1]!, before[from])) from--;
  return from;
}

/** before[i] 之前最近的非换行 token 下标（跨行：多行字段 / 形参列表的续行看上一行行尾）；没有时为 -1 */
function prevSignificant(before: readonly Token[], i: number): number {
  let j = i - 1;
  while (j >= 0 && before[j]!.kind === TokenKind.NEWLINE) j--;
  return j;
}

const isName = (t: Token | undefined): boolean => t?.kind === TokenKind.IDENT || t?.kind === TokenKind.TYPE_IDENT;

/** before 中以下标 end（不含）结尾的一段 token 词是否恰为 phrases 之一（多词关键字须在同一语句内连续出现） */
function tokensEndWith(before: readonly Token[], end: number, phrases: readonly (readonly string[])[]): boolean {
  return phrases.some((p) => end >= p.length && p.every((w, k) => valueOf(before[end - p.length + k]) === w));
}

/**
 * 语法角色判定所需的词表：引出名字槽的关键词（字段 has / with、形参 given、续接 and、Let、类型别名 Type）
 * 与函数头关键词（Rule）。逗号按 token 种类判定。
 */
interface Roles {
  readonly nameIntroducers: readonly (readonly string[])[];
  readonly funcHead: readonly (readonly string[])[];
}

function rolesOf(lexicon: Lexicon): Roles {
  return {
    nameIntroducers: [
      ...[SemanticTokenKind.TYPE_HAS, SemanticTokenKind.TYPE_WITH, SemanticTokenKind.FUNC_GIVEN, SemanticTokenKind.AND, SemanticTokenKind.LET]
        .flatMap((k) => phrasesOf(lexicon, k)),
      TYPE_ALIAS_HEAD,
    ],
    funcHead: phrasesOf(lexicon, SemanticTokenKind.FUNC_TO),
  };
}

/** 类型别名声明 `Type X as T` 的引导词不随 lexicon 本地化 */
const TYPE_ALIAS_HEAD: readonly string[] = ['type'];

/** before[i] 之前（可跨行）是否紧跟名字引导词；逗号单独判定 */
function afterIntroducer(before: readonly Token[], i: number, roles: Roles): boolean {
  const j = prevSignificant(before, i);
  return j >= 0 && tokensEndWith(before, j + 1, roles.nameIntroducers);
}

/** before[i] 是否处在名字槽：紧跟在逗号或名字引导词之后（可跨行） */
function inNameSlot(before: readonly Token[], i: number, roles: Roles): boolean {
  const j = prevSignificant(before, i);
  return j >= 0 && (before[j]!.kind === TokenKind.COMMA || afterIntroducer(before, i, roles));
}

/** before[i] 所在逻辑语句（跨换行，止于冒号 / 语句句点）是否以函数头关键词开头 */
function inFunctionHeader(before: readonly Token[], i: number, roles: Roles): boolean {
  let from = i;
  while (from > 0 && before[from - 1]!.kind !== TokenKind.COLON && !dotEndsStatement(before[from - 1]!, before[from])) from--;
  const head = before.slice(from).filter((t) => t.kind !== TokenKind.NEWLINE);
  return roles.funcHead.some((p) => p.every((w, k) => valueOf(head[k]) === w));
}

/** 光标前的 token 与光标后第一个有效 token（判断逗号后的 produce 是不是形参名时要看它后面是否跟 as） */
interface Context {
  readonly before: readonly Token[];
  readonly afterCursor: Token | undefined;
  readonly lexicon: Lexicon;
  readonly roles: Roles;
}

/**
 * `as`（IMPORT_ALIAS）是否为类型锚点：前一个 token 须是处在名字槽的名字
 * （`has x as`、`given x as`、`, y as`、`Let x as`、`Type S as`，名字槽可在上一行行尾）。
 * `Return as`、`given as`（正在写形参名）中的 as 是值或名字本身。
 */
function isAliasAnchor(ctx: Context, start: number): boolean {
  const name = prevSignificant(ctx.before, start);
  return name >= 0 && isName(ctx.before[name]) && inNameSlot(ctx.before, name, ctx.roles);
}

/**
 * `produce`（FUNC_PRODUCE）是否为返回类型锚点：
 * - 紧跟名字引导词（`given produce`）时是形参名；
 * - 紧跟逗号时是返回类型关键词，除非其后紧跟 as（`, produce as Int` 是形参名）；
 * - 否则须处在函数头内（`Rule f produce`、`给定 a 作为 A 产出`）；`Return produce` 中的 produce 是值。
 */
function isProduceAnchor(ctx: Context, start: number, end: number): boolean {
  const { before, roles } = ctx;
  if (afterIntroducer(before, start, roles)) return false;
  const prev = prevSignificant(before, start);
  if (prev < 0) return false;
  if (before[prev]!.kind === TokenKind.COMMA) {
    const next = end < before.length ? before[end] : ctx.afterCursor;
    return !phrasesOf(ctx.lexicon, SemanticTokenKind.IMPORT_ALIAS).some((p) => p[0] === valueOf(next));
  }
  return inFunctionHeader(before, start, roles);
}

/** before 中以下标 end（不含）结尾的一段是否为按语法角色成立的类型锚点（as / produce） */
function anchorEndsAt(ctx: Context, end: number): boolean {
  const { before, lexicon } = ctx;
  const hit = (kind: SemanticTokenKind): readonly string[] | undefined =>
    phrasesOf(lexicon, kind).find((p) => tokensEndWith(before, end, [p]));
  const alias = hit(SemanticTokenKind.IMPORT_ALIAS);
  if (alias && isAliasAnchor(ctx, end - alias.length)) return true;
  const produce = hit(SemanticTokenKind.FUNC_PRODUCE);
  return !!produce && isProduceAnchor(ctx, end - produce.length, end);
}

/** 光标之后第一个有效 token */
function tokenAfter(tokens: readonly Token[], pos: Pos): Token | undefined {
  const cursor: Coord = { line: pos.line + 1, col: pos.character + 1 };
  return tokens.find((t) => t.end && !SKIP_KINDS.has(t.kind) && t.kind !== TokenKind.NEWLINE && !endsAtOrBefore(t.end, cursor));
}

/**
 * 光标是否位于类型位置。
 * 语句以「引用」关键字开头时 `as` 引入的是导入别名，不是类型。
 * 锚点（as / produce）按语法角色识别：与关键词同形的形参 / 局部名出现在表达式里时不算锚点。
 */
export function isTypePosition(tokens: readonly Token[], pos: Pos, lexicon: Lexicon): boolean {
  const before = tokensBefore(tokens, pos);
  const from = statementStart(before);
  const words = before.slice(from).map(valueOf);
  if (words.length === 0) return false;
  if (phrasesOf(lexicon, SemanticTokenKind.IMPORT).some((p) => endsWith(words, p.length, p))) return false;
  const ctx: Context = { before, afterCursor: tokenAfter(tokens, pos), lexicon, roles: rolesOf(lexicon) };
  if (anchorEndsAt(ctx, before.length)) return true;

  // 类型参数列表：锚点（as / produce）之后的类型构造词，Let 的 `be` 之后不再是类型
  const anchorEnd = words.findIndex((_, i) => anchorEndsAt(ctx, from + i + 1));
  if (anchorEnd < 0) return false;
  const tail = words.slice(anchorEnd + 1);
  if (containsAny(tail, phrasesOf(lexicon, SemanticTokenKind.BE))) return false;
  const resultOf = phrasesOf(lexicon, SemanticTokenKind.RESULT_OF);
  const openers = [OF, MAP, ...phrasesOf(lexicon, SemanticTokenKind.MAYBE), ...phrasesOf(lexicon, SemanticTokenKind.OPTION_OF), ...resultOf];
  const end = tail.length;
  if (endsWithAny(tail, end, openers)) return true;
  // `Pair of A and ` / `result of A and `（zh `结果 整数 并且 ` 没有 of）之后是下一个类型参数
  const and = phrasesOf(lexicon, SemanticTokenKind.AND).find((p) => endsWith(tail, end, p));
  if (and) return andContinuesType(tail.slice(0, end - and.length), lexicon);
  if (endsWithAny(tail, end, phrasesOf(lexicon, SemanticTokenKind.TO_WORD))) return containsAny(tail, [MAP]);
  return false;
}

/** 未闭合的类型构造词：还差几个参数、参数之间用哪个连接词 */
interface OpenConstructor { need: number; readonly sep: 'and' | 'to' | null }

/**
 * `and` 是否引出下一个类型参数：最内层未闭合的构造词须取两个以 and 连接的参数
 * （`result of A and B`、泛型 `Pair of A and B`），且第一个参数已写完。
 * `list of` / `option of` / `maybe` 只取一个参数，`list of Int and ` 中的 and 不在类型里。
 */
function andContinuesType(words: readonly string[], lexicon: Lexicon): boolean {
  // 词序列 → 引入的构造词（参数个数、连接词）；连接词本身不引入构造词
  const kinds: Array<[readonly (readonly string[])[], OpenConstructor | null]> = [
    [phrasesOf(lexicon, SemanticTokenKind.RESULT_OF), { need: 2, sep: 'and' }],
    [[LIST_OF, ...phrasesOf(lexicon, SemanticTokenKind.OPTION_OF), ...phrasesOf(lexicon, SemanticTokenKind.MAYBE)], { need: 1, sep: null }],
    [[MAP], { need: 2, sep: 'to' }],
    [[...phrasesOf(lexicon, SemanticTokenKind.AND), ...phrasesOf(lexicon, SemanticTokenKind.TO_WORD)], null],
  ];
  const open: OpenConstructor[] = [];
  // 一个完整的类型参数：填入最内层构造词；填满则该构造词本身成为外层的一个参数
  const fill = (): void => {
    while (open.length > 0 && --open[open.length - 1]!.need === 0) open.pop();
  };
  let i = 0;
  while (i < words.length) {
    const startsAt = (p: readonly string[]): boolean => p.every((w, j) => words[i + j] === w);
    const hit = kinds.flatMap(([phrases, frame]) => phrases.filter(startsAt).map((p) => ({ len: p.length, frame })))[0];
    if (hit) {
      if (hit.frame) open.push({ ...hit.frame });
      i += hit.len;
    } else if (words[i + 1] === OF[0]) {
      // 名字后紧跟 of 是泛型构造（`Pair of A and B`）
      open.push({ need: 2, sep: 'and' });
      i += 2;
    } else {
      fill();
      i++;
    }
  }
  const top = open[open.length - 1];
  return top?.sep === 'and' && top.need === 1;
}

/** 内置类型关键词的 lexicon 类别（Text / Int / Float / Bool）；Verdict 不本地化，单独加入 */
const BUILTIN_KINDS: readonly SemanticTokenKind[] = [
  SemanticTokenKind.TEXT,
  SemanticTokenKind.INT_TYPE,
  SemanticTokenKind.FLOAT_TYPE,
  SemanticTokenKind.BOOL_TYPE,
];

/** 类型构造关键词的 lexicon 类别（maybe / option of / result of）；值构造词（ok of、some of、none）不属类型位置 */
const TYPE_CONSTRUCTOR_KINDS: readonly SemanticTokenKind[] = [
  SemanticTokenKind.MAYBE,
  SemanticTokenKind.OPTION_OF,
  SemanticTokenKind.RESULT_OF,
];

/**
 * 类型位置的候选：本文档 Data / Enum（Class / Enum）、类型别名（TypeParameter，detail 为目标类型）、
 * 导入别名（Module，detail 为模块路径）、本地化内置类型与治理返回类型 Verdict（Class）、
 * 类型构造词（Keyword：本地化的 maybe / option of / result of，以及不本地化的 list of / map）。
 * 按 ADR 0051 §6.3 折叠后的规范名去重，先出现者保留（本文档声明优先于内置类型）。
 */
export function typeCompletions(ast: AstModule | null, lexicon: Lexicon): CompletionItem[] {
  const items = new Map<string, CompletionItem>();
  const add = (label: string, kind: CompletionItemKind, detail?: string): void => {
    const key = foldKey(label);
    if (items.has(key)) return;
    items.set(key, { label, kind, data: label, ...(detail ? { detail } : {}) });
  };
  for (const d of ast?.decls ?? []) {
    if (d.kind === 'Data') add(d.name, CompletionItemKind.Class);
    else if (d.kind === 'Enum') add(d.name, CompletionItemKind.Enum);
  }
  for (const a of ast?.typeAliasDecls ?? []) add(a.name, CompletionItemKind.TypeParameter, typeText(a.type));
  for (const d of ast?.decls ?? []) {
    if (d.kind === 'Import' && d.asName) add(d.asName, CompletionItemKind.Module, d.name);
  }
  for (const kind of BUILTIN_KINDS) {
    for (const word of [lexicon.keywords[kind], ...(lexicon.aliases?.[kind] ?? [])]) {
      if (word) add(word, CompletionItemKind.Class);
    }
  }
  // 治理规则的返回类型 Verdict 不随 lexicon 本地化
  add(VERDICT_TYPE_NAME, CompletionItemKind.Class);
  for (const kind of TYPE_CONSTRUCTOR_KINDS) {
    for (const word of [lexicon.keywords[kind], ...(lexicon.aliases?.[kind] ?? [])]) {
      if (word) add(word, CompletionItemKind.Keyword);
    }
  }
  for (const phrase of [LIST_OF, MAP]) add(phrase.join(' '), CompletionItemKind.Keyword);
  return [...items.values()];
}
