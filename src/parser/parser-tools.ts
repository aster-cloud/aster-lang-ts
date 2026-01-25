/**
 * 解析器工具函数集合
 * 提供错误报告、期望验证和标识符解析等辅助功能
 */

import { TokenKind } from '../frontend/tokens.js';
import type { Token } from '../types.js';
import { Diagnostics } from '../diagnostics/diagnostics.js';
import type { ParserContext } from './context.js';

/**
 * 解析器工具函数接口
 */
export interface ParserTools {
  /**
   * 报告解析错误并中止
   * @param msg 错误消息
   * @param tok 可选的错误位置 token（默认使用当前 token）
   */
  error: (msg: string, tok?: Token) => never;

  /**
   * 期望并消费指定关键字
   * @param kw 期望的关键字
   * @param msg 错误消息
   */
  expectKeyword: (kw: string, msg: string) => void;

  /**
   * 期望并消费点号
   */
  expectDot: () => void;

  /**
   * 期望逗号（如果存在则消费，否则跳过）
   */
  expectCommaOr: () => void;

  /**
   * 期望并消费换行符
   */
  expectNewline: () => void;

  /**
   * 解析普通标识符
   * @returns 标识符字符串
   */
  parseIdent: () => string;

  /**
   * 解析类型标识符
   * @returns 类型标识符字符串
   */
  parseTypeIdent: () => string;
}

/**
 * 创建解析器工具函数集合
 * @param ctx 解析器上下文
 * @returns 工具函数集合
 */
export function createParserTools(ctx: ParserContext): ParserTools {
  return {
    error(msg: string, tok: Token = ctx.peek()): never {
      Diagnostics.unexpectedToken(msg, tok.start).withMessage(msg).throw();
      throw new Error('unreachable');
    },

    expectKeyword(kw: string, msg: string): void {
      if (!ctx.isKeyword(kw))
        Diagnostics.expectedKeyword(kw, ctx.peek().start).withMessage(msg).throw();
      ctx.nextWord();
    },

    expectDot(): void {
      if (!ctx.at(TokenKind.DOT))
        Diagnostics.expectedPunctuation('.', ctx.peek().start).throw();
      ctx.next();
    },

    expectCommaOr(): void {
      if (ctx.at(TokenKind.COMMA)) {
        ctx.next();
      }
    },

    expectNewline(): void {
      if (!ctx.at(TokenKind.NEWLINE))
        Diagnostics.expectedToken('newline', ctx.peek().kind, ctx.peek().start).throw();
      ctx.next();
    },

    parseIdent(): string {
      if (!ctx.at(TokenKind.IDENT))
        Diagnostics.expectedIdentifier(ctx.peek().start).throw();
      return ctx.next().value as string;
    },

    parseTypeIdent(): string {
      // Accept both TYPE_IDENT and IDENT to support languages without capitalization (e.g., Chinese)
      // In English, type names are capitalized (User, Order) -> TYPE_IDENT
      // In Chinese, type names look like regular words (用户, 订单) -> IDENT
      if (!ctx.at(TokenKind.TYPE_IDENT) && !ctx.at(TokenKind.IDENT))
        Diagnostics.expectedToken('Type identifier', ctx.peek().kind, ctx.peek().start).throw();
      return ctx.next().value as string;
    },
  };
}
