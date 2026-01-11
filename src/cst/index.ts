/**
 * @module cst
 *
 * CST（具体语法树）模块。
 *
 * 包含：
 * - CST 类型定义 (CstModule, CstToken)
 * - CST 构建器 (buildCst, buildCstLossless)
 * - CST 打印器 (printCNLFromCst)
 */

export type { CstModule, CstToken, InlineComment, Trivia } from './cst.js';
export { buildCst, buildCstLossless } from './cst_builder.js';
export { printCNLFromCst, printRangeFromCst } from './cst_printer.js';
