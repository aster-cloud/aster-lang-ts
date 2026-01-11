/**
 * @module ast
 *
 * AST（抽象语法树）模块。
 *
 * 包含：
 * - AST 节点构造器 (Node)
 * - AST 访问者模式 (AstVisitor, DefaultAstVisitor)
 */

export { Node } from './ast.js';
export { DefaultAstVisitor, DefaultTypeVisitor } from './ast_visitor.js';
export type { AstVisitor, TypeVisitor } from './ast_visitor.js';
