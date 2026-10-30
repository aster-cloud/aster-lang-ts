/**
 * 成员访问（`x.` / `x.前缀`）的字段补全（ADR 0051 §5：FIELD_REF 按接收者类型）。
 *
 * ★生产复测（cloud#660 第 5 轮）的三类失败都出在「接收者类型从哪来」：
 *   - 行中 `fahrer.` 后还有 ` plus 1.`、zh 行尾 `如果 司机.`：正在输入的这一行让文档语法不完整，
 *     解析器丢弃了所在的声明，R2 也被整体跳过，于是拿不到接收者类型；
 *   - `d.a`：旧实现只认「光标紧跟点号」，点号后已输入的前缀直接判为非成员位置。
 * 现在的做法：
 *   1. 按 token 识别成员位置，光标可以在点号后的名字前缀里，返回前缀的替换范围；
 *   2. 依次尝试原文与几份修补过的文本（去掉 `.前缀`、只去前缀、把当前行换成 `返回 接收者.`），
 *      对每份都运行 R1 → lower → R2（不要求全文语法完整，见 resolution.ts resolveForTyping），
 *      取接收者位置的 §4 静态类型；第一份能定出源码 Data 的即为结果。
 *   修补只用于推断类型，不改文档、不发布诊断。
 *
 * ★每份修补文本都是一次全文解析 + R1 → lower → R2，且在服务端同步执行（#258）：
 *   - 修补文本 → 推断结果做 LRU 缓存：同一版本重复请求、继续输入成员前缀（修补时前缀被删去，
 *     修补文本不变）都直接命中；
 *   - 文档超过 MEMBER_REPAIR_MAX_LINES 行时不做修补，只用原文推断，避免阻塞其它请求。
 */
import type { CompletionItem, InsertReplaceEdit, Range, TextEdit } from 'vscode-languageserver/node.js';
import { CompletionItemKind } from 'vscode-languageserver/node.js';
import { TokenKind } from '../frontend/tokens.js';
import { SemanticTokenKind } from '../config/token-kind.js';
import { EN_US } from '../config/lexicons/en-US.js';
import type { Lexicon } from '../config/lexicons/types.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import type { Core } from '../types.js';
import { parseDocumentWith } from './parse-document.js';
import type { ParsedDocument } from './parse-document.js';
import { resolveDocument, resolveForTyping } from './resolution.js';
import type { DocumentResolution, ResolvableDocument } from './resolution.js';

type Coord = { readonly line: number; readonly col: number };

/** 成员补全所需的文档快照：原文、原文坐标的 tokens 与名称解析输入。 */
export type MemberDocument = { readonly text: string; readonly tokens: readonly any[] } & ResolvableDocument;

/** 光标处的成员访问（token 坐标：1 基，end 不含）。 */
export interface MemberAccess {
  /** 接收者（可为点分路径）的起止位置 */
  readonly receiver: { readonly start: Coord; readonly end: Coord };
  /** 点号的结束位置，即已输入前缀的起点 */
  readonly dotEnd: Coord;
  /** 点号后紧邻的名字的结束位置；没有名字时等于 dotEnd */
  readonly memberEnd: Coord;
}

const isName = (t: any): boolean => t?.kind === TokenKind.IDENT || t?.kind === TokenKind.TYPE_IDENT;
const isDot = (t: any): boolean => t?.kind === TokenKind.DOT;
const sameCoord = (a: Coord | undefined, b: Coord | undefined): boolean => !!a && !!b && a.line === b.line && a.col === b.col;
const notAfter = (a: Coord, b: Coord): boolean => a.line < b.line || (a.line === b.line && a.col <= b.col);

/**
 * 光标是否位于成员访问的成员名位置：紧跟 `recv.` 的点号之后，或在点号后紧邻的名字（已输入前缀）之中。
 * 接收者必须是名字（数字 `1.` 不算）。
 */
export function memberAccessAt(tokens: readonly any[], pos: { line: number; character: number }): MemberAccess | null {
  const cursor = { line: pos.line + 1, col: pos.character + 1 };
  let dot = tokens.findIndex((t) => isDot(t) && sameCoord(t.end, cursor));
  if (dot < 0) {
    const name = tokens.findIndex((t) => isName(t) && t.start && t.end && notAfter(t.start, cursor) && notAfter(cursor, t.end));
    if (name < 1 || !isDot(tokens[name - 1]) || !sameCoord(tokens[name - 1].end, tokens[name].start)) return null;
    dot = name - 1;
  }
  if (dot < 1 || !isName(tokens[dot - 1])) return null;
  const member = tokens[dot + 1];
  const memberEnd = isName(member) && sameCoord(member.start, tokens[dot].end) ? member.end : tokens[dot].end;
  let head = dot - 1;
  while (isDot(tokens[head - 1]) && isName(tokens[head - 2])) head -= 2;
  return { receiver: { start: tokens[head].start, end: tokens[dot - 1].end }, dotEnd: tokens[dot].end, memberEnd };
}

/** 字段的本地化写法：文档词汇中该 struct 字段的主词条；无本地化时为规范名。 */
export function localizedField(vocabulary: VocabularyScopes | undefined, struct: string, canonical: string): string {
  const buckets = vocabulary?.fields.get(struct)?.values() ?? [];
  for (const list of buckets) {
    const term = list.find((c) => c.canonical === canonical && c.source === 'term');
    if (term) return term.written;
  }
  return canonical;
}

/** 一份待推断的修补文本；receiver 为该文本中接收者的位置 */
interface Candidate {
  readonly text: string;
  readonly receiver: MemberAccess['receiver'];
}

/** 删去 line 中 [from, to)（0 基） */
const cut = (line: string, from: number, to: number): string => line.slice(0, from) + line.slice(to);

/**
 * 修补候选（都只改光标所在行，保持行号与接收者位置不变）：
 *   1. 删去 `.前缀`：行中 `fahrer. plus 1.` → `fahrer plus 1.`；
 *   2. 只删前缀、保留点号：行尾 `Return d.a` → `Return d.`（点号即句末）；
 *   3. 当前行换成 `<缩进><返回> <接收者>.`，并清空其后更深缩进的行：处理 `如果 司机.` 这类
 *      本身就是未完成语句的行（条件、块头）。
 */
function candidates(text: string, access: MemberAccess, lexicon: Lexicon): Candidate[] {
  const { receiver, dotEnd, memberEnd } = access;
  const out: Candidate[] = [];
  const lines = text.split('\n');
  const row = dotEnd.line - 1;
  const line = lines[row];
  if (line === undefined || receiver.start.line !== dotEnd.line || memberEnd.line !== dotEnd.line) return out;
  const withLine = (replacement: string, rest: readonly string[] = lines.slice(row + 1)): string =>
    [...lines.slice(0, row), replacement, ...rest].join('\n');
  // 删去而非以空格占位：继续输入前缀时修补文本保持不变，缓存才能命中；接收者在点号之前，位置不受影响
  out.push({ text: withLine(cut(line, dotEnd.col - 2, memberEnd.col - 1)), receiver });
  out.push({ text: withLine(cut(line, dotEnd.col - 1, memberEnd.col - 1)), receiver });

  const indent = /^\s*/.exec(line)![0];
  const keyword = lexicon.keywords[SemanticTokenKind.RETURN] || EN_US.keywords[SemanticTokenKind.RETURN];
  const path = line.slice(receiver.start.col - 1, receiver.end.col - 1);
  const startCol = indent.length + keyword.length + 2;
  const deeper = (l: string): boolean => l.trim() !== '' && /^\s*/.exec(l)![0].length > indent.length;
  const following = lines.slice(row + 1);
  const bodyEnd = following.findIndex((l) => !deeper(l) && l.trim() !== '');
  const rest = following.map((l, i) => (bodyEnd === -1 || i < bodyEnd ? '' : l));
  out.push({
    text: withLine(`${indent}${keyword} ${path}.`, rest),
    receiver: { start: { line: receiver.start.line, col: startCol }, end: { line: receiver.start.line, col: startCol + path.length } },
  });
  return out;
}

/** 在一份解析结果里找接收者的静态类型对应的源码 Data */
function dataOf(res: DocumentResolution, receiver: MemberAccess['receiver']): Core.Data | undefined {
  const typed = res.typedNames.find((t) => sameCoord(t.span.start, receiver.start) && sameCoord(t.span.end, receiver.end));
  const typeName = typed?.type.kind === 'TypeName' ? typed.type.name : undefined;
  return typeName === undefined ? undefined : res.core?.decls.find((d): d is Core.Data => d.kind === 'Data' && d.name === typeName);
}

/** 超过该行数的文档不做修补推断：每份修补都是一次全文解析，大文档会拖过编辑器补全超时（#258） */
export const MEMBER_REPAIR_MAX_LINES = 2000;

/** 修补推断缓存的容量（条）：覆盖一次成员输入过程中的几份修补文本即可 */
const REPAIR_CACHE_SIZE = 8;

interface RepairEntry {
  readonly key: string;
  readonly lexicon: Lexicon | undefined;
  readonly vocabulary: VocabularyScopes | undefined;
  readonly data: Core.Data | undefined;
}

/** 修补文本 → 接收者 Data 的 LRU（按插入顺序，命中时移到末尾） */
const repairCache: RepairEntry[] = [];

/** 清空修补推断缓存（测试用） */
export function clearMemberRepairCache(): void {
  repairCache.length = 0;
}

function cachedRepair(
  key: string,
  lexicon: Lexicon | undefined,
  vocabulary: VocabularyScopes | undefined,
  infer: () => Core.Data | undefined,
): Core.Data | undefined {
  const at = repairCache.findIndex((e) => e.key === key && e.lexicon === lexicon && e.vocabulary === vocabulary);
  const entry = at >= 0 ? repairCache.splice(at, 1)[0]! : { key, lexicon, vocabulary, data: infer() };
  repairCache.push(entry);
  if (repairCache.length > REPAIR_CACHE_SIZE) repairCache.shift();
  return entry.data;
}

const coordKey = (c: Coord): string => `${c.line}:${c.col}`;

function lineCount(text: string): number {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n += 1;
  return n;
}

/** 一份解析结果中接收者的 Data：语法完整走正式解析，否则走补全专用的类型推断 */
function inferData(doc: ParsedDocument | MemberDocument, receiver: MemberAccess['receiver']): Core.Data | undefined {
  const complete = !(doc.parseDiagnostics ?? []).some((d) => d.severity === 'error');
  return dataOf(complete ? resolveDocument(doc) : resolveForTyping(doc), receiver);
}

/** 成员补全的可选项 */
export interface MemberCompletionOptions {
  /** 客户端声明支持 InsertReplaceEdit（completionItem.insertReplaceSupport） */
  readonly insertReplace?: boolean;
  /** 解析修补文本的函数；缺省 parseDocumentWith（测试注入以统计解析次数） */
  readonly parse?: typeof parseDocumentWith;
}

/**
 * 成员位置的字段补全：只列接收者类型（源码 Data）的字段，按文档词汇给本地化写法。
 * 每项带编辑：插入范围为点号之后到光标；光标在已有名字中间时，替换范围延伸到名字末尾
 * （客户端支持时给 InsertReplaceEdit，否则 TextEdit 直接覆盖整个名字），避免 `d.ag|e` 选 age 得到 agee。
 * 不在成员位置或类型未知时返回 null。
 */
export function memberCompletions(
  entry: MemberDocument,
  pos: { line: number; character: number },
  lexicon: Lexicon | undefined,
  options: MemberCompletionOptions = {},
): CompletionItem[] | null {
  const access = memberAccessAt(entry.tokens, pos);
  if (!access) return null;
  const data = inferData(entry, access.receiver) ?? firstRepair(entry, access, lexicon, options.parse ?? parseDocumentWith);
  return data ? fieldItems(data, entry.vocabulary, access, pos, options.insertReplace === true) : null;
}

/** 原文推断失败时依次尝试修补文本（带缓存），返回第一份能定出接收者 Data 的结果；大文档不尝试 */
function firstRepair(
  entry: MemberDocument,
  access: MemberAccess,
  lexicon: Lexicon | undefined,
  parse: typeof parseDocumentWith,
): Core.Data | undefined {
  if (lineCount(entry.text) > MEMBER_REPAIR_MAX_LINES) return undefined;
  for (const c of candidates(entry.text, access, lexicon ?? EN_US)) {
    const key = `${coordKey(c.receiver.start)}-${coordKey(c.receiver.end)}\u0000${c.text}`;
    const data = cachedRepair(key, lexicon, entry.vocabulary, () => inferData(parse(c.text, lexicon, entry.vocabulary), c.receiver));
    if (data) return data;
  }
  return undefined;
}

function fieldItems(
  data: Core.Data,
  vocabulary: VocabularyScopes | undefined,
  access: MemberAccess,
  pos: { line: number; character: number },
  insertReplace: boolean,
): CompletionItem[] {
  const start = { line: access.dotEnd.line - 1, character: access.dotEnd.col - 1 };
  const insert: Range = { start, end: pos };
  const replace: Range = { start, end: { line: access.memberEnd.line - 1, character: access.memberEnd.col - 1 } };
  return data.fields.map((f) => {
    const label = localizedField(vocabulary, data.name, f.name);
    return {
      label,
      kind: CompletionItemKind.Field,
      ...(label === f.name ? {} : { detail: f.name }),
      textEdit: memberEdit(label, insert, replace, insertReplace),
    };
  });
}

/**
 * 字段项的编辑：光标在名字末尾时 insert 与 replace 相同，给普通 TextEdit；
 * 光标在名字中间时，支持的客户端给 InsertReplaceEdit，否则 TextEdit 覆盖到名字末尾。
 */
function memberEdit(newText: string, insert: Range, replace: Range, insertReplace: boolean): TextEdit | InsertReplaceEdit {
  if (replace.end.character <= insert.end.character) return { range: insert, newText };
  if (insertReplace) return { insert, replace, newText };
  return { range: replace, newText };
}
