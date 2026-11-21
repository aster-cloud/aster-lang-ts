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
import type { Token } from '../types.js';

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
} as const;

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
