/**
 * LSP Formatting 模块
 * 提供文档格式化和范围格式化功能
 */

import type { Connection, TextEdit, Range } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { buildCstLossless } from '../cst/cst_builder.js';
import { printRangeFromCst, printCNLFromCst } from '../cst/cst_printer.js';

/**
 * 注册 Formatting 相关的 LSP 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器，提供 get 方法按 URI 获取文档
 * @param getDocumentSettings 获取文档设置的函数
 */
export function registerFormattingHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getDocumentSettings: (uri: string) => Promise<any>
): void {
  // 范围格式化：格式化选中的文本范围
  connection.onDocumentRangeFormatting(async (params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    try {
      const settings = await getDocumentSettings(doc.uri);
      const mode = settings.format?.mode ?? 'lossless';
      const reflow = !!settings.format?.reflow;
      const text = doc.getText();
      const start = doc.offsetAt(params.range.start);
      const end = doc.offsetAt(params.range.end);
      let out: string;
      if (mode === 'lossless') {
        const cst = buildCstLossless(text);
        out = printRangeFromCst(cst, start, end, { reflow });
      } else {
        // Normalize mode: format the slice via strict formatter
        const { formatCNL } = await import('../formatter.js');
        const slice = text.slice(start, end);
        out = formatCNL(slice, { mode: 'normalize' });
      }
      const edit: TextEdit = { range: params.range, newText: out };
      return [edit];
    } catch {
      return [];
    }
  });

  // 全文档格式化
  connection.onDocumentFormatting(async (params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    try {
      const settings = await getDocumentSettings(doc.uri);
      const mode = settings.format?.mode ?? 'lossless';
      const reflow = !!settings.format?.reflow;
      const text = doc.getText();
      let out: string;
      if (mode === 'lossless') {
        const cst = buildCstLossless(text);
        out = printCNLFromCst(cst, { reflow });
      } else {
        const { formatCNL } = await import('../formatter.js');
        out = formatCNL(text, { mode: 'normalize' });
      }
      const fullRange: Range = {
        start: { line: 0, character: 0 },
        end: doc.positionAt(text.length),
      };
      const edit: TextEdit = { range: fullRange, newText: out };
      return [edit];
    } catch {
      return [];
    }
  });
}
