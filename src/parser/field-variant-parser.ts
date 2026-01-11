/**
 * 字段和变体列表解析器
 * 负责解析数据类型的字段列表和枚举类型的变体列表
 */

import { KW, TokenKind } from '../frontend/tokens.js';
import type { Field, Span, Token, Type } from '../types.js';
import type { ParserContext } from './context.js';
import { parseType } from './type-parser.js';
import { parseConstraints } from './constraint-parser.js';
import { assignSpan, spanFromSources, spanFromTokens } from './span-utils.js';
import { inferFieldType, refineInferredType } from './type-inference.js';

/**
 * 解析字段列表（用于 Data 类型定义）
 *
 * 支持两种语法：
 * 1. 显式类型: `field1: Type1 [constraints]` - 传统语法，明确指定类型
 * 2. 推断类型: `field1 [constraints]` - CNL 语法，根据字段名和约束推断类型
 *
 * 类型推断规则：
 * - `*Id`, `*ID` → Text
 * - `*Amount`, `*Price` → Float
 * - `*Count`, `*Age`, `*Months` → Int
 * - `is*`, `has*`, `*Flag` → Bool
 * - `*Date`, `*Time` → DateTime
 * - 有 Range 约束 → Int 或 Float
 * - 有 Pattern 约束 → Text
 * - 默认 → Text
 *
 * 约束语法示例:
 * - `name required` - 必填约束（推断为 Text）
 * - `age between 18 and 120` - 范围约束（推断为 Int）
 * - `loanAmount required` - 必填（推断为 Float）
 * - `applicantId: Text required` - 显式类型 + 约束
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @returns 字段数组
 */
export function parseFieldList(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): Field[] {
  const fields: Field[] = [];
  let hasMore = true;

  while (hasMore) {
    // 在开始解析字段前，先消费换行和缩进，支持多行格式
    ctx.consumeNewlines();
    ctx.consumeIndent();

    const nameTok = ctx.peek();

    // 解析字段名（必须是普通标识符）
    if (!ctx.at(TokenKind.IDENT)) {
      error("Expected field name", nameTok);
    }
    const name = ctx.next().value as string;

    let t: Type;
    let colonTok: Token | undefined;
    let typeInferred = false;

    // 检查是否有显式类型声明（冒号）
    if (ctx.at(TokenKind.COLON)) {
      // 显式类型路径 - 向后兼容
      colonTok = ctx.peek();
      ctx.next();
      t = parseType(ctx, error);
    } else {
      // 类型推断路径 - CNL 自然语言风格
      typeInferred = true;
      // 初步推断（基于字段名），后续可能根据约束修正
      t = inferFieldType(name);
      assignSpan(t, spanFromTokens(nameTok, nameTok));
    }

    // 解析可选的约束列表
    const { constraints, lastToken: constraintEndToken } = parseConstraints(ctx, error);

    // 如果是推断类型且有约束，根据约束修正类型
    if (typeInferred && constraints.length > 0) {
      t = refineInferredType(t, constraints);
      assignSpan(t, spanFromTokens(nameTok, nameTok));
    }

    // 创建字段对象并附加 span
    const spanEnd = constraintEndToken || t;
    const fieldSpan = colonTok
      ? spanFromSources(nameTok, colonTok, spanEnd)
      : spanFromSources(nameTok, spanEnd);

    const field: Field = {
      name,
      type: t,
      ...(constraints.length > 0 ? { constraints } : {}),
      ...(typeInferred ? { typeInferred: true } : {}),
      span: fieldSpan,
    };
    fields.push(field);

    // 检查是否还有更多字段
    if (ctx.at(TokenKind.COMMA)) {
      ctx.next();
      // 逗号后允许换行和缩进
      ctx.consumeNewlines();
      ctx.consumeIndent();
      continue;
    }
    if (ctx.isKeyword(KW.AND)) {
      ctx.nextWord();
      // 'and' 后允许换行和缩进
      ctx.consumeNewlines();
      ctx.consumeIndent();
      continue;
    }
    hasMore = false;
  }

  return fields;
}

/**
 * 解析变体列表（用于 Enum 类型定义）
 * 语法: Variant1, Variant2 or Variant3
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @returns 包含变体名称数组和对应 Span 信息的对象
 */
export function parseVariantList(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): { variants: string[]; variantSpans: Span[] } {
  const vars: string[] = [];
  const spans: Span[] = [];
  let hasMore = true;

  while (hasMore) {
    const vTok = ctx.peek();

    // 解析变体名（必须是类型标识符）
    if (!ctx.at(TokenKind.TYPE_IDENT)) {
      error("Expected type identifier for variant name", vTok);
    }
    const v = ctx.next().value as string;

    // 记录变体的 span
    const endTok = ctx.tokens[ctx.index - 1] || vTok;
    spans.push({ start: vTok.start, end: endTok.end });
    vars.push(v);

    // 检查是否还有更多变体
    if (ctx.at(TokenKind.IDENT) && ((ctx.peek().value as string) || '').toLowerCase() === KW.OR) {
      ctx.nextWord();
      continue;
    }
    if (ctx.at(TokenKind.COMMA)) {
      ctx.next();
      continue;
    }
    hasMore = false;
  }

  return { variants: vars, variantSpans: spans };
}
