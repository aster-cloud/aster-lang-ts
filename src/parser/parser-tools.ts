/**
 * 解析器工具函数集合
 * 提供错误报告、期望验证和标识符解析等辅助功能
 */

import { TokenKind } from '../frontend/tokens.js';
import type { Token } from '../types.js';
import { Diagnostics } from '../diagnostics/diagnostics.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { keywordAsNameIssue, lowercaseKeywordNameIssue, type ParseErrorFn, type ParseIssue } from './parse-issue.js';
import type { ParserContext } from './context.js';
import { tryReadTranslatedIdent } from './context.js';

/**
 * 解析器工具函数接口
 */
export interface ParserTools {
  /**
   * 报告解析错误并中止
   * @param issue 错误码、命名参数与英文消息（见 parse-issue.ts）
   * @param tok 可选的错误位置 token（默认使用当前 token）
   */
  error: ParseErrorFn;

  /**
   * 期望并消费指定关键字
   * @param kw 期望的关键字
   * @param issue 缺失时报告的诊断
   */
  expectKeyword: (kw: string, issue: ParseIssue) => void;

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
  /** issue 非空时报告并中止，定位在当前 token（与结构关键词的 E901 同一报法）。 */
  const throwIssue = (issue: ParseIssue | null): void => {
    if (!issue) return;
    Diagnostics.unexpectedToken(issue.message, ctx.peek().start)
      .withErrorCode(issue.code, issue.params)
      .withMessage(issue.message)
      .throw();
  };
  return {
    error(issue: ParseIssue, tok: Token = ctx.peek()): never {
      Diagnostics.unexpectedToken(issue.message, tok.start)
        .withErrorCode(issue.code, issue.params)
        .withMessage(issue.message)
        .throw();
      throw new Error('unreachable');
    },

    expectKeyword(kw: string, issue: ParseIssue): void {
      if (!ctx.isKeyword(kw))
        Diagnostics.expectedKeyword(kw, ctx.peek().start)
          .withErrorCode(issue.code, issue.params)
          .withMessage(issue.message)
          .throw();
      ctx.nextWord();
    },

    expectDot(): void {
      if (!ctx.at(TokenKind.DOT))
        Diagnostics.expectedPunctuation('.', ctx.peek().start)
          .withErrorCode(ErrorCode.PARSE_EXPECTED_STATEMENT_END, { token: "'.'" })
          .throw();
      ctx.next();
    },

    expectCommaOr(): void {
      if (ctx.at(TokenKind.COMMA)) {
        ctx.next();
      }
    },

    expectNewline(): void {
      if (!ctx.at(TokenKind.NEWLINE))
        Diagnostics.expectedToken('newline', ctx.peek().kind, ctx.peek().start)
          .withErrorCode(ErrorCode.PARSE_EXPECTED, { token: 'token.newline' })
          .throw();
      ctx.next();
    },

    parseIdent(): string {
      // 小写关键词不能作名字（产品裁决 D4）：规则名、类型参数、导入别名
      throwIssue(lowercaseKeywordNameIssue(ctx, ctx.peek(), 'token.identifier'));
      // 先尝试还原"被翻译成关键词的标识符"（OF 家族当函数名/导入别名等标识符位置，
      // 非英文词法包）。与 aster-lang-core 引擎口径一致。
      const recovered = tryReadTranslatedIdent(ctx);
      if (recovered !== null) return recovered;
      if (!ctx.at(TokenKind.IDENT)) {
        // 规则名位置的结构关键词报 E901（ADR 0056 修订 A6 K1），其余照旧 E055
        const keywordIssue = keywordAsNameIssue(ctx, ctx.peek());
        if (keywordIssue) {
          Diagnostics.unexpectedToken(keywordIssue.message, ctx.peek().start)
            .withErrorCode(keywordIssue.code, keywordIssue.params)
            .withMessage(keywordIssue.message)
            .throw();
        }
        Diagnostics.expectedIdentifier(ctx.peek().start).throw();
      }
      return ctx.next().value as string;
    },

    parseTypeIdent(): string {
      // 小写关键词不能作类型名（产品裁决 D4，`Type and as Int.`）
      throwIssue(lowercaseKeywordNameIssue(ctx, ctx.peek(), 'token.typeName'));
      // 先尝试还原"被翻译成关键词的标识符"（非英文词法包，类型名与关键词同形）。
      const recovered = tryReadTranslatedIdent(ctx);
      if (recovered !== null) return recovered;
      // 只在声明处使用（Define 的类型名、类型别名名）：结构关键词报 E901（ADR 0056 修订 A6 K1），与 core declaredTypeName 一致
      const keywordIssue = keywordAsNameIssue(ctx, ctx.peek());
      if (keywordIssue) {
        Diagnostics.unexpectedToken(keywordIssue.message, ctx.peek().start)
          .withErrorCode(keywordIssue.code, keywordIssue.params)
          .withMessage(keywordIssue.message)
          .throw();
      }
      // Accept both TYPE_IDENT and IDENT to support languages without capitalization (e.g., Chinese)
      // In English, type names are capitalized (User, Order) -> TYPE_IDENT
      // In Chinese, type names look like regular words (用户, 订单) -> IDENT
      if (!ctx.at(TokenKind.TYPE_IDENT) && !ctx.at(TokenKind.IDENT))
        Diagnostics.expectedToken('Type identifier', ctx.peek().kind, ctx.peek().start)
          .withErrorCode(ErrorCode.PARSE_EXPECTED, { token: 'token.typeName' })
          .throw();
      return ctx.next().value as string;
    },
  };
}
