/**
 * LSP Workspace 文档索引器
 * 负责解析文档内容并提取符号信息
 */

import type { Range } from 'vscode-languageserver-types';
import { canonicalize } from '../../frontend/canonicalizer.js';
import { lex } from '../../frontend/lexer.js';
import { parse } from '../../parser.js';
import type { Module as AstModule, Span } from '../../types.js';
import type { ModuleIndex, SymbolInfo } from './types.js';
import { setModuleIndex, invalidateDocument as invalidateDocumentInternal } from './index-manager.js';

// 重新导出 invalidateDocument 以保持向后兼容
export { invalidateDocument } from './index-manager.js';

/**
 * 更新指定文档的索引内容。
 * @param uri 目标文档的 URI。
 * @param content 文档最新内容。
 * @returns 更新完成后的模块索引。
 */
export async function updateDocumentIndex(uri: string, content: string): Promise<ModuleIndex> {
  try {
    const canonical = canonicalize(content);
    const tokens = lex(canonical);
    const ast = parse(tokens) as AstModule;

    const symbols: SymbolInfo[] = [];
    const decls = Array.isArray((ast as any)?.decls) ? ((ast as any).decls as any[]) : [];
    for (const decl of decls) {
      const kind = decl?.kind as string | undefined;
      if (!kind || (kind !== 'Func' && kind !== 'Data' && kind !== 'Enum')) {
        continue;
      }
      const name = (decl as any)?.name as string | undefined;
      if (!name) continue;
      const span = (decl as any)?.span as Span | undefined;
      const nameSpan = (decl as any)?.nameSpan as Span | undefined;

      const symbol: SymbolInfo = {
        name,
        kind: kind === 'Func' ? 'function' : 'type',
        range: ensureRange(span),
      };
      const selectionRange = optionalRange(nameSpan);
      if (selectionRange) {
        symbol.selectionRange = selectionRange;
      }
      symbols.push(symbol);
    }

    const astName = typeof ast?.name === 'string' && ast.name.length > 0 ? ast.name : null;
    const moduleName = astName ?? extractModuleName(content);
    const moduleIndex: ModuleIndex = {
      uri,
      moduleName,
      symbols,
      lastModified: Date.now(),
    };

    setModuleIndex(uri, moduleIndex);
    return moduleIndex;
  } catch (err) {
    invalidateDocumentInternal(uri);
    throw err;
  }
}

/**
 * 将 Span 转换为 Range，确保有效范围
 */
function ensureRange(span: Span | undefined): Range {
  if (span) {
    return {
      start: { line: Math.max(0, span.start.line - 1), character: Math.max(0, span.start.col - 1) },
      end: { line: Math.max(0, span.end.line - 1), character: Math.max(0, span.end.col - 1) },
    };
  }
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

/**
 * 将可选的 Span 转换为 Range
 */
function optionalRange(span: Span | undefined): Range | undefined {
  if (!span) return undefined;
  return ensureRange(span);
}

/**
 * 从文本中提取模块名称
 */
function extractModuleName(text: string): string | null {
  const match = text.match(/Module ([A-Za-z][A-Za-z0-9_.]*)\./);
  return match?.[1] ?? null;
}
