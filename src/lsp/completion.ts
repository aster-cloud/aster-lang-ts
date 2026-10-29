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
} from '../types.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { getLspUiTexts } from '../config/lexicons/lsp-ui-texts.js';
import { CONTROLS_REGISTRY } from '../governance/controls-registry.data.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { lookup } from '../config/lexicons/identifiers/scopes.js';
import { foldKey, nfc } from '../config/lexicons/identifiers/casefold.js';
import { SemanticTokenKind } from '../config/token-kind.js';
import { EN_US } from '../config/lexicons/en-US.js';
import type { Core } from '../types.js';
import { resolveDocument } from './resolution.js';
import type { ResolvableDocument } from './resolution.js';

/** 补全所需的文档快照：tokens / AST，以及名称解析用的语法诊断与租户词汇。 */
type CompletionDocument = { text: string; tokens: readonly any[]; ast: any } & Omit<ResolvableDocument, 'ast'>;

type Coord = { readonly line: number; readonly col: number };

const isName = (t: any): boolean => t?.kind === TokenKind.IDENT || t?.kind === TokenKind.TYPE_IDENT;
const sameCoord = (a: Coord | undefined, b: Coord | undefined): boolean => !!a && !!b && a.line === b.line && a.col === b.col;

/**
 * 光标紧跟在 `recv.` 的点之后时，返回接收者（可为点分路径）的起止位置；否则 null。
 * 位置为 token 坐标（1 基，end 不含）。
 */
export function receiverBeforeDot(tokens: readonly any[], pos: { line: number; character: number }): { start: Coord; end: Coord } | null {
  const cursor = { line: pos.line + 1, col: pos.character + 1 };
  const dot = tokens.findIndex((t) => t?.kind === TokenKind.DOT && sameCoord(t.end, cursor));
  if (dot < 1 || !isName(tokens[dot - 1])) return null;
  let head = dot - 1;
  while (tokens[head - 1]?.kind === TokenKind.DOT && isName(tokens[head - 2])) head -= 2;
  return { start: tokens[head].start, end: tokens[dot - 1].end };
}

/** 字段的本地化写法：文档词汇中该 struct 字段的主词条；无本地化时为规范名。 */
function localizedField(vocabulary: VocabularyScopes | undefined, struct: string, canonical: string): string {
  const buckets = vocabulary?.fields.get(struct)?.values() ?? [];
  for (const list of buckets) {
    const term = list.find((c) => c.canonical === canonical && c.source === 'term');
    if (term) return term.written;
  }
  return canonical;
}

/**
 * `x.` 之后的字段补全（ADR 0051 §5：FIELD_REF 按接收者类型）。接收者类型取 R2 的 §4 显式声明规则；
 * 语法不完整（R2 已跳过）、接收者类型未知或不是源码 Data 时返回 null，由普通补全接管。
 */
export function fieldCompletions(entry: CompletionDocument, pos: { line: number; character: number }): CompletionItem[] | null {
  const receiver = receiverBeforeDot(entry.tokens, pos);
  if (!receiver) return null;
  const res = resolveDocument(entry);
  if (!res.complete) return null;
  const typed = res.typedNames.find((t) => sameCoord(t.span.start, receiver.start) && sameCoord(t.span.end, receiver.end));
  const typeName = typed?.type.kind === 'TypeName' ? typed.type.name : undefined;
  const data = res.core?.decls.find((d): d is Core.Data => d.kind === 'Data' && d.name === typeName);
  if (!data) return null;
  return data.fields.map((f) => {
    const label = localizedField(entry.vocabulary, data.name, f.name);
    return { label, kind: CompletionItemKind.Field, ...(label === f.name ? {} : { detail: f.name }) };
  });
}

const LAYOUT_KINDS: ReadonlySet<unknown> = new Set([TokenKind.NEWLINE, TokenKind.INDENT, TokenKind.DEDENT, TokenKind.EOF, TokenKind.COMMENT]);

/** 该文档语言中某关键字的全部写法（规范拼写 + 别名，小写） */
function keywordWords(lexicon: Lexicon, kind: SemanticTokenKind): ReadonlySet<string> {
  const words = [lexicon.keywords[kind], ...(lexicon.aliases?.[kind] ?? [])].filter((w): w is string => !!w);
  return new Set(words.map((w) => w.toLowerCase()));
}

const wordOf = (t: any): string => (typeof t?.value === 'string' ? t.value.toLowerCase() : '');
const before = (a: Coord, b: Coord): boolean => a.line < b.line || (a.line === b.line && a.col <= b.col);

/** 构造表达式中光标所在的字段名位置：构造的类型写法与此前已赋值的字段写法。 */
export interface ConstructSite {
  readonly typeName: string;
  readonly assigned: readonly string[];
}

/**
 * 光标是否位于构造的字段名位置：`T with |`、`…, |` 或 `… and |`（可带正在输入的名字前缀）。
 * 自光标向前按括号深度回扫：同层遇到 `T with` 即为所在构造，途经的 `name set to` 记为已赋值字段；
 * 遇到 `:`、行末句点（语句边界）或不配对的 `(` 说明不在构造中，返回 null。
 * 构造未写完时解析器会丢弃它，所以这里只看 token，不依赖 AST。
 */
export function constructAt(tokens: readonly any[], pos: { line: number; character: number }, lexicon: Lexicon): ConstructSite | null {
  const cursor = { line: pos.line + 1, col: pos.character + 1 };
  const toks = tokens.filter((t) => !LAYOUT_KINDS.has(t?.kind) && t?.end && before(t.end, cursor));
  const withWords = keywordWords(lexicon, SemanticTokenKind.TYPE_WITH);
  const setWords = keywordWords(lexicon, SemanticTokenKind.SET);
  const toWords = keywordWords(lexicon, SemanticTokenKind.TO_WORD);
  const andWords = keywordWords(lexicon, SemanticTokenKind.AND);
  let i = toks.length - 1;
  if (isName(toks[i]) && sameCoord(toks[i].end, cursor)) i--; // 正在输入的字段名前缀
  const head = toks[i];
  if (!head || !(head.kind === TokenKind.COMMA || withWords.has(wordOf(head)) || andWords.has(wordOf(head)))) return null;
  const assigned: string[] = [];
  let depth = 0;
  for (let j = i; j >= 0; j--) {
    const t = toks[j];
    if (t.kind === TokenKind.RPAREN) {
      depth++;
      continue;
    }
    if (t.kind === TokenKind.LPAREN) {
      if (depth === 0) return null;
      depth--;
      continue;
    }
    if (depth > 0) continue;
    const endsLine = t.kind === TokenKind.DOT && (toks[j + 1]?.start?.line ?? Infinity) > t.end.line;
    if (t.kind === TokenKind.COLON || endsLine) return null;
    if (withWords.has(wordOf(t)) && isName(toks[j - 1])) return { typeName: String(toks[j - 1].value), assigned };
    if (toWords.has(wordOf(t)) && setWords.has(wordOf(toks[j - 1])) && isName(toks[j - 2])) assigned.push(String(toks[j - 2].value));
  }
  return null;
}

/** 构造类型写法 → 规范 struct 名：源码声明优先，其次词汇中唯一的精确词条，否则原写法。 */
function structCanonical(res: ReturnType<typeof resolveDocument>, vocabulary: VocabularyScopes | undefined, written: string): string {
  const w = nfc(written);
  const declared = res.sites.find((s) => s.role === 'TYPE_DECL' && nfc(s.written) === w);
  if (declared) return declared.canonical;
  const canonicals = new Set((vocabulary ? lookup(vocabulary.types, w).exact : []).map((c) => c.canonical));
  return canonicals.size === 1 ? [...canonicals][0]! : w;
}

/**
 * 构造字段名位置的补全（`Driver with |`、`Driver with age set to 1, |`）：列该源码 Data 尚未赋值的字段，
 * 写法与 `x.` 补全一致（词汇本地化优先）。字段取 R1 的 FIELD_DECL，语法不完整时同样可用。
 */
export function constructFieldCompletions(
  entry: CompletionDocument,
  pos: { line: number; character: number },
  lexicon: Lexicon | undefined,
): CompletionItem[] | null {
  const site = constructAt(entry.tokens, pos, lexicon ?? EN_US);
  if (!site) return null;
  const res = resolveDocument(entry);
  const struct = structCanonical(res, entry.vocabulary, site.typeName);
  const fields = [...new Set(res.sites.filter((s) => s.role === 'FIELD_DECL' && s.parent === struct).map((s) => s.canonical))];
  if (fields.length === 0) return null;
  const taken = new Set(site.assigned.map(foldKey));
  return fields.flatMap((canonical) => {
    const label = localizedField(entry.vocabulary, struct, canonical);
    if (taken.has(foldKey(label)) || taken.has(foldKey(canonical))) return [];
    return [{ label, kind: CompletionItemKind.Field, ...(label === canonical ? {} : { detail: canonical }) }];
  });
}

/** 按补全请求求字段补全（`x.` 之后或构造字段名位置）；请求缺字段、文档不存在或不在这两类位置时返回 null。 */
function fieldCompletionsAt(
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => CompletionDocument,
  params: { textDocument?: { uri: string }; position?: { line: number; character: number } } | undefined,
  lexicon: Lexicon | undefined,
): CompletionItem[] | null {
  if (!params?.textDocument || !params.position) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const entry = getOrParse(doc);
  return fieldCompletions(entry, params.position) ?? constructFieldCompletions(entry, params.position, lexicon);
}

const CONTROL_ARG = /@control\(\s*"([^"]*)$/;

/**
 * `@control("` 字符串内补全注册表键（ADR 0045 §3）；其它位置返回 null。
 * 给出光标位置时，每项带 textEdit 覆盖引号内已输入的前缀（引号后一位至光标），
 * 避免客户端按单词边界（常止于 `:`）替换而重复插入框架前缀，如 `GDPR:GDPR:ART22`。
 */
export function controlCompletions(
  linePrefix: string,
  position?: { line: number; character: number },
): CompletionItem[] | null {
  const m = CONTROL_ARG.exec(linePrefix);
  if (!m) return null;
  const typed = m[1] ?? '';
  const frameworks = new Map(CONTROLS_REGISTRY.frameworks.map((f) => [f.id, f.title]));
  const range = position && {
    start: { line: position.line, character: position.character - typed.length },
    end: position,
  };
  return CONTROLS_REGISTRY.controls
    .filter((c) => c.key.startsWith(typed))
    .map((c) => ({
      label: c.key,
      kind: CompletionItemKind.Value,
      detail: c.title.en,
      documentation: `${frameworks.get(c.framework)?.en ?? c.framework} · ${c.title.en} / ${c.title.zh} / ${c.title.de}`,
      ...(range ? { textEdit: { range, newText: c.key } } : {}),
    }));
}

/** 按补全请求取光标前的行前缀并求 @control 补全；请求缺字段或文档不存在时返回 null。 */
export function controlCompletionsAt(
  documents: { get(uri: string): TextDocument | undefined },
  params: { textDocument?: { uri: string }; position?: { line: number; character: number } } | undefined,
): CompletionItem[] | null {
  if (!params?.textDocument || !params.position) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const linePrefix = doc.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
  return controlCompletions(linePrefix, params.position);
}

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
 * 格式化字段详情（类型文本）
 */
export function formatFieldDetail(field: { type: AstType }): string {
  return typeText(field.type);
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
  const paramLabels = f.params.map(p => `${p.name}: ${typeText(p.type)}`);
  const info: SignatureInformation = {
    label: `${f.name}(${paramLabels.join(', ')}) -> ${typeText(f.retType)}`,
    parameters: paramLabels.map(label => ({ label }) as ParameterInformation),
  };
  const effects = (f.effects as string[] | undefined) ?? [];
  if (effects.length > 0) {
    info.documentation = `Effects: ${effects.join(', ')}`;
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
  getOrParse: (doc: TextDocument) => CompletionDocument,
  getLexiconForDoc?: (uri: string) => Lexicon | undefined,
): void {
  // 代码补全：提供关键字和类型补全
  connection.onCompletion((params): CompletionItem[] => {
    // 位于 @control(" 字符串内时只提供注册表键，不混入关键字补全
    const controls = controlCompletionsAt(documents, params);
    if (controls) return controls;
    // `x.` 之后且接收者类型已知、或位于构造的字段名位置：只列该 struct 的字段
    const fields = fieldCompletionsAt(documents, getOrParse, params, getLexiconForDoc?.(params.textDocument.uri));
    if (fields) return fields;
    // ★关键词必须取自**该文档的 lexicon**，而不是硬编码的英文 KW。
    //
    //   此前是 `Object.values(KW)` —— KW 是 config/semantic.ts 里写死的英文
    //   规范拼写（module / use / define …）。于是写 zh-CN 的用户敲出补全，
    //   拿到的是 `module, use, as`，而他实际要写的是 `模块, 引用, 作为`：
    //   **补全给的每一个词都是错的**，选中即产生解析错误。
    //   诊断/跳转/代码操作三条路径都已正确接收 getLexiconForDoc，唯独补全漏了。
    //
    //   别名（ADR 0022）一并纳入：识别侧本就多对一接受别名
    //   （见 types.ts 的 buildKeywordIndex / getMultiWordKeywords），
    //   补全若只给规范拼写，用户就发现不了自己可以写更自然的别名。
    //   ★当前四个内置 lexicon 的 aliases 均为空，故这段暂时是**无操作**——
    //   但接线必须现在做好，否则将来某个 lexicon 一加别名，补全又会静默落后。
    const lexicon = getLexiconForDoc?.(params.textDocument.uri);
    const keywords = lexicon
      ? [
          ...Object.values(lexicon.keywords),
          ...(lexicon.aliases ? Object.values(lexicon.aliases).flat() : []),
        ]
      : Object.values(KW); // 无 lexicon 上下文时回退英文规范拼写
    const completions: CompletionItem[] = [...new Set(keywords)].map(keyword => ({
      label: keyword,
      kind: CompletionItemKind.Keyword,
      data: keyword,
    }));

    // 添加常见类型补全
    const types = ['Text', 'Int', 'Bool', 'Float', 'User', 'Result', 'Option', 'Maybe', 'Verdict'];
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
    // getLexiconForDoc('') 返回全局 lexicon（无 per-doc override 时的回退）
    const lexicon = getLexiconForDoc?.('');
    const ui = getLspUiTexts(lexicon);
    if (item.data === 'module') {
      item.detail = ui.moduleDeclaration;
      item.documentation = ui.moduleDeclarationDoc;
    } else if (item.data === 'define') {
      item.detail = ui.typeDefinition;
      item.documentation = ui.typeDefinitionDoc;
    } else if (item.data === 'rule') {
      item.detail = ui.functionDefinition;
      item.documentation = ui.functionDefinitionDoc;
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
      moduleAst = (ast as AstModule) || (parse(toks).ast as AstModule);
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
