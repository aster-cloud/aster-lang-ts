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

/**
 * 解析导入语句
 * 语法: use foo.bar. 或 use foo.bar as Baz.
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @param expectDot 期望点号的辅助函数
 * @param parseIdent 解析标识符的辅助函数
 * @returns 导入信息 { name: 模块名, asName: 别名或null }
 */
export function parseImport(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never,
  expectDot: () => void,
  parseIdent: () => string
): { name: string; asName: string | null } {
  // 期望: use
  ctx.nextWord();

  // 解析导入的模块名
  const name = parseDottedIdent(ctx, error);
  let asName: string | null = null;

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

  return { name, asName };
}
