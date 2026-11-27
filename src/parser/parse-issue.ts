/**
 * 解析诊断的「码 + 命名参数 + 英文消息」三元组（ADR 0051 §16 R56）。
 *
 * 解析器的每个报错点都必须给出共享码表 E050–E069 中的一个码与命名参数；`message` 只是英文渲染结果。
 * message 必须显式给出并沿用改码前的原句：参数是结构化值（`kw.*` / `token.*`），不能直接代入英文
 * 模板，且 aster-cloud 过渡期仍按英文原句反查译文。按码取译文的消费方用 code + params 渲染。
 *
 * 参数取值约定见 {@link ParseDiagnosticParams}：关键词 `kw.<规范关键词>`、抽象 token / 构造
 * `token.<名称>`、字面片段带单引号。
 */

import { ErrorCode } from '../diagnostics/error_codes.js';
import type { ParseDiagnosticParams } from '../diagnostics/diagnostics.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { TokenKind, type Token } from '../types.js';
import { kwq } from './keyword-display.js';

export interface ParseIssue {
  readonly code: ErrorCode;
  readonly params: ParseDiagnosticParams;
  readonly message: string;
}

/** 报告解析错误并中止。所有解析器报错点统一使用此签名（不再接受裸字符串）。 */
export type ParseErrorFn = (issue: ParseIssue, tok?: Token) => never;

function issue(code: ErrorCode, params: ParseDiagnosticParams, message: string): ParseIssue {
  return { code, params, message };
}

/** 关键词槽位参数。 */
export const kwParam = (canonical: string): string => `kw.${canonical.toLowerCase()}`;
/** 抽象 token / 语法构造参数。 */
export const tokenName = (name: string): string => `token.${name}`;
/** 字面片段参数（带单引号）。 */
export const lit = (text: string): string => `'${text}'`;

/** 每个码一个构造函数；参数名与 shared/error_codes.json 模板一一对应。 */
export const Issue = {
  expected: (token: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_EXPECTED, { token }, message),
  expectedBefore: (token: string, before: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_EXPECTED_BEFORE, { token, before }, message),
  expectedAfter: (token: string, after: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_EXPECTED_AFTER, { token, after }, message),
  expectedIn: (token: string, context: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_EXPECTED_IN, { token, context }, message),
  expectedAfterIn: (token: string, after: string, context: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_EXPECTED_AFTER_IN, { token, after, context }, message),
  expectedStatementEnd: (token: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_EXPECTED_STATEMENT_END, { token }, message),
  unexpected: (token: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_UNEXPECTED_TOKEN, { token }, message),
  unexpectedExpecting: (token: string, expected: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_UNEXPECTED_EXPECTING, { token, expected }, message),
  unexpectedConstruct: (construct: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_UNEXPECTED_CONSTRUCT, { construct }, message),
  noViable: (token: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_NO_VIABLE, { token }, message),
  indentation: (message: string): ParseIssue =>
    issue(ErrorCode.PARSE_INDENTATION, {}, message),
  misplaced: (construct: string, position: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_MISPLACED, { construct, position }, message),
  emptyBlock: (block: string, item: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_EMPTY_BLOCK, { block, item }, message),
  invalidValue: (construct: string, value: string | number, allowed: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_INVALID_VALUE, { construct, value, allowed }, message),
  callArity: (callee: string, expected: number, actual: number, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_CALL_ARITY, { callee, expected, actual }, message),
  unknownName: (kind: string, name: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_UNKNOWN_NAME, { kind, name }, message),
  /** E900（ADR 0055 #3）：同一注解内参数名重复；解析码段 E050–E069 用满后的续段。 */
  duplicateAnnotationArg: (annotation: string, name: string): ParseIssue =>
    issue(ErrorCode.PARSE_DUPLICATE_ANNOTATION_ARG, { annotation, name }, `Annotation @${annotation} repeats the argument ${name}`),
  /** E901（ADR 0056 修订 A6 K1）：名字位置上的结构关键词；keyword 为 `kw.*` 槽位，kind 为 SemanticTokenKind 名。 */
  keywordAsName: (keyword: string, kind: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_KEYWORD_AS_NAME, { keyword, kind }, message),
} as const;

/**
 * 结构关键词的英文规范拼写 → 关键词槽位（ADR 0056 修订 A6 K1）。本地化拼写（zh `返回`、de `wenn`、hi `जब`…）经翻译都成为
 * 这些拼写，因此这张表同时覆盖四个语言包。与 aster-lang-core `AstBuilder.STRUCTURAL_KEYWORD_NAMES` 逐项相同。
 */
export const STRUCTURAL_KEYWORD_NAMES: ReadonlyMap<string, { readonly slot: string; readonly kind: string }> = new Map([
  ['Define', { slot: 'define', kind: 'TYPE_DEF' }],
  ['If', { slot: 'if', kind: 'IF' }],
  ['Let', { slot: 'let', kind: 'LET' }],
  ['Match', { slot: 'match', kind: 'MATCH' }],
  ['Otherwise', { slot: 'otherwise', kind: 'OTHERWISE' }],
  ['Return', { slot: 'return', kind: 'RETURN' }],
  ['Rule', { slot: 'rule', kind: 'FUNC_TO' }],
  ['When', { slot: 'when', kind: 'WHEN' }],
]);

/**
 * E901（ADR 0056 修订 A6 K1，产品裁决 Q5）：名字位置上的结构关键词。两引擎都拒绝并同码报告；此前 ts 报泛化的 E055、
 * core 经软关键字把它收作名字（zh 形参 `返回` 静默改名为 `Return`）。英文小写写法（`return`、`when`）是普通 IDENT，不受影响。
 * 不是结构关键词时返回 null，调用方照常报 E055。名字转义 `` `If` `` 永远是名字（ADR 0064 N3），也返回 null；
 * 消息建议的正是这种写法。
 */
export function keywordAsNameIssue(ctx: { readonly lexicon?: Lexicon | undefined }, tok: Token): ParseIssue | null {
  if ((tok.kind !== TokenKind.TYPE_IDENT && tok.kind !== TokenKind.KEYWORD) || tok.originalValue !== undefined || tok.escaped) return null;
  const keyword = STRUCTURAL_KEYWORD_NAMES.get(String(tok.value));
  if (!keyword) return null;
  return Issue.keywordAsName(
    kwParam(keyword.slot),
    keyword.kind,
    `${kwq(ctx, keyword.slot, String(tok.value))} is the keyword ${keyword.kind} and cannot be used as a name; write it in backticks to use it as a name`,
  );
}

/**
 * 小写拼写不能作名字的关键词（产品裁决 D4，eco-1.0.57）：aster-lang-core 里它们的小写拼写是词法记号，在任何名字位置都报语法错误，
 * ts 此前却收作名字（`given and as Int`、`Let to be x`、zh `并且` 作字段名）。两引擎因此对同一份源码一侧编译一侧报错。
 * 首字母大写等其余拼写是同形词，照旧是名字（两引擎一致）；名字转义 `` `and` `` 永远是名字（ADR 0064 N3），消息建议的正是这种写法。
 */
export const LOWERCASE_KEYWORD_NAMES: ReadonlySet<string> = new Set([
  'and', 'or', 'not', 'as', 'with', 'to', 'set', 'use', 'on', 'plus', 'minus', 'times', 'modulo', 'async', 'has', 'produce',
]);

/**
 * D4：名字位置上的小写关键词报 E055（参数同该位置原有的 E055：`token` 为期望的名字种类），消息带转义提示。
 * 本地化关键词经翻译得到的记号（de `und`、zh `并且` → `and`）同样拒绝（core 同样拒绝）；翻译后的记号不带源码原文，
 * 非英文源码的消息用本语言包的关键词拼写（kwq），不给具体的转义写法。不是这些关键词时返回 null。
 */
export function lowercaseKeywordNameIssue(
  ctx: { readonly lexicon?: Lexicon | undefined },
  tok: Token | undefined,
  expected: string,
): ParseIssue | null {
  if (!tok || tok.kind !== TokenKind.IDENT || tok.escaped) return null;
  const value = String(tok.value);
  if (!LOWERCASE_KEYWORD_NAMES.has(value)) return null;
  if (tok.originalValue === undefined && ctx.lexicon && ctx.lexicon.id.toLowerCase() !== 'en-us') {
    // 非英文源码：记号是翻译后的规范拼写，源码里写的可能是本地化关键词（de `und`、zh `并且`），提示不给具体写法
    return issue(
      ErrorCode.PARSE_EXPECTED,
      { token: expected },
      `${kwq(ctx, value)} is a keyword and cannot be used as a name; write the name in backticks to use it as a name`,
    );
  }
  const written = tok.originalValue ?? value;
  return issue(
    ErrorCode.PARSE_EXPECTED,
    { token: expected },
    `'${written}' is a keyword and cannot be used as a name; write it in backticks (\`${written}\`) to use it as a name`,
  );
}

/** 源码 token 作为字面片段参数（取其文本；无文本时取词法种类）。 */
export const tokenLit = (tok: Token): string => lit(String(tok.value ?? tok.kind));

/**
 * 声明头里的换行（aster-lang-ts#357 第 3 行，ADR 0056 修订 A4 §2）：与 core 同码，报在换行处。
 *
 * core 的 ANTLR 先试单 token 删除：删掉这个换行后，下一个 token 正是此处可接受的记号（同列续写，如 `Rule` ⏎ `f …`、
 * 无逗号的 `… as Int` ⏎ `produce …`）时报 E061「多余的换行」；下一行缩进、空行、文件末或此处不可接受的记号时报 E062
 * 「意外的换行，期望 …」。`nextAccepted` 由调用方按该位置可接受的记号判断。
 */
export function headerNewlineIssue(nextAccepted: boolean, expected: string, expectedText: string): ParseIssue {
  if (nextAccepted) return issue(ErrorCode.PARSE_UNEXPECTED_TOKEN, { token: tokenName('newline') }, 'Unexpected newline');
  return issue(ErrorCode.PARSE_UNEXPECTED_EXPECTING, { token: tokenName('newline'), expected }, `Unexpected newline; expected ${expectedText}`);
}

/** 越过当前换行看下一个 token 是否满足 `accepts`，不消费（位置原样恢复）。 */
export function acceptedAfterNewline(ctx: { index: number; next(): Token }, accepts: () => boolean): boolean {
  const saved = ctx.index;
  ctx.next();
  try {
    return accepts();
  } finally {
    ctx.index = saved;
  }
}
