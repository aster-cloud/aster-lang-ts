/**
 * 导入和模块头解析器
 * 负责解析模块声明和导入语句
 */

import { KW, TokenKind } from '../frontend/tokens.js';
import type { Token } from '../types.js';
import type { ParserContext } from './context.js';
import { kwParts } from './context.js';
import { Diagnostics } from '../diagnostics/diagnostics.js';

/**
 * 解析点号分隔的标识符（用于模块名和导入名）
 * 语法: foo.bar.baz 或 Foo.Bar.Baz
 *
 * @param ctx 解析器上下文
 * @param _error 错误报告函数
 * @returns 点号连接的完整标识符字符串
 */
export function parseDottedIdent(
  ctx: ParserContext,
  _error: (msg: string, tok?: Token) => never
): string {
  const parts: string[] = [];

  // 允许点号分隔的标识符首段为普通标识符或类型标识符
  if (ctx.at(TokenKind.IDENT)) {
    parts.push(ctx.next().value as string);
  } else if (ctx.at(TokenKind.TYPE_IDENT)) {
    parts.push(ctx.next().value as string);
  } else {
    Diagnostics.expectedIdentifier(ctx.peek().start).throw();
  }

  // 继续解析点号连接的后续部分
  while (
    ctx.at(TokenKind.DOT) &&
    ctx.tokens[ctx.index + 1] &&
    (ctx.tokens[ctx.index + 1]!.kind === TokenKind.IDENT ||
      ctx.tokens[ctx.index + 1]!.kind === TokenKind.TYPE_IDENT)
  ) {
    ctx.next(); // 消费点号
    if (ctx.at(TokenKind.IDENT)) {
      parts.push(ctx.next().value as string);
    } else if (ctx.at(TokenKind.TYPE_IDENT)) {
      parts.push(ctx.next().value as string);
    }
  }

  return parts.join('.');
}

/**
 * 解析模块头声明
 * 语法: Module foo.bar.
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @param expectDot 期望点号的辅助函数
 * @returns void（模块名通过副作用设置到 ctx.moduleName）
 */
export function parseModuleHeader(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never,
  expectDot: () => void
): void {
  // 期望: Module
  ctx.nextWords(kwParts(KW.MODULE_IS));

  // 解析模块名
  ctx.moduleName = parseDottedIdent(ctx, error);

  // 期望句点结束
  expectDot();
}

// ADR 0046：档案 id 形态（与注册表 profiles[].id 及 Java AstBuilder 一致）
const PROFILE_ID_REGEX = '^[a-z][a-z0-9-]{0,63}$';
const PROFILE_ID = new RegExp(PROFILE_ID_REGEX);
export const PROFILE_MISPLACED = 'Profile must follow the Module header and appear at most once';

/** ADR 0046：模块头之后的下一条声明是否为 Profile（关键词文本须与 Java 一致，精确为 Profile）。 */
export function atProfileDecl(ctx: ParserContext): boolean {
  return ctx.at(TokenKind.TYPE_IDENT, 'Profile');
}

/**
 * 解析治理档案声明（ADR 0046）
 * 语法: Profile "eu-ai-act-high-risk".
 *
 * 只能紧跟模块头且至多一条；位置由调用方保证，此处只在重复时报错。
 * id 用字符串字面量书写（两个引擎的词法都把 `-` 切成 MINUS）。
 */
export function parseProfileDecl(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never,
  expectDot: () => void
): void {
  const kwTok = ctx.next();
  if (ctx.moduleProfile !== null) error(PROFILE_MISPLACED, kwTok);
  const idTok = ctx.peek();
  if (!ctx.at(TokenKind.STRING)) error('Expected profile id string after Profile', idTok);
  const id = ctx.next().value as string;
  if (!PROFILE_ID.test(id)) error(`Profile id must match ${PROFILE_ID_REGEX}: ${id}`, idTok);
  expectDot();
  ctx.moduleProfile = id;
}

/**
 * 解析导入语句
 * 语法: use foo.bar. 或 use foo.bar version 2 as Baz.
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @param expectDot 期望点号的辅助函数
 * @param parseIdent 解析标识符的辅助函数
 * @returns 导入信息 { name: 模块名, version: 版本号或null, asName: 别名或null }
 */
export function parseImport(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never,
  expectDot: () => void,
  parseIdent: () => string
): { name: string; version: number | null; asName: string | null } {
  // 期望: use
  ctx.nextWord();

  // 解析导入的模块名
  const name = parseDottedIdent(ctx, error);
  let version: number | null = null;
  let asName: string | null = null;

  // 检查是否有版本子句
  if (ctx.isKeyword(KW.VERSION)) {
    ctx.nextWord();
    if (!ctx.at(TokenKind.INT)) {
      error("Expected integer after 'version'", ctx.peek());
    }
    version = ctx.next().value as number;
  }

  // 检查是否有别名
  if (ctx.isKeyword(KW.AS)) {
    ctx.nextWord();
    // 允许别名为普通标识符或类型标识符（如：use Http as H.）
    if (ctx.at(TokenKind.TYPE_IDENT)) {
      asName = ctx.next().value as string;
    } else {
      asName = parseIdent();
    }
  }

  // 期望句点结束
  expectDot();

  return { name, version, asName };
}
