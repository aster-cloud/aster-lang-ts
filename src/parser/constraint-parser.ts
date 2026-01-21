/**
 * CNL 约束解析器
 *
 * 解析 CNL 约束语法，替代原有的注解解析器。
 *
 * 支持的约束语法：
 * - `required` - 必填约束
 * - `between X and Y` - 范围约束（同时指定最小和最大值）
 * - `at least X` - 最小值约束
 * - `at most Y` - 最大值约束
 * - `matching pattern "..."` 或 `matching "..."` - 正则模式约束
 *
 * 多个约束可以通过 `and` 或逗号连接：
 * - `username: Text required matching "^[a-z]+$"`
 * - `age: Int between 18 and 120`
 */

import { KW, TokenKind } from '../frontend/tokens.js';
import type { Constraint, ConstraintRequired, ConstraintRange, ConstraintPattern, Span, Token } from '../types.js';
import type { ParserContext } from './context.js';

/**
 * 解析约束列表
 *
 * 在类型之后解析可选的约束列表，直到遇到字段分隔符（逗号、and）或语句终止符。
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @returns 约束数组和第一个约束的 token（用于 span 计算）
 */
export interface ParsedConstraints {
  readonly constraints: readonly Constraint[];
  readonly lastToken?: Token;
}

export function parseConstraints(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): ParsedConstraints {
  const constraints: Constraint[] = [];
  let lastToken: Token | undefined;

  while (true) {
    const constraint = tryParseConstraint(ctx, error);
    if (!constraint) {
      break;
    }

    constraints.push(constraint.constraint);
    lastToken = constraint.endToken;

    // 检查是否还有后续约束
    if (isConstraintKeyword(ctx)) {
      continue;
    }
    if (skipConstraintConnector(ctx)) {
      continue;
    }

    break;
  }

  // 使用条件扩展确保 exactOptionalPropertyTypes 兼容
  return lastToken !== undefined
    ? { constraints, lastToken }
    : { constraints };
}

/**
 * 检查当前位置是否是约束关键词
 */
function isConstraintKeyword(ctx: ParserContext): boolean {
  return isConstraintToken(ctx.peek());
}

function isConstraintToken(token: Token | undefined): boolean {
  if (!token) return false;
  if (
    token.kind !== TokenKind.IDENT &&
    token.kind !== TokenKind.TYPE_IDENT &&
    token.kind !== TokenKind.KEYWORD
  ) {
    return false;
  }
  const value = ((token.value as string) || '').toLowerCase();
  return (
    value === KW.REQUIRED ||
    value === KW.BETWEEN ||
    value === KW.MATCHING ||
    value === 'at'
  );
}

/**
 * 获取下一个非布局 token（跳过换行/缩进），便于判断连接词后的 token 类型
 */
function nextSignificantToken(ctx: ParserContext, startIndex: number): Token | null {
  let idx = startIndex;
  while (idx < ctx.tokens.length) {
    const token = ctx.tokens[idx]!;
    if (
      token.kind === TokenKind.NEWLINE ||
      token.kind === TokenKind.INDENT ||
      token.kind === TokenKind.DEDENT
    ) {
      idx++;
      continue;
    }
    return token;
  }
  return null;
}

/**
 * 跳过约束之间的连接符（',' 或 'and'）
 */
function skipConstraintConnector(ctx: ParserContext): boolean {
  const current = ctx.peek();

  if (current.kind === TokenKind.COMMA) {
    const nextToken = nextSignificantToken(ctx, ctx.index + 1);
    if (isConstraintToken(nextToken ?? undefined)) {
      ctx.next(); // consume comma
      ctx.consumeNewlines();
      ctx.consumeIndent();
      return true;
    }
    return false;
  }

  if (
    (current.kind === TokenKind.IDENT ||
      current.kind === TokenKind.TYPE_IDENT ||
      current.kind === TokenKind.KEYWORD) &&
    ((current.value as string) || '').toLowerCase() === KW.AND
  ) {
    const nextToken = nextSignificantToken(ctx, ctx.index + 1);
    if (isConstraintToken(nextToken ?? undefined)) {
      ctx.nextWord(); // consume 'and'
      ctx.consumeNewlines();
      ctx.consumeIndent();
      return true;
    }
  }

  return false;
}

interface ParsedConstraint {
  readonly constraint: Constraint;
  readonly endToken: Token;
}

/**
 * 尝试解析单个约束
 *
 * @returns 解析的约束，如果当前位置不是约束则返回 null
 */
function tryParseConstraint(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): ParsedConstraint | null {
  const startToken = ctx.peek();
  if (!isConstraintToken(startToken)) {
    return null;
  }

  const value = ((startToken.value as string) || '').toLowerCase();

  // 'required' - 必填约束
  if (value === KW.REQUIRED) {
    const startTok = ctx.next();
    const span: Span = { start: startTok.start, end: startTok.end };
    const constraint: ConstraintRequired = { kind: 'Required', span };
    return { constraint, endToken: startTok };
  }

  // 'between X and Y' - 范围约束
  if (value === KW.BETWEEN) {
    return parseBetweenConstraint(ctx, error);
  }

  // 'at least X' / 'at most Y' - 单边范围约束
  if (value === 'at') {
    return parseAtConstraint(ctx, error);
  }

  // 'matching [pattern] "..."' - 模式约束
  if (value === KW.MATCHING) {
    return parseMatchingConstraint(ctx, error);
  }

  return null;
}

/**
 * 解析 'between X and Y' 约束
 */
function parseBetweenConstraint(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): ParsedConstraint {
  const startTok = ctx.next(); // consume 'between'

  // 解析最小值
  const minTok = ctx.peek();
  if (!ctx.at(TokenKind.INT) && !ctx.at(TokenKind.FLOAT)) {
    error("约束 'between' 后需要数值作为最小值", minTok);
  }
  const min = ctx.next().value as number;

  // 期望 'and'
  if (!ctx.isKeyword(KW.AND)) {
    error("约束 'between X' 后需要 'and Y' 指定最大值", ctx.peek());
  }
  ctx.nextWord(); // consume 'and'

  // 解析最大值
  const maxTok = ctx.peek();
  if (!ctx.at(TokenKind.INT) && !ctx.at(TokenKind.FLOAT)) {
    error("约束 'between X and' 后需要数值作为最大值", maxTok);
  }
  const max = ctx.next().value as number;

  const span: Span = { start: startTok.start, end: maxTok.end };
  const constraint: ConstraintRange = { kind: 'Range', min, max, span };
  return { constraint, endToken: maxTok };
}

/**
 * 解析 'at least X' 或 'at most Y' 约束
 */
function parseAtConstraint(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): ParsedConstraint {
  const startTok = ctx.next(); // consume 'at'

  // 检查是 'least' 还是 'most'
  const modifierTok = ctx.peek();
  if (!ctx.at(TokenKind.IDENT)) {
    error("'at' 后需要 'least' 或 'most'", modifierTok);
  }

  const modifier = ((modifierTok.value as string) || '').toLowerCase();
  if (modifier !== 'least' && modifier !== 'most') {
    error("'at' 后需要 'least' 或 'most'", modifierTok);
  }
  ctx.next(); // consume 'least' / 'most'

  // 解析数值
  const valueTok = ctx.peek();
  if (!ctx.at(TokenKind.INT) && !ctx.at(TokenKind.FLOAT)) {
    error(`约束 'at ${modifier}' 后需要数值`, valueTok);
  }
  const value = ctx.next().value as number;

  const span: Span = { start: startTok.start, end: valueTok.end };

  let constraint: ConstraintRange;
  if (modifier === 'least') {
    constraint = { kind: 'Range', min: value, span };
  } else {
    constraint = { kind: 'Range', max: value, span };
  }

  return { constraint, endToken: valueTok };
}

/**
 * 解析 'matching [pattern] "..."' 约束
 */
function parseMatchingConstraint(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): ParsedConstraint {
  const startTok = ctx.next(); // consume 'matching'

  // 可选的 'pattern' 关键字
  if (ctx.at(TokenKind.IDENT) && ((ctx.peek().value as string) || '').toLowerCase() === KW.PATTERN) {
    ctx.next(); // consume 'pattern'
  }

  // 解析正则表达式字符串
  const regexpTok = ctx.peek();
  if (!ctx.at(TokenKind.STRING)) {
    error("约束 'matching' 后需要正则表达式字符串", regexpTok);
  }
  const regexp = ctx.next().value as string;

  const span: Span = { start: startTok.start, end: regexpTok.end };
  const constraint: ConstraintPattern = { kind: 'Pattern', regexp, span };
  return { constraint, endToken: regexpTok };
}

/**
 * 将旧的 Annotation 转换为新的 Constraint（用于迁移）
 *
 * @deprecated 仅用于迁移期间的兼容性
 */
export function annotationToConstraint(
  annotation: { name: string; params: ReadonlyMap<string, unknown> },
  span: Span
): Constraint | null {
  switch (annotation.name) {
    case 'NotEmpty':
      return { kind: 'Required', span };
    case 'Range': {
      const min = annotation.params.get('min') as number | undefined;
      const max = annotation.params.get('max') as number | undefined;
      // 使用条件扩展确保 exactOptionalPropertyTypes 兼容
      return {
        kind: 'Range',
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max }),
        span,
      } as ConstraintRange;
    }
    case 'Pattern': {
      const regexp = annotation.params.get('regexp') as string;
      if (!regexp) return null;
      return { kind: 'Pattern', regexp, span };
    }
    default:
      return null;
  }
}
