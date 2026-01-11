/**
 * LSP Definition 处理器
 * 提供跳转到定义功能
 */

import type { Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse } from '../../parser.js';
import { getAllModules } from '../index.js';
import { buildTokenIndex, tokenNameAt as tokenNameAtOptimized } from '../token-index.js';
import {
  findDeclAt,
  toLocation,
  enumVariantSpanMap,
  dataFieldSpanMap,
  findConstructFieldAt,
  collectLetsWithSpan,
  ensureUri,
} from './shared.js';
import {
  getSpan,
  getNameSpan,
  isAstFunc,
} from '../type-guards.js';
import type {
  Module as AstModule,
  Declaration as AstDecl,
  Block as AstBlock,
  Span,
} from '../../types.js';

/**
 * 注册 Definition 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getOrParse 文档解析函数
 */
export function registerDefinitionHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any }
): void {
  connection.onDefinition(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const { tokens: toks, ast } = getOrParse(doc);

    // Build token index once for O(log n) lookups
    const tokenIndex = buildTokenIndex(toks);

    try {
      const ast2 = (ast as AstModule) || (parse(toks) as AstModule);
      // Use optimized O(log n) token lookup
      const name = tokenNameAtOptimized(tokenIndex, params.position);
      if (!name) return null;

      // Index top-level decls
      const declMap = new Map<string, Span | undefined>();
      for (const d of ast2.decls as AstDecl[]) {
        if (d.kind === 'Func' || d.kind === 'Data' || d.kind === 'Enum') {
          // Prefer function nameSpan when present
          const nm = (d as { name: string }).name;
          const nsp = getNameSpan(d);
          const sp = getSpan(d);
          declMap.set(nm, nsp ?? sp);
        }
      }
      if (declMap.has(name)) {
        const sp = declMap.get(name);
        if (sp) return toLocation(doc.uri, sp);
      }

      // Enum variant definitions
      const vmap = enumVariantSpanMap(ast2);
      if (vmap.has(name)) return toLocation(doc.uri, vmap.get(name)!);

      // Data field definitions when hovering a field initializer
      const cf = findConstructFieldAt(ast2, params.position);
      if (cf && cf.field === name) {
        const fmap = dataFieldSpanMap(ast2);
        const key = `${cf.typeName}.${cf.field}`;
        if (fmap.has(key)) return toLocation(doc.uri, fmap.get(key)!);
      }

      // Cross-file: dotted references Module.name resolve against open-docs index
      const dot = name.lastIndexOf('.');
      if (dot > 0) {
        const mod = name.substring(0, dot);
        const mem = name.substring(dot + 1);
        const rec = getAllModules().find(m => m.moduleName === mod);
        if (rec) {
          const symbol = rec.symbols.find(s => s.name === mem);
          const range = symbol?.selectionRange ?? symbol?.range;
          if (range) return { uri: ensureUri(rec.uri), range };
        }
      }

      // If inside a function, check params and lets
      const here = findDeclAt(ast2, params.position);
      if (here && isAstFunc(here)) {
        const f = here;
        // params
        const pHit = f.params.find(p => p.name === name);
        if (pHit) {
          const psp = getSpan(pHit) || getSpan(f);
          if (psp) return toLocation(doc.uri, psp);
        }
        // lets
        const lets = collectLetsWithSpan(f.body as AstBlock | null);
        if (lets.has(name)) {
          const sp = lets.get(name)!;
          return toLocation(doc.uri, sp);
        }
      }
    } catch {
      // ignore
    }
    return null;
  });
}
