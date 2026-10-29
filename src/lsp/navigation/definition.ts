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
  ResolvedRole,
  Span,
} from '../../types.js';
import { resolveDocument, siteAt } from '../resolution.js';
import type { ResolutionSite, ResolvableDocument } from '../resolution.js';

/** 引用角色 → 可作为其定义的声明角色；LOCAL 由下方参数 / Let 逻辑处理 */
const DECL_ROLES: Readonly<Record<ResolvedRole, readonly ResolvedRole[]>> = {
  TYPE: ['TYPE_DECL'],
  TYPE_DECL: ['TYPE_DECL'],
  FUNC_REF: ['FUNC_DECL'],
  FUNC_DECL: ['FUNC_DECL'],
  FIELD_REF: ['FIELD_DECL'],
  FIELD_DECL: ['FIELD_DECL'],
  MEMBER_REF: ['MEMBER_DECL'],
  MEMBER_DECL: ['MEMBER_DECL'],
  VALUE_REF: ['FUNC_DECL', 'MEMBER_DECL'],
  LOCAL: [],
};

/**
 * 基于名称解析结果（ADR 0051 Origin）的定义位置：光标处写法 → 规范名（及父名）→ 同名声明。
 * 折叠命中（driver → Driver）、词汇本地化写法、点分路径中的字段段都由此跳到源码声明；
 * 父名未知时只在声明唯一时跳转；只有词汇条目、没有源码声明时返回 undefined。
 */
function resolvedDeclarationSpan(doc: ResolvableDocument, pos: { line: number; character: number }, word: string): Span | undefined {
  const res = resolveDocument(doc);
  const site = siteAt(res, pos, word);
  if (!site) return undefined;
  const roles = DECL_ROLES[site.role];
  const decls = res.sites.filter((s: ResolutionSite) => roles.includes(s.role) && s.canonical === site.canonical);
  if (site.parent !== undefined) return decls.find((s) => s.parent === site.parent)?.span;
  return decls.length === 1 ? decls[0]!.span : undefined;
}

/**
 * 注册 Definition 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getOrParse 文档解析函数
 */
export function registerDefinitionHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any } & Omit<ResolvableDocument, 'ast'>
): void {
  connection.onDefinition(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const entry = getOrParse(doc);
    const { tokens: toks, ast } = entry;

    // Build token index once for O(log n) lookups
    const tokenIndex = buildTokenIndex(toks);

    try {
      const ast2 = (ast as AstModule) || (parse(toks).ast as AstModule);
      // Use optimized O(log n) token lookup
      const name = tokenNameAtOptimized(tokenIndex, params.position);
      if (!name) return null;

      const resolved = resolvedDeclarationSpan(entry, params.position, name);
      if (resolved) return toLocation(doc.uri, resolved);

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
