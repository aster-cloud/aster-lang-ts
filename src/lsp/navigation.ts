/**
 * LSP Navigation 模块 - 统一导出
 * 提供代码导航功能：引用查找、重命名、悬停提示、符号树、定义跳转
 */

import type { Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';

// 导出共享工具函数（向后兼容）
export {
  findTokenPositionsSafe,
  offsetToPos,
  ensureUri,
  uriToFsPath,
  tokenNameAt,
  collectLetsWithSpan,
} from './navigation/shared.js';

// 导入各个处理器注册函数
import { registerReferencesHandler } from './navigation/references.js';
import { registerRenameHandlers } from './navigation/rename.js';
import { registerHoverHandler } from './navigation/hover.js';
import { registerDefinitionHandler } from './navigation/definition.js';
import { registerDocumentSymbolHandler } from './navigation/document-symbol.js';

/**
 * 注册 Navigation 相关的 LSP 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器，提供 get 方法按 URI 获取文档
 * @param getOrParse 文档解析函数，返回文本、词法标记和 AST
 * @param getDocumentSettings 获取文档设置的函数
 */
export function registerNavigationHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined; keys(): string[] },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any },
  getDocumentSettings: (uri: string) => Promise<any>,
  getLexiconForDoc?: (uri: string) => import('../config/lexicons/types.js').Lexicon | undefined,
): void {
  // 注册各个处理器
  registerReferencesHandler(connection, documents, getDocumentSettings);
  registerRenameHandlers(connection, documents, getOrParse, getDocumentSettings);
  registerHoverHandler(connection, documents, getOrParse, getLexiconForDoc);
  registerDefinitionHandler(connection, documents, getOrParse);
  registerDocumentSymbolHandler(connection, documents, getOrParse);
}
