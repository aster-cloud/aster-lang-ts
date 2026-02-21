/**
 * LSP Symbols 模块
 * 提供工作区符号搜索和文档链接功能
 */

import type { Connection, WorkspaceSymbol, DocumentLink } from 'vscode-languageserver/node.js';
import { SymbolKind } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * 注册 Symbols 相关的 LSP 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器，提供 get 方法按 URI 获取文档
 * @param getAllModules 获取所有模块的函数
 * @param ensureUri 确保 URI 格式的辅助函数
 * @param offsetToPos 偏移量转位置的辅助函数
 */
export function registerSymbolsHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getAllModules: () => Array<{
    uri: string;
    moduleName: string | null;
    symbols: Array<{
      name: string;
      kind: string;
      range: any;
      selectionRange?: any;
    }>;
  }>,
  ensureUri: (uri: string) => string,
  offsetToPos: (text: string, offset: number) => { line: number; character: number }
): void {
  // Workspace symbol search: search across all modules
  connection.onWorkspaceSymbol(({ query }): WorkspaceSymbol[] => {
    const out: WorkspaceSymbol[] = [];
    const q = (query || '').toLowerCase();
    const modules = getAllModules();
    for (const mod of modules) {
      for (const sym of mod.symbols) {
        if (q && !sym.name.toLowerCase().includes(q)) continue;
        const locationRange = sym.selectionRange ?? sym.range;
        out.push({
          name: mod.moduleName ? `${mod.moduleName}.${sym.name}` : sym.name,
          kind: sym.kind === 'function' ? SymbolKind.Function : SymbolKind.Struct,
          location: { uri: ensureUri(mod.uri), range: locationRange },
        });
      }
    }
    return out;
  });

  // Document links: module header and dotted Module.member → target module file (if known),
  // and common guide links (e.g., Text.* → interop overloads guide)
  connection.onDocumentLinks(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const text = doc.getText();
    const out: DocumentLink[] = [];
    try {
      const modules = getAllModules();
      const modulesByName = new Map<string, ReturnType<typeof getAllModules>[number]>();
      for (const m of modules) {
        if (m.moduleName) modulesByName.set(m.moduleName, m);
      }

      // Link module header to target module file
      const m = text.match(/Module ([A-Za-z][A-Za-z0-9_.]*)\./);
      if (m) {
        const mod = m[1]!;
        const rec = modulesByName.get(mod);
        if (rec && ensureUri(rec.uri) !== ensureUri(doc.uri)) {
          const startOff = (m.index ?? 0) + m[0]!.length - mod.length - 1;
          const endOff = startOff + mod.length;
          out.push({
            range: {
              start: offsetToPos(text, startOff),
              end: offsetToPos(text, endOff)
            },
            target: ensureUri(rec.uri)
          });
        }
      }

      // Link dotted Module.member to module file
      const dotted = /\b([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\b/g;
      for (let mm; (mm = dotted.exec(text)); ) {
        const full = mm[1]!;
        const dot = full.lastIndexOf('.');
        const mod = full.slice(0, dot);
        const rec = modulesByName.get(mod);
        if (!rec) continue;
        const s = mm.index!;
        out.push({
          range: {
            start: offsetToPos(text, s),
            end: offsetToPos(text, s + mod.length)
          },
          target: ensureUri(rec.uri)
        });
      }

      // Guide link for Text.* helpers: link the 'Text' part to interop-overloads guide
      const guide = toGuideUri('docs/guide/interop-overloads.md');
      if (guide) {
        const reText = /\bText\s*\./g;
        for (let m2; (m2 = reText.exec(text)); ) {
          const s = m2.index!;
          out.push({
            range: {
              start: offsetToPos(text, s),
              end: offsetToPos(text, s + 4)
            },
            target: guide
          });
        }
      }
    } catch {
      // ignore
    }
    return out;
  });
}

/**
 * 辅助函数：将相对路径转换为 file:// URI
 */
function toGuideUri(rel: string): string | null {
  try {
    const path = require('node:path');
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    if (require('node:fs').existsSync(abs)) {
      const { pathToFileURL } = require('node:url');
      return String(pathToFileURL(abs));
    }
    return null;
  } catch { return null; }
}

export { toGuideUri };
