/**
 * LSP DocumentSymbol 处理器
 * 提供文档符号树（大纲视图）
 */

import type {
  Connection,
  DocumentSymbol,
  DocumentSymbolParams
} from 'vscode-languageserver/node.js';
import { SymbolKind } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { formatFieldDetail } from '../completion.js';
import { parse } from '../../parser.js';
import {
  getSpan,
  getNameSpan,
  getVariantSpans,
  getStatements,
  isAstBlock,
} from '../type-guards.js';
import { spanOrDoc, funcDetail } from './shared.js';
import type {
  Module as AstModule,
  Declaration as AstDecl,
  Func as AstFunc,
  Data as AstData,
  Enum as AstEnum,
  Block as AstBlock,
  Span,
} from '../../types.js';

/**
 * 收集块内符号（递归遍历）
 * @param b 块 AST 节点
 * @param parent 父符号
 * @param doc 文档对象
 */
function collectBlockSymbols(b: AstBlock, parent: DocumentSymbol, doc: TextDocument): void {
  const statements = getStatements(b);
  for (const s of statements) {
    if (s.kind === 'Let') {
      const letS = s;
      const sp = getSpan(letS);
      parent.children!.push({
        name: letS.name,
        kind: SymbolKind.Variable,
        range: spanOrDoc(sp, doc),
        selectionRange: spanOrDoc(sp, doc),
      });
    } else if (isAstBlock(s)) {
      const sp = getSpan(s);
      const bs: DocumentSymbol = {
        name: 'block',
        kind: SymbolKind.Namespace,
        range: spanOrDoc(sp, doc),
        selectionRange: spanOrDoc(sp, doc),
        children: [],
      };
      collectBlockSymbols(s, bs, doc);
      parent.children!.push(bs);
    } else if (s.kind === 'If') {
      // Collect nested blocks
      const thenB = s.thenBlock as AstBlock;
      const sp = getSpan(s);
      const thenS: DocumentSymbol = {
        name: 'if',
        kind: SymbolKind.Namespace,
        range: spanOrDoc(sp, doc),
        selectionRange: spanOrDoc(sp, doc),
        children: [],
      };
      collectBlockSymbols(thenB, thenS, doc);
      if (s.elseBlock) collectBlockSymbols(s.elseBlock as AstBlock, thenS, doc);
      parent.children!.push(thenS);
    } else if (s.kind === 'Match') {
      const sp = getSpan(s);
      const ms: DocumentSymbol = {
        name: 'match',
        kind: SymbolKind.Namespace,
        range: spanOrDoc(sp, doc),
        selectionRange: spanOrDoc(sp, doc),
        children: [],
      };
      for (const c of s.cases) {
        if (c.body.kind === 'Block') collectBlockSymbols(c.body as AstBlock, ms, doc);
      }
      parent.children!.push(ms);
    }
  }
}

/**
 * 注册 DocumentSymbol 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getOrParse 文档解析函数
 */
export function registerDocumentSymbolHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any }
): void {
  connection.onDocumentSymbol((params: DocumentSymbolParams) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const entry = getOrParse(doc);
    const { tokens: toks, ast } = entry;
    try {
      const ast2 = (ast as AstModule) || (parse(toks).ast as AstModule);
      const symbols: DocumentSymbol[] = [];

      // Module symbol (if named)
      if (ast2.name) {
        symbols.push({
          name: ast2.name,
          kind: SymbolKind.Module,
          range: spanOrDoc(ast2.span, doc),
          selectionRange: spanOrDoc(ast2.span, doc),
          children: [],
        });
      }

      const pushChild = (parent: DocumentSymbol | null, sym: DocumentSymbol): void => {
        if (parent) {
          (parent.children ??= []).push(sym);
        } else {
          symbols.push(sym);
        }
      };

      // Top-level decls
      const moduleParent = symbols.find(s => s.kind === SymbolKind.Module) ?? null;
      for (const d of ast2.decls as AstDecl[]) {
        switch (d.kind) {
          case 'Data': {
            const data = d as AstData;
            const sp = getSpan(data);
            const ds: DocumentSymbol = {
              name: data.name,
              kind: SymbolKind.Struct,
              range: spanOrDoc(sp, doc),
              selectionRange: spanOrDoc(sp, doc),
              children: [],
              detail: 'type',
            };
            // fields
            for (const f of data.fields) {
              const fsp = getSpan(f);
              ds.children!.push({
                name: f.name,
                kind: SymbolKind.Field,
                range: spanOrDoc(fsp, doc),
                selectionRange: spanOrDoc(fsp, doc),
                detail: formatFieldDetail(f),
              });
            }
            pushChild(moduleParent, ds);
            break;
          }
          case 'Enum': {
            const en = d as AstEnum;
            const sp = getSpan(en);
            const es: DocumentSymbol = {
              name: en.name,
              kind: SymbolKind.Enum,
              range: spanOrDoc(sp, doc),
              selectionRange: spanOrDoc(sp, doc),
              children: [],
            };
            const vspans: (Span | undefined)[] = getVariantSpans(en);
            for (let vi = 0; vi < en.variants.length; vi++) {
              const v = en.variants[vi]!;
              const vsp = vspans[vi];
              es.children!.push({ name: v, kind: SymbolKind.EnumMember, range: spanOrDoc(vsp, doc), selectionRange: spanOrDoc(vsp, doc) });
            }
            pushChild(moduleParent, es);
            break;
          }
          case 'Func': {
            const f = d as AstFunc;
            const sp = getSpan(f);
            const nsp = getNameSpan(f) ?? sp;
            const fs: DocumentSymbol = {
              name: f.name,
              kind: SymbolKind.Function,
              range: spanOrDoc(sp, doc),
              selectionRange: spanOrDoc(nsp, doc),
              children: [],
              detail: funcDetail(f),
            };
            // params
            for (const p of f.params) {
              const psp = getSpan(p);
              fs.children!.push({
                name: p.name,
                kind: SymbolKind.Variable,
                range: spanOrDoc(psp, doc),
                selectionRange: spanOrDoc(psp, doc),
                detail: formatFieldDetail(p),
              });
            }
            // locals from body
            if (f.body) collectBlockSymbols(f.body, fs, doc);
            pushChild(moduleParent, fs);
            break;
          }
          default:
            break;
        }
      }
      return symbols;
    } catch {
      return [];
    }
  });
}
