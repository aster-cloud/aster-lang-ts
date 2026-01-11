/**
 * Aster Language Parser - 主入口
 * 负责协调各个子模块完成整个模块的解析
 */

import { Node } from './ast/ast.js';
import type { Module, Token } from './types.js';
import { createParserContext } from './parser/context.js';
import { createParserTools } from './parser/parser-tools.js';
import { collectTopLevelDecls } from './parser/decl-parser.js';
import {
  assignSpan,
  firstSignificantToken,
  lastSignificantTokenInStream,
  spanFromTokens,
} from './parser/span-utils.js';

/**
 * 解析标记流生成 AST
 * @param tokens 词法标记数组
 * @returns 模块 AST
 */
export function parse(tokens: readonly Token[]): Module {
  const moduleStart = firstSignificantToken(tokens);
  const ctx = createParserContext(tokens);
  const tools = createParserTools(ctx);
  const decls = collectTopLevelDecls(ctx, tools);
  const moduleNode = Node.Module(ctx.moduleName, decls);
  const moduleEnd = lastSignificantTokenInStream(tokens);
  assignSpan(moduleNode, spanFromTokens(moduleStart, moduleEnd));
  return moduleNode;
}
