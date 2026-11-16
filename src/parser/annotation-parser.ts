/**
 * 注解解析（ADR 0055 #3）：声明级注解（`@entry Rule …`）与形参注解（`given @pii(L1, email) y as Text`）共用。
 * 名字、参数与取值的规则与 Java AstBuilder.visitAnnotation 一致。
 */

import { TokenKind } from '../frontend/tokens.js';
import type { Annotation, AnnotationArg, AnnotationValue, Token } from '../types.js';
import type { ParserContext } from './context.js';
import { Issue, lit, tokenName, type ParseErrorFn } from './parse-issue.js';

/**
 * 注解参数值（ADR 0055 #3）：只接受字符串、Int32 整数、布尔与标识符（按字符串）。
 * 浮点、Long 字面量与 null 在 v2 IR 中没有对应形状，报 E067（与 Java AstBuilder 同码同参数，控制裁决）；
 * 其它 token 报「需要注解参数值」。
 */
function parseAnnotationValue(ctx: ParserContext, error: ParseErrorFn): AnnotationValue {
  const tok = ctx.peek();
  switch (tok.kind) {
    case TokenKind.STRING:
    case TokenKind.INT:
    case TokenKind.BOOL:
      ctx.next();
      return tok.value as AnnotationValue;
    case TokenKind.IDENT:
    case TokenKind.TYPE_IDENT:
      ctx.next();
      return tok.value as string;
    case TokenKind.FLOAT:
    case TokenKind.LONG:
    case TokenKind.NULL: {
      const text = tok.kind === TokenKind.NULL ? 'null' : tok.raw ?? String(tok.value);
      return error(Issue.invalidValue(
        tokenName('annotationArgumentValue'),
        text,
        'string, Int or Bool',
        `Annotation argument value must be a string, Int or Bool: ${text}`
      ), tok);
    }
    default:
      return error(Issue.expected(tokenName('annotationArgumentValue'), 'Expected annotation argument value'), tok);
  }
}

/** 当前位置是否为 `name: value` 形式的命名注解参数（标识符后紧跟冒号）。 */
function isNamedAnnotationArg(ctx: ParserContext): boolean {
  return (ctx.at(TokenKind.IDENT) || ctx.at(TokenKind.TYPE_IDENT)) && ctx.peek(1)?.kind === TokenKind.COLON;
}

function parseAnnotationArgs(ctx: ParserContext, error: ParseErrorFn, annotation: string): readonly AnnotationArg[] | undefined {
  if (!ctx.at(TokenKind.LPAREN)) return undefined;
  ctx.next();
  const args: AnnotationArg[] = [];
  // 位置参数按出现顺序编号为 $0、$1…，与 Java AstBuilder 的键名一致；可与命名参数混用。
  let positionalIndex = 0;
  while (!ctx.at(TokenKind.RPAREN) && !ctx.at(TokenKind.EOF)) {
    if (!isNamedAnnotationArg(ctx)) {
      const value = parseAnnotationValue(ctx, error);
      args.push({ name: `$${positionalIndex++}`, value });
    } else {
      const nameTok = ctx.next();
      const name = String(nameTok.value);
      // ADR 0055 #3：同一注解内参数名重复在解析期报 E900（IR 不变式 dup-annotation-arg 兜底）
      if (args.some(a => a.name === name)) error(Issue.duplicateAnnotationArg(annotation, name), nameTok);
      ctx.next();
      const value = parseAnnotationValue(ctx, error);
      args.push({ name, value });
    }
    if (ctx.at(TokenKind.COMMA)) {
      ctx.next();
      continue;
    }
    break;
  }
  if (!ctx.at(TokenKind.RPAREN)) {
    error(Issue.expectedAfter(lit(')'), tokenName('annotationArguments'), "Expected ')' after annotation arguments"));
  }
  ctx.next();
  return args;
}

/**
 * 连续的注解 `@name` / `@name(args)`。声明级注解之间允许换行（betweenLines），
 * 形参注解与规则头同处一行（aster-lang-core#266），不跳过换行，与 core 文法 `param: annotation* …` 一致。
 */
export function parseAnnotations(
  ctx: ParserContext,
  error: ParseErrorFn,
  betweenLines: boolean
): { annotations: readonly Annotation[]; startTok?: Token } {
  const annotations: Annotation[] = [];
  let startTok: Token | undefined;
  while (ctx.at(TokenKind.AT)) {
    const atTok = ctx.next();
    startTok ??= atTok;
    if (!ctx.at(TokenKind.IDENT) && !ctx.at(TokenKind.TYPE_IDENT)) {
      error(Issue.expectedAfter(tokenName('annotationName'), lit('@'), "Expected annotation name after '@'"));
    }
    const name = String(ctx.next().value);
    const args = parseAnnotationArgs(ctx, error, name);
    annotations.push(args && args.length > 0 ? { name, args } : { name });
    if (betweenLines) ctx.consumeNewlines();
  }
  return startTok ? { annotations, startTok } : { annotations };
}

/**
 * 前瞻：从当前记号起第 offset 个（与 ctx.peek 同单位，跳过注释）开始越过一串注解（`@name` 及可选的括号参数），
 * 返回其后第一个记号的偏移；不是 `@` 时原样返回，括号不配对时返回 -1。只看不消费，
 * 供 `X of A` 的分隔符判定使用（分隔符后是带注解的下一个形参时，分隔符属于形参表）。
 */
export function skipAnnotationsFrom(ctx: ParserContext, offset: number): number {
  let i = offset;
  while (ctx.peek(i).kind === TokenKind.AT) {
    i += 2; // '@' 与注解名
    if (ctx.peek(i).kind !== TokenKind.LPAREN) continue;
    let depth = 0;
    do {
      const kind = ctx.peek(i).kind;
      if (kind === TokenKind.EOF) return -1;
      if (kind === TokenKind.LPAREN) depth++;
      if (kind === TokenKind.RPAREN) depth--;
      i++;
    } while (depth > 0);
  }
  return i;
}
