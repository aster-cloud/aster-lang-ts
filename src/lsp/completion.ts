/**
 * LSP Completion 模块
 * 提供代码补全、补全项解析和函数签名提示功能
 */

import type { Connection, CompletionItem, SignatureHelp } from 'vscode-languageserver/node.js';
import {
  CompletionItemKind,
  SignatureInformation,
  type ParameterInformation,
  type SignatureHelpParams,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse } from '../parser.js';
import { KW, TokenKind } from '../frontend/tokens.js';
import type {
  Module as AstModule,
  Func as AstFunc,
  Declaration as AstDecl,
  Type as AstType,
  Annotation,
} from '../types.js';

/**
 * 将 AstType 转换为可读的字符串表示
 * @param t AST 类型节点
 * @returns 类型的字符串表示
 */
export function typeText(t: AstType): string {
  switch (t.kind) {
    case 'TypeName':
      return t.name;
    case 'TypeVar':
      return t.name;
    case 'Maybe':
      return `Maybe<${typeText(t.type)}>`;
    case 'Option':
      return `Option<${typeText(t.type)}>`;
    case 'Result':
      return `Result<${typeText(t.ok)}, ${typeText(t.err)}>`;
    case 'List':
      return `List<${typeText(t.type)}>`;
    case 'Map':
      return `Map<${typeText(t.key)}, ${typeText(t.val)}>`;
    case 'TypeApp':
      return `${t.base}<${t.args.map(typeText).join(', ')}>`;
    case 'FuncType':
      return `(${t.params.map(typeText).join(', ')}) -> ${typeText(t.ret)}`;
    default:
      return 'Unknown';
  }
}

/**
 * 格式化单个注解
 * @param annotation 注解对象
 * @returns 格式化的注解字符串
 *
 * @example
 * formatAnnotation({ name: 'NotEmpty', params: new Map() })
 * // => "@NotEmpty"
 *
 * formatAnnotation({ name: 'Range', params: new Map([['min', 0], ['max', 100]]) })
 * // => "@Range(min: 0, max: 100)"
 *
 * formatAnnotation({ name: 'Pattern', params: new Map([['regexp', '^[a-z]+$']]) })
 * // => "@Pattern(regexp: '^[a-z]+$')"
 */
export function formatAnnotation(annotation: Annotation): string {
  if (annotation.params.size === 0) {
    return `@${annotation.name}`;
  }
  const params = Array.from(annotation.params.entries())
    .map(([k, v]) => {
      if (typeof v === 'string') {
        // 使用单引号，转义内部单引号
        const escaped = String(v).replace(/'/g, "\\'");
        return `${k}: '${escaped}'`;
      }
      return `${k}: ${v}`;
    })
    .join(', ');
  return `@${annotation.name}(${params})`;
}

/**
 * 格式化注解数组
 * @param annotations 注解数组（可选）
 * @returns 格式化的注解字符串（空格分隔）
 *
 * @example
 * formatAnnotations(undefined)
 * // => ""
 *
 * formatAnnotations([])
 * // => ""
 *
 * formatAnnotations([
 *   { name: 'NotEmpty', params: new Map() },
 *   { name: 'Range', params: new Map([['min', 0], ['max', 100]]) }
 * ])
 * // => "@NotEmpty @Range(min: 0, max: 100)"
 */
export function formatAnnotations(annotations?: readonly Annotation[]): string {
  if (!annotations || annotations.length === 0) {
    return '';
  }
  return annotations.map(formatAnnotation).join(' ');
}

/**
 * 格式化字段详情（包含注解和类型）
 * @param field 字段对象，包含 type 和可选的 annotations
 * @returns 格式化的详情字符串
 *
 * @example
 * formatFieldDetail({ type: { kind: 'TypeName', name: 'Text' }, annotations: undefined })
 * // => "Text"
 *
 * formatFieldDetail({
 *   type: { kind: 'TypeName', name: 'Text' },
 *   annotations: [{ name: 'NotEmpty', params: new Map() }]
 * })
 * // => "@NotEmpty Text"
 */
export function formatFieldDetail(field: { type: AstType; annotations?: readonly Annotation[] }): string {
  const annots = formatAnnotations(field.annotations);
  return annots ? `${annots} ${typeText(field.type)}` : typeText(field.type);
}

/**
 * 比较 LSP Position（0-based）与 AST Coord（1-based）
 * @param pos LSP 位置（0-based 行列）
 * @param coord AST 坐标（1-based 行列）
 * @returns -1 表示 pos 在 coord 之前，0 表示相等，1 表示 pos 在 coord 之后
 */
function comparePositionToCoord(pos: { line: number; character: number }, coord: { line: number; col: number }): number {
  const line = pos.line + 1;
  const col = pos.character + 1;
  if (line < coord.line) return -1;
  if (line > coord.line) return 1;
  if (col < coord.col) return -1;
  if (col > coord.col) return 1;
  return 0;
}

/**
 * 在模块 AST 中查找指定名称的函数声明
 * @param m 模块 AST
 * @param name 函数名称
 * @returns 匹配的函数声明，如果未找到则返回 null
 */
function findFuncDeclByName(m: AstModule, name: string): AstFunc | null {
  for (const d of m.decls as AstDecl[]) {
    if (d.kind === 'Func' && (d as AstFunc).name === name) {
      return d as AstFunc;
    }
  }
  return null;
}

/**
 * 构建 LSP SignatureInformation 对象
 * @param f 函数 AST 节点
 * @returns LSP 签名信息对象，包含函数签名和参数列表
 */
function buildSignatureInformation(f: AstFunc): SignatureInformation {
  const paramLabels = f.params.map(p => {
    const annots = formatAnnotations(p.annotations);
    const annotPrefix = annots ? `${annots} ` : '';
    return `${annotPrefix}${p.name}: ${typeText(p.type)}`;
  });
  const info: SignatureInformation = {
    label: `${f.name}(${paramLabels.join(', ')}) -> ${typeText(f.retType)}`,
    parameters: paramLabels.map(label => ({ label }) as ParameterInformation),
  };
  const effects = (f.effects as string[] | undefined) ?? [];
  if (effects.length > 0) {
    info.documentation = `效果：${effects.join(', ')}`;
  }
  return info;
}

/**
 * 在光标位置查找函数调用信息
 * @param tokens 词法标记数组
 * @param pos 光标位置（0-based）
 * @returns 函数调用信息（函数名和活动参数索引），如果未找到则返回 null
 */
function findCallInfoAt(
  tokens: readonly any[],
  pos: { line: number; character: number }
): { name: string; activeParameter: number } | null {
  if (!tokens || tokens.length === 0) return null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t || !t.start) continue;
    if (!(t.kind === TokenKind.IDENT || t.kind === TokenKind.TYPE_IDENT)) continue;
    let j = i;
    const parts: string[] = [String(t.value ?? '')];
    while (
      tokens[j + 1]?.kind === TokenKind.DOT &&
      (tokens[j + 2]?.kind === TokenKind.IDENT || tokens[j + 2]?.kind === TokenKind.TYPE_IDENT)
    ) {
      parts.push(String(tokens[j + 2].value ?? ''));
      j += 2;
    }
    const lp = tokens[j + 1];
    if (!lp || lp.kind !== TokenKind.LPAREN) continue;
    let depth = 1;
    let k = j + 2;
    while (k < tokens.length && depth > 0) {
      const tk = tokens[k];
      if (tk.kind === TokenKind.LPAREN) depth++;
      else if (tk.kind === TokenKind.RPAREN) depth--;
      k++;
    }
    if (depth !== 0) continue;
    const rp = tokens[k - 1];
    if (!rp) continue;
    if (comparePositionToCoord(pos, { line: lp.start.line, col: lp.start.col }) < 0) {
      i = k - 1;
      continue;
    }
    if (comparePositionToCoord(pos, { line: rp.end.line, col: rp.end.col }) > 0) {
      i = k - 1;
      continue;
    }
    let activeParameter = 0;
    let commaCount = 0;
    let hasArgToken = false;
    let innerDepth = 0;
    for (let idx = j + 2; idx < k - 1; idx++) {
      const tk = tokens[idx];
      if (!tk) continue;
      if (tk.kind === TokenKind.LPAREN) {
        innerDepth++;
      } else if (tk.kind === TokenKind.RPAREN) {
        if (innerDepth > 0) innerDepth--;
      } else if (innerDepth === 0 && tk.kind === TokenKind.COMMA) {
        const cmp = comparePositionToCoord(pos, { line: tk.start.line, col: tk.start.col });
        if (cmp > 0) activeParameter++;
        else if (cmp === 0) {
          activeParameter++;
          break;
        } else {
          break;
        }
        commaCount++;
      } else if (innerDepth === 0) {
        if (!(tk.kind === TokenKind.NEWLINE || tk.kind === TokenKind.INDENT || tk.kind === TokenKind.DEDENT)) {
          hasArgToken = true;
        }
      }
    }
    const totalParams = commaCount + (hasArgToken ? 1 : 0);
    if (totalParams === 0) activeParameter = 0;
    else activeParameter = Math.min(activeParameter, Math.max(0, totalParams - 1));
    return { name: parts.join('.'), activeParameter };
  }
  return null;
}

/**
 * 注册 Completion 相关的 LSP 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器，提供 get 方法按 URI 获取文档
 * @param getOrParse 文档解析函数，返回文本、词法标记和 AST
 */
export function registerCompletionHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any }
): void {
  // 代码补全：提供关键字和类型补全
  connection.onCompletion((): CompletionItem[] => {
    // 获取所有关键字
    const keywords = Object.values(KW);
    const completions: CompletionItem[] = keywords.map(keyword => ({
      label: keyword,
      kind: CompletionItemKind.Keyword,
      data: keyword,
    }));

    // 添加常见类型补全
    const types = ['Text', 'Int', 'Bool', 'Float', 'User', 'Result', 'Option', 'Maybe'];
    types.forEach(type => {
      completions.push({
        label: type,
        kind: CompletionItemKind.Class,
        data: type,
      });
    });

    // 添加注解名称补全
    const annotations = ['NotEmpty', 'Range', 'Pattern'];
    annotations.forEach(annotation => {
      completions.push({
        label: annotation,
        kind: CompletionItemKind.Keyword,
        data: `annotation:${annotation}`,
        detail: 'annotation',
      });
    });

    return completions;
  });

  // 补全项解析：为选中的补全项提供额外信息
  connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    if (item.data === 'module') {
      item.detail = 'Module declaration';
      item.documentation = 'Declares the module name for this file';
    } else if (item.data === 'define') {
      item.detail = 'Type definition';
      item.documentation = 'Define a new data type or enum';
    } else if (item.data === 'rule') {
      item.detail = 'Function definition';
      item.documentation = 'Define a new function';
    }
    return item;
  });

  // 签名提示：根据调用位置返回函数参数信息
  connection.onRequest('textDocument/signatureHelp', async (params: SignatureHelpParams): Promise<SignatureHelp | null> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const entry = getOrParse(doc);
    const { tokens: toks, ast } = entry;
    let moduleAst: AstModule;
    try {
      moduleAst = (ast as AstModule) || (parse(toks) as AstModule);
    } catch {
      return null;
    }
    const callInfo = findCallInfoAt(toks as any[], params.position);
    if (!callInfo) return null;

    let callee: AstFunc | null = null;
    if (!callInfo.name.includes('.')) {
      callee = findFuncDeclByName(moduleAst, callInfo.name);
    }
    if (!callee) return null;

    const signature = buildSignatureInformation(callee);
    const signatures: SignatureInformation[] = [signature];
    let activeParameter = callInfo.activeParameter;
    if (signature.parameters && signature.parameters.length > 0) {
      const limit = signature.parameters.length - 1;
      activeParameter = Math.min(Math.max(activeParameter, 0), limit);
    } else {
      activeParameter = 0;
    }

    return { signatures, activeSignature: 0, activeParameter };
  });
}
