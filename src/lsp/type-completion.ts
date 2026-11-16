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

/** 光标之前、当前语句内的 token（不含正在输入的名字前缀，按出现顺序）。 */
function statementBefore(tokens: readonly Token[], pos: Pos): Token[] {
  const cursor: Coord = { line: pos.line + 1, col: pos.character + 1 };
  const before = tokens.filter((t) => t.end && !SKIP_KINDS.has(t.kind) && t.kind !== TokenKind.EOF && endsAtOrBefore(t.end, cursor));
  const last = before[before.length - 1];
  const typing = last && last.end.line === cursor.line && last.end.col === cursor.col
    && (last.kind === TokenKind.IDENT || last.kind === TokenKind.TYPE_IDENT);
  if (typing) before.pop();
  let from = before.length;
  while (from > 0) {
    const t = before[from - 1]!;
    const next = before[from];
    // 句点后紧跟空白才是语句结束；`foo.bar` 中的点不是边界
    const dotEndsStatement = t.kind === TokenKind.DOT && (!next || next.start.line !== t.end.line || next.start.col > t.end.col);
    if (BOUNDARY_KINDS.has(t.kind) || dotEndsStatement) break;
    from--;
  }
  return before.slice(from);
}

/**
 * 光标是否位于类型位置。
 * 语句以「引用」关键字开头时 `as` 引入的是导入别名，不是类型。
 */
export function isTypePosition(tokens: readonly Token[], pos: Pos, lexicon: Lexicon): boolean {
  const words = statementBefore(tokens, pos).map(valueOf);
  if (words.length === 0) return false;
  if (phrasesOf(lexicon, SemanticTokenKind.IMPORT).some((p) => endsWith(words, p.length, p))) return false;
  const anchors = [...phrasesOf(lexicon, SemanticTokenKind.IMPORT_ALIAS), ...phrasesOf(lexicon, SemanticTokenKind.FUNC_PRODUCE)];
  if (endsWithAny(words, words.length, anchors)) return true;

  // 类型参数列表：锚点（as / produce）之后的类型构造词，Let 的 `be` 之后不再是类型
  const anchor = words.findIndex((_, i) => endsWithAny(words, i + 1, anchors));
  if (anchor < 0) return false;
  const tail = words.slice(anchor + 1);
  if (containsAny(tail, phrasesOf(lexicon, SemanticTokenKind.BE))) return false;
  const resultOf = phrasesOf(lexicon, SemanticTokenKind.RESULT_OF);
  const openers = [OF, MAP, ...phrasesOf(lexicon, SemanticTokenKind.MAYBE), ...phrasesOf(lexicon, SemanticTokenKind.OPTION_OF), ...resultOf];
  const end = tail.length;
  if (endsWithAny(tail, end, openers)) return true;
  // `Pair of A and ` / `result of A and `（zh `结果 整数 并且 ` 没有 of）之后是下一个类型参数
  if (endsWithAny(tail, end, phrasesOf(lexicon, SemanticTokenKind.AND))) return containsAny(tail, [OF, ...resultOf]);
  if (endsWithAny(tail, end, phrasesOf(lexicon, SemanticTokenKind.TO_WORD))) return containsAny(tail, [MAP]);
  return false;
}

/** 内置类型关键词的 lexicon 类别（Text / Int / Float / Bool） */
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
 * 导入别名（Module，detail 为模块路径）、本地化内置类型（Class）、
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
  for (const kind of TYPE_CONSTRUCTOR_KINDS) {
    for (const word of [lexicon.keywords[kind], ...(lexicon.aliases?.[kind] ?? [])]) {
      if (word) add(word, CompletionItemKind.Keyword);
    }
  }
  for (const phrase of [LIST_OF, MAP]) add(phrase.join(' '), CompletionItemKind.Keyword);
  return [...items.values()];
}
