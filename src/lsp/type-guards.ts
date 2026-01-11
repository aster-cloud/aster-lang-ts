/**
 * LSP Navigation 类型守卫
 * 提供类型安全的类型检查函数，替代 `as any` 类型断言
 */

import type {
  Func as AstFunc,
  Data as AstData,
  Enum as AstEnum,
  Block as AstBlock,
  Span,
} from '../types.js';

/**
 * 类型守卫：检查是否为带有 decls 的 Module
 */
export function isModule(ast: unknown): ast is { decls: readonly any[] } {
  return (
    ast !== null &&
    typeof ast === 'object' &&
    'decls' in ast &&
    Array.isArray((ast as any).decls)
  );
}

/**
 * 类型守卫：检查是否为 Token 数组
 */
export function isTokenArray(tokens: unknown): tokens is readonly any[] {
  return Array.isArray(tokens);
}

/**
 * 类型守卫：检查节点是否有 span 字段
 */
export function hasSpan(node: unknown): node is { span: Span } {
  return (
    node !== null &&
    typeof node === 'object' &&
    'span' in node &&
    typeof (node as any).span === 'object'
  );
}

/**
 * 类型守卫：检查节点是否有 variantSpans 字段
 */
export function hasVariantSpans(node: unknown): node is { variantSpans: Span[] | undefined } {
  return (
    node !== null &&
    typeof node === 'object' &&
    'variantSpans' in node
  );
}

/**
 * 类型守卫：检查节点是否有 nameSpan 字段
 */
export function hasNameSpan(node: unknown): node is { nameSpan: Span | undefined } {
  return (
    node !== null &&
    typeof node === 'object' &&
    'nameSpan' in node
  );
}

/**
 * 安全地获取 AST 节点的 decls
 */
export function getDecls(ast: unknown): readonly any[] {
  if (isModule(ast)) {
    return ast.decls;
  }
  return [];
}

/**
 * 类型守卫：检查是否为 Func 声明
 */
export function isAstFunc(decl: unknown): decl is AstFunc {
  return (
    decl !== null &&
    typeof decl === 'object' &&
    'kind' in decl &&
    (decl as any).kind === 'Func'
  );
}

/**
 * 类型守卫：检查是否为 Data 声明
 */
export function isAstData(decl: unknown): decl is AstData {
  return (
    decl !== null &&
    typeof decl === 'object' &&
    'kind' in decl &&
    (decl as any).kind === 'Data'
  );
}

/**
 * 类型守卫：检查是否为 Enum 声明
 */
export function isAstEnum(decl: unknown): decl is AstEnum {
  return (
    decl !== null &&
    typeof decl === 'object' &&
    'kind' in decl &&
    (decl as any).kind === 'Enum'
  );
}

/**
 * 类型守卫：检查是否为 Block 节点
 */
export function isAstBlock(node: unknown): node is AstBlock {
  return (
    node !== null &&
    typeof node === 'object' &&
    'kind' in node &&
    (node as any).kind === 'Block'
  );
}

/**
 * 安全地获取节点的 span，如果不存在则返回 undefined
 */
export function getSpan(node: unknown): Span | undefined {
  return hasSpan(node) ? node.span : undefined;
}

/**
 * 安全地获取节点的 nameSpan，如果不存在则返回 undefined
 */
export function getNameSpan(node: unknown): Span | undefined {
  return hasNameSpan(node) ? node.nameSpan : undefined;
}

/**
 * 安全地获取枚举的 variantSpans，如果不存在则返回空数组
 */
export function getVariantSpans(node: unknown): (Span | undefined)[] {
  if (hasVariantSpans(node)) {
    return node.variantSpans || [];
  }
  return [];
}

/**
 * 类型守卫：检查是否为 Statement 数组
 */
export function isStatementArray(arr: unknown): arr is readonly any[] {
  return Array.isArray(arr);
}

/**
 * 类型守卫：检查节点是否有 statements 字段
 */
export function hasStatements(node: unknown): node is { statements: readonly any[] } {
  return (
    node !== null &&
    typeof node === 'object' &&
    'statements' in node &&
    Array.isArray((node as any).statements)
  );
}

/**
 * 安全地获取节点的 statements，如果不存在则返回空数组
 */
export function getStatements(node: unknown): readonly any[] {
  return hasStatements(node) ? node.statements : [];
}
