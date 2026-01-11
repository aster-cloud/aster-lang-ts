/**
 * LSP Tokens 模块
 * 提供语义标记(semantic tokens)、内联提示(inlay hints)和文档高亮功能
 */

import type {
  Connection,
  SemanticTokens,
  SemanticTokensLegend,
  SemanticTokensParams,
  DocumentHighlight,
  DocumentHighlightParams,
} from 'vscode-languageserver/node.js';
import { DocumentHighlightKind, InlayHintKind, type InlayHintParams, type InlayHint } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenKind } from '../frontend/tokens.js';
import { parse } from '../parser.js';
import type { Module, Declaration, Func, Data, Block, Statement, Span } from '../types.js';

/**
 * 注册 Tokens 相关的 LSP 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getOrParse 文档解析函数
 * @param typeText 类型转文本函数
 * @param exprTypeText 表达式类型推断函数
 * @param tokenNameAt 根据位置获取标记名称的函数
 * @param collectLetsWithSpan 收集所有 let 绑定及其 span 的函数
 */
export function registerTokensHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any; idIndex?: Map<string, Span[]> },
  typeText: (ty: any) => string,
  exprTypeText: (expr: any) => string,
  tokenNameAt: (tokens: any[], position: { line: number; character: number }) => string | null,
  collectLetsWithSpan: (block: Block | null) => Map<string, Span>
): void {
  // Inlay hints: show literal types and simple let-inferred types
  connection.onRequest('textDocument/inlayHint' as any, async (params: InlayHintParams): Promise<InlayHint[] | null> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const entry = getOrParse(doc);
    const { tokens: toks, ast } = entry;
    const out: InlayHint[] = [];
    const range = params.range;
    const within = (line: number, col: number): boolean => {
      const s = doc.offsetAt(range.start);
      const e = doc.offsetAt(range.end);
      const off = doc.offsetAt({ line, character: Math.max(0, col - 1) });
      return off >= s && off <= e;
    };
    try {
      for (const t of toks as any[]) {
        if (!t || !t.start) continue;
        const k = t.kind;
        let label: string | null = null;
        if (k === TokenKind.INT) label = 'Int';
        else if (k === TokenKind.LONG) label = 'Long';
        else if (k === TokenKind.FLOAT) label = 'Double';
        else if (k === TokenKind.STRING) label = 'Text';
        else if (k === TokenKind.BOOL) label = 'Bool';
        else if (k === TokenKind.NULL) label = 'null';
        if (label && within(t.start.line - 1, t.start.col)) {
          out.push({ position: { line: t.start.line - 1, character: t.start.col - 1 }, label, kind: InlayHintKind.Type });
        }
      }
      // Simple let type hints using exprTypeText
      const a = (ast as Module) || (parse(toks) as Module);
      for (const d of a.decls as Declaration[]) {
        if (d.kind !== 'Func') continue;
        const f = d as Func;
        // Function return type at function name
        const nsp = ((f as any).nameSpan as Span | undefined) || ((f as any).span as Span | undefined);
        try {
          const retTxt = typeText((f as any).retType);
          if (nsp && retTxt && within(nsp.start.line - 1, nsp.start.col)) {
            out.push({ position: { line: nsp.start.line - 1, character: Math.max(0, nsp.start.col - 1) }, label: ` -> ${retTxt}`, kind: InlayHintKind.Type });
          }
        } catch {}
        // Parameter type hints
        for (const p of f.params) {
          const psp = ((p as any).span as Span | undefined);
          try {
            const ptxt = typeText(p.type);
            if (psp && ptxt && within(psp.start.line - 1, psp.start.col)) {
              out.push({ position: { line: psp.start.line - 1, character: Math.max(0, psp.start.col - 1) }, label: `: ${ptxt}`, kind: InlayHintKind.Parameter });
            }
          } catch {}
        }
        const walk = (b: Block): void => {
          for (const s of b.statements as Statement[]) {
            if (s.kind === 'Let') {
              const sp = ((s as any).nameSpan as Span | undefined) ?? ((s as any).span as Span | undefined);
              const hint = exprTypeText((s as any).expr);
              if (!sp || !hint) continue;
              const trimmed = hint.trim();
              if (!trimmed || trimmed.toLowerCase() === 'unknown') continue;
              if (within(sp.start.line - 1, sp.start.col)) {
                const line = Math.max(0, sp.start.line - 1);
                const char = Math.max(0, (sp.end?.col ?? sp.start.col) - 1);
                out.push({ position: { line, character: char }, label: `: ${trimmed}`, kind: InlayHintKind.Type });
              }
            } else if (s.kind === 'If') {
              walk(s.thenBlock as Block);
              if (s.elseBlock) walk(s.elseBlock as Block);
            } else if (s.kind === 'Match') {
              for (const c of s.cases) if (c.body.kind === 'Block') walk(c.body as Block);
            } else if (s.kind === 'Block') walk(s as unknown as Block);
          }
        };
        if (f.body) walk(f.body);
      }
    } catch {
      // ignore
    }
    return out;
  });

  // Document highlight: highlight all occurrences of identifier at cursor
  connection.onDocumentHighlight((params: DocumentHighlightParams) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const entry = getOrParse(doc);
    const name = tokenNameAt(entry.tokens as any[], params.position);
    if (!name) return [];

    const highlights: DocumentHighlight[] = [];
    const pushSpan = (sp: Span | undefined): void => {
      if (!sp) return;
      highlights.push({
        range: {
          start: { line: Math.max(0, sp.start.line - 1), character: Math.max(0, sp.start.col - 1) },
          end: { line: Math.max(0, sp.end.line - 1), character: Math.max(0, sp.end.col - 1) },
        },
        kind: DocumentHighlightKind.Text,
      });
    };

    const spans = entry.idIndex?.get(name);
    if (spans && spans.length > 0) {
      for (const sp of spans) pushSpan(sp);
    } else {
      for (const t of entry.tokens as any[]) {
        if (!t || !t.start || !t.end) continue;
        if (!(t.kind === 'IDENT' || t.kind === 'TYPE_IDENT')) continue;
        const value = String(t.value || '');
        if (value !== name) continue;
        pushSpan({
          start: { line: t.start.line, col: t.start.col } as any,
          end: { line: t.end.line, col: t.end.col } as any,
        });
      }
    }

    return highlights;
  });

  // Semantic tokens (basic): keywords, TYPE_IDENTs, plus simple AST-derived kinds
  connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return { data: [] };
    const entry = getOrParse(doc);
    const { tokens: toks, ast } = entry;
    try {
      const ast2 = (ast as Module) || (parse(toks) as Module);
      const builder: number[] = [];
      let prevLine = 0;
      let prevChar = 0;
      const push = (line0: number, char0: number, length: number, type: number, modifiers = 0): void => {
        const dl = builder.length === 0 ? line0 : line0 - prevLine;
        const dc = builder.length === 0 ? char0 : line0 === prevLine ? char0 - prevChar : char0;
        builder.push(dl, dc, Math.max(0, length), type, modifiers);
        prevLine = line0;
        prevChar = char0;
      };
      const typesIndex = tokenTypeIndexMap();
      const modsIndex = tokenModIndexMap();

      // Token-based coloring: keywords and TYPE_IDENT
      for (const t of toks) {
        if (!t || !t.start || !t.end) continue;
        const line0 = (t.start.line - 1) | 0;
        const char0 = (t.start.col - 1) | 0;
        const len = Math.max(0, (t.end.col - t.start.col) | 0);
        if (t.kind === TokenKind.KEYWORD) push(line0, char0, len, typesIndex['keyword'] ?? 0, 0);
        else if (t.kind === TokenKind.TYPE_IDENT) push(line0, char0, len, typesIndex['type'] ?? 0, 0);
      }

      // AST-based: function decl spans, data/enum decl spans, let locals
      const addSpan = (sp: Span | undefined, type: number, mods = 0): void => {
        if (!sp) return;
        const line0 = sp.start.line - 1;
        const char0 = sp.start.col - 1;
        const len = Math.max(0, sp.end.col - sp.start.col);
        if (len > 0) push(line0, char0, len, type, mods);
      };
      for (const d of (ast2.decls as Declaration[])) {
        if (d.kind === 'Func') {
          addSpan((d as any).span, typesIndex['function'] ?? 0);
          // Prefer highlighting function name itself if available
          const nsp = ((d as any).nameSpan as Span | undefined);
          if (nsp) addSpan(nsp, typesIndex['function'] ?? 0, 1 << (modsIndex['declaration'] ?? 0));
          const f = d as Func;
          // parameters
          for (const p of f.params) addSpan(((p as any).span as Span | undefined), typesIndex['parameter'] ?? 0, 1 << (modsIndex['declaration'] ?? 0));
          if (f.body) {
            const lets = collectLetsWithSpan(f.body);
            for (const sp of lets.values()) addSpan(sp, typesIndex['variable'] ?? 0);
          }
        } else if (d.kind === 'Data') {
          addSpan((d as any).span, typesIndex['type'] ?? 0);
          // fields
          for (const f of (d as Data).fields) addSpan(((f as any).span as Span | undefined), typesIndex['property'] ?? 0, 1 << (modsIndex['declaration'] ?? 0));
        } else if (d.kind === 'Enum') {
          addSpan((d as any).span, typesIndex['enum'] ?? 0);
          const vspans: (Span | undefined)[] = (((d as any).variantSpans as Span[] | undefined) || []);
          for (const sp of vspans) addSpan(sp, typesIndex['enumMember'] ?? 0, 1 << (modsIndex['declaration'] ?? 0));
        }
      }
      return { data: builder };
    } catch {
      return { data: [] };
    }
  });
}

/**
 * 语义标记图例
 */
export const SEM_LEGEND: SemanticTokensLegend = {
  tokenTypes: ['keyword', 'type', 'function', 'parameter', 'variable', 'enum', 'enumMember', 'property'],
  tokenModifiers: ['declaration'],
};

const TOKEN_TYPE_INDEX: Record<string, number> = Object.fromEntries(
  SEM_LEGEND.tokenTypes.map((t, i) => [t, i])
);

function tokenTypeIndexMap(): Record<string, number> {
  return TOKEN_TYPE_INDEX;
}

const TOKEN_MOD_INDEX: Record<string, number> = Object.fromEntries(
  SEM_LEGEND.tokenModifiers.map((t, i) => [t, i])
);

function tokenModIndexMap(): Record<string, number> {
  return TOKEN_MOD_INDEX;
}
