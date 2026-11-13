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
  unexpectedConstruct: (construct: string, message: string): ParseIssue =>
    issue(ErrorCode.PARSE_UNEXPECTED_CONSTRUCT, { construct }, message),
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
