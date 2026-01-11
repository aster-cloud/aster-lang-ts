/**
 * LSP Navigation 共享工具函数
 * 提供文本处理、偏移量转换和 AST 辅助功能
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { typeText } from '../completion.js';
import { canonicalize } from '../../frontend/canonicalizer.js';
import { lex } from '../../frontend/lexer.js';
import { TokenKind } from '../../frontend/tokens.js';
import {
  getSpan,
  getVariantSpans,
  getStatements,
  isAstFunc,
  isAstData,
  isAstEnum,
  isAstBlock,
} from '../type-guards.js';
import type {
  Module as AstModule,
  Declaration as AstDecl,
  Func as AstFunc,
  Block as AstBlock,
  Span,
} from '../../types.js';

/**
 * 捕获指定偏移量处的单词
 * @param text 文本内容
 * @param offset 偏移量位置
 * @returns 捕获的单词，如果不在单词位置则返回 null
 */
export function captureWordAt(text: string, offset: number): string | null {
  const isWord = (c: string): boolean => /[A-Za-z0-9_.]/.test(c);
  let s = offset;
  while (s > 0 && isWord(text[s - 1]!)) s--;
  let e = offset;
  while (e < text.length && isWord(text[e]!)) e++;
  if (s === e) return null;
  return text.slice(s, e);
}

/**
 * 查找文本中所有单词出现位置
 * @param text 文本内容
 * @param word 要查找的单词
 * @returns 单词位置数组（包含 start 和 end 偏移量）
 */
export function findWordPositions(text: string, word: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = new RegExp(`(?<![A-Za-z0-9_.])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_.])`, 'g');
  for (let m; (m = re.exec(text)); ) {
    out.push({ start: m.index, end: m.index + word.length });
  }
  return out;
}

/**
 * 安全查找标记位置（支持回退到正则匹配）
 * @param text 文本内容
 * @param word 要查找的标记或单词
 * @returns 标记位置数组，如果词法分析失败则回退到正则匹配
 */
export function findTokenPositionsSafe(text: string, word: string): Array<{ start: number; end: number }> {
  // If word contains '.', fallback to simple word regex matching over text
  if (word.includes('.')) return findWordPositions(text, word);
  try {
    const can = canonicalize(text);
    const toks = lex(can);
    const starts = buildLineStarts(text);
    const out: Array<{ start: number; end: number }> = [];
    for (const t of toks) {
      if ((t.kind === TokenKind.IDENT || t.kind === TokenKind.TYPE_IDENT) && String(t.value) === word) {
        const s = toOffset(starts, t.start.line, t.start.col);
        const e = toOffset(starts, t.end.line, t.end.col);
        out.push({ start: s, end: e });
      }
    }
    return out.length ? out : findWordPositions(text, word);
  } catch {
    return findWordPositions(text, word);
  }
}

/**
 * 构建行起始位置数组
 * @param text 文本内容
 * @returns 每行起始偏移量数组
 */
export function buildLineStarts(text: string): number[] {
  const a: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') a.push(i + 1);
  return a;
}

/**
 * 将 AST 坐标（1-based 行列）转换为文本偏移量
 * @param starts 行起始位置数组
 * @param line AST 行号（1-based）
 * @param col AST 列号（1-based）
 * @returns 文本偏移量
 */
export function toOffset(starts: readonly number[], line: number, col: number): number {
  const li = Math.max(1, line) - 1;
  const base = starts[li] ?? 0;
  return base + Math.max(1, col) - 1;
}

/**
 * 将文本偏移量转换为 LSP Position（0-based 行列）
 * @param text 文本内容
 * @param off 偏移量
 * @returns LSP Position 对象
 */
export function offsetToPos(text: string, off: number): { line: number; character: number } {
  let line = 0;
  let last = 0;
  for (let i = 0; i < text.length && i < off; i++) if (text[i] === '\n') { line++; last = i + 1; }
  return { line, character: off - last };
}

/**
 * 确保路径为 file:// URI 格式
 * @param u 文件路径或 URI
 * @returns file:// URI 字符串
 */
export function ensureUri(u: string): string {
  if (u.startsWith('file://')) return u;
  const path = require('node:path');
  const to = 'file://' + (path.isAbsolute(u) ? u : path.join(process.cwd(), u));
  return to;
}

/**
 * URI 转文件系统路径
 * @param u file:// URI 字符串
 * @returns 文件系统路径，转换失败返回 null
 */
export function uriToFsPath(u: string): string | null {
  try {
    if (u.startsWith('file://')) return new URL(u).pathname;
  } catch {}
  return null;
}

/**
 * 将 Span 转换为 Range，如果无 Span 则返回整个文档范围
 * @param span AST Span 对象（可选）
 * @param doc 文档对象
 * @returns LSP Range 对象
 */
export function spanOrDoc(span: Span | undefined, doc: TextDocument): import('vscode-languageserver/node.js').Range {
  if (span) {
    return {
      start: { line: Math.max(0, span.start.line - 1), character: Math.max(0, span.start.col - 1) },
      end: { line: Math.max(0, span.end.line - 1), character: Math.max(0, span.end.col - 1) },
    };
  }
  const last = doc.lineCount - 1;
  const len = doc.getText({ start: { line: last, character: 0 }, end: { line: last, character: Number.MAX_SAFE_INTEGER } }).length;
  return { start: { line: 0, character: 0 }, end: { line: last, character: len } };
}

/**
 * 生成函数详情字符串（参数和返回类型）
 * @param f 函数 AST 节点
 * @returns 函数签名字符串，包含参数、返回类型和效果
 */
export function funcDetail(f: AstFunc): string {
  const eff = (f.effects || []).join(' ');
  const params = f.params.map(p => `${p.name}: ${typeText(p.type)}`).join(', ');
  const ret = typeText(f.retType);
  const effTxt = eff ? ` performs ${eff}` : '';
  return `(${params}) -> ${ret}${effTxt}`;
}

/**
 * 判断 LSP Position 是否在 Span 范围内
 * @param span AST Span 对象（可选）
 * @param pos LSP Position（0-based 行列）
 * @returns 是否在范围内
 */
export function within(span: Span | undefined, pos: { line: number; character: number }): boolean {
  if (!span) return false;
  const l = pos.line + 1, c = pos.character + 1;
  const s = span.start, e = span.end;
  if (l < s.line || l > e.line) return false;
  if (l === s.line && c < s.col) return false;
  return !(l === e.line && c > e.col);
}

/**
 * 查找指定位置处的顶层声明
 * @param m 模块 AST
 * @param pos LSP Position
 * @returns 匹配的声明节点，优先返回函数声明
 */
export function findDeclAt(m: AstModule, pos: { line: number; character: number }): AstDecl | null {
  let found: AstDecl | null = null;
  for (const d of m.decls) {
    const sp: Span | undefined = getSpan(d);
    if (within(sp, pos)) {
      found = d as AstDecl;
      if (isAstFunc(d)) return d;
    }
  }
  return found;
}

/**
 * 获取指定位置处的标记名称
 * @param tokens 词法标记数组
 * @param pos LSP Position
 * @returns 标记名称（标识符或类型标识符），如果未找到则返回 null
 */
export function tokenNameAt(tokens: readonly any[], pos: { line: number; character: number }): string | null {
  for (const t of tokens) {
    if (!t || !t.start || !t.end) continue;
    const span: Span = { start: { line: t.start.line, col: t.start.col }, end: { line: t.end.line, col: t.end.col } };
    if (within(span, pos)) {
      if (t.kind === 'IDENT' || t.kind === 'TYPE_IDENT') return String(t.value || '');
    }
  }
  return null;
}

/**
 * 将 Span 转换为 LSP Location 对象
 * @param uri 文档 URI
 * @param sp AST Span 对象
 * @returns LSP Location 对象
 */
export function toLocation(uri: string, sp: Span): import('vscode-languageserver/node.js').Location {
  return {
    uri,
    range: {
      start: { line: sp.start.line - 1, character: sp.start.col - 1 },
      end: { line: sp.end.line - 1, character: sp.end.col - 1 },
    },
  };
}

/**
 * 查找模式匹配绑定的详细信息
 * @param fn 函数 AST 节点
 * @param name 绑定名称
 * @param pos LSP Position
 * @returns 绑定信息（包含名称和可选的类型），如果未找到则返回 null
 */
export function findPatternBindingDetail(fn: AstFunc, name: string, pos: { line: number; character: number }): { name: string; ofType?: string | undefined } | null {
  const inRange = (sp?: Span): boolean => within(sp, pos);
  if (!fn.body) return null;
  const walkBlock = (b: AstBlock): { name: string; ofType?: string | undefined } | null => {
    const statements = getStatements(b);
    for (const s of statements) {
      if (s.kind === 'Match') {
        for (const c of s.cases) {
          const names: string[] = [];
          let ofType: string | undefined;
          const extract = (p: any): void => {
            if (!p) return;
            if (p.kind === 'PatternName') names.push(p.name);
            else if (p.kind === 'PatternCtor') {
              ofType = ofType || p.typeName;
              (p.names || []).forEach((n: string) => names.push(n));
              (p.args || []).forEach(extract);
            }
          };
          extract(c.pattern);
          const body = c.body;
          const sp = getSpan(body);
          if (names.includes(name) && inRange(sp)) {
            return ofType ? { name, ofType } : { name };
          }
          if (body && body.kind === 'Block') {
            const inner = walkBlock(body as AstBlock);
            if (inner) return inner;
          }
        }
      } else if (s.kind === 'If') {
        const a = walkBlock(s.thenBlock as AstBlock) || (s.elseBlock ? walkBlock(s.elseBlock as AstBlock) : null);
        if (a) return a;
      } else if (isAstBlock(s)) {
        const a = walkBlock(s);
        if (a) return a;
      }
    }
    return null;
  };
  return walkBlock(fn.body);
}

/**
 * 在函数体中查找局部 let 绑定及其表达式
 * @param b 块 AST 节点
 * @param name 绑定名称
 * @returns let 绑定信息（包含 span 和表达式），如果未找到则返回 null
 */
export function findLocalLetWithExpr(b: AstBlock | null, name: string): { span: Span; expr: any } | null {
  if (!b) return null;
  const statements = getStatements(b);
  for (const s of statements) {
    if (s.kind === 'Let' && s.name === name) {
      const sp = getSpan(s);
      if (sp) return { span: sp, expr: s.expr };
    }
    if (s.kind === 'If') {
      const a = findLocalLetWithExpr(s.thenBlock as AstBlock, name);
      if (a) return a;
      if (s.elseBlock) {
        const b2 = findLocalLetWithExpr(s.elseBlock as AstBlock, name);
        if (b2) return b2;
      }
    } else if (s.kind === 'Match') {
      for (const c of s.cases) {
        if (c.body.kind === 'Block') {
          const r = findLocalLetWithExpr(c.body as AstBlock, name);
          if (r) return r;
        }
      }
    } else if (isAstBlock(s)) {
      const r = findLocalLetWithExpr(s, name);
      if (r) return r;
    }
  }
  return null;
}

/**
 * 收集函数体中所有 let 绑定及其 Span
 * @param b 块 AST 节点
 * @returns 绑定名称到 Span 的映射
 */
export function collectLetsWithSpan(b: AstBlock | null): Map<string, Span> {
  const out = new Map<string, Span>();
  if (!b) return out;
  const statements = getStatements(b);
  for (const s of statements) {
    if (s.kind === 'Let') {
      const sp = ((s as any).nameSpan as Span | undefined) ?? getSpan(s);
      if (sp) out.set(s.name, sp);
    } else if (s.kind === 'If') {
      collectLetsWithSpan(s.thenBlock as AstBlock).forEach((v, k) => out.set(k, v));
      if (s.elseBlock) collectLetsWithSpan(s.elseBlock as AstBlock).forEach((v, k) => out.set(k, v));
    } else if (s.kind === 'Match') {
      for (const c of s.cases) if (c.body.kind === 'Block') collectLetsWithSpan(c.body as AstBlock).forEach((v, k) => out.set(k, v));
    } else if (isAstBlock(s)) {
      collectLetsWithSpan(s).forEach((v, k) => out.set(k, v));
    }
  }
  return out;
}

/**
 * 构建枚举变体名称到 Span 的映射
 * @param m 模块 AST
 * @returns 变体名称到 Span 的映射
 */
export function enumVariantSpanMap(m: AstModule): Map<string, Span> {
  const out = new Map<string, Span>();
  for (const d of m.decls as AstDecl[]) {
    if (isAstEnum(d)) {
      const vspans: (Span | undefined)[] = getVariantSpans(d);
      for (let i = 0; i < d.variants.length; i++) {
        const nm = d.variants[i]!;
        const sp = vspans[i];
        if (sp) out.set(nm, sp);
      }
    }
  }
  return out;
}

/**
 * 构建数据字段到 Span 的映射（key: TypeName.field）
 * @param m 模块 AST
 * @returns 字段键（TypeName.field）到 Span 的映射
 */
export function dataFieldSpanMap(m: AstModule): Map<string, Span> {
  const out = new Map<string, Span>();
  for (const d of m.decls as AstDecl[]) {
    if (isAstData(d)) {
      for (const f of d.fields) {
        const sp = getSpan(f);
        if (sp) out.set(`${d.name}.${f.name}`, sp);
      }
    }
  }
  return out;
}

/**
 * 查找指定位置处的构造字段信息
 * @param m 模块 AST
 * @param pos LSP Position
 * @returns 构造字段信息（包含类型名和字段名），如果未找到则返回 null
 */
export function findConstructFieldAt(m: AstModule, pos: { line: number; character: number }): { typeName: string; field: string } | null {
  // Shallow walk function bodies to find Construct nodes and match field spans
  const withinSpan = (sp: Span | undefined): boolean => within(sp, pos);
  for (const d of m.decls as AstDecl[]) {
    if (!isAstFunc(d)) continue;
    const f = d;
    const walkBlock = (b: AstBlock): void => {
      const statements = getStatements(b);
      for (const s of statements) {
        if (s.kind === 'Return') {
          walkExpr(s.expr);
        } else if (s.kind === 'Let' || s.kind === 'Set') {
          walkExpr(s.expr);
        } else if (s.kind === 'If') {
          walkExpr(s.cond);
          walkBlock(s.thenBlock as AstBlock);
          if (s.elseBlock) walkBlock(s.elseBlock as AstBlock);
        } else if (s.kind === 'Match') {
          walkExpr(s.expr);
          for (const c of s.cases) {
            if (c.body.kind === 'Block') walkBlock(c.body as AstBlock);
          }
        } else if (isAstBlock(s)) {
          walkBlock(s);
        }
      }
    };
    const walkExpr = (e: any): void => {
      if (!e || !e.kind) return;
      if (e.kind === 'Construct') {
        for (const fld of e.fields || []) {
          const sp = getSpan(fld);
          if (withinSpan(sp)) { found = { typeName: e.typeName as string, field: fld.name as string }; return; }
        }
      } else if (e.kind === 'Call') {
        walkExpr(e.target);
        (e.args || []).forEach(walkExpr);
      } else if (e.kind === 'Ok' || e.kind === 'Err' || e.kind === 'Some') {
        walkExpr(e.expr);
      }
    };
    let found: { typeName: string; field: string } | null = null;
    if (f.body) walkBlock(f.body);
    if (found) return found;
  }
  return null;
}
