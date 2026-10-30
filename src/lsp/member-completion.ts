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
 */
import type { CompletionItem } from 'vscode-languageserver/node.js';
import { CompletionItemKind } from 'vscode-languageserver/node.js';
import { TokenKind } from '../frontend/tokens.js';
import { SemanticTokenKind } from '../config/token-kind.js';
import { EN_US } from '../config/lexicons/en-US.js';
import type { Lexicon } from '../config/lexicons/types.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import type { Core } from '../types.js';
import { parseDocumentWith } from './parse-document.js';
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

/** 一份待推断的文本：null 表示原文档本身；receiver 为该文本中接收者的位置 */
interface Candidate {
  readonly text: string | null;
  readonly receiver: MemberAccess['receiver'];
}

/** 把 line 中 [from, to)（0 基）替换为等长空格，保持其余位置不变 */
const blank = (line: string, from: number, to: number): string => line.slice(0, from) + ' '.repeat(Math.max(0, to - from)) + line.slice(to);

/**
 * 修补候选（都只改光标所在行，保持行号不变）：
 *   1. 去掉 `.前缀`：行中 `fahrer. plus 1.` → `fahrer  plus 1.`；
 *   2. 只去前缀、保留点号：行尾 `Return d.a` → `Return d. `（点号即句末）；
 *   3. 当前行换成 `<缩进><返回> <接收者>.`，并清空其后更深缩进的行：处理 `如果 司机.` 这类
 *      本身就是未完成语句的行（条件、块头）。
 */
function candidates(text: string, access: MemberAccess, lexicon: Lexicon): Candidate[] {
  const { receiver, dotEnd, memberEnd } = access;
  const out: Candidate[] = [{ text: null, receiver }];
  const lines = text.split('\n');
  const row = dotEnd.line - 1;
  const line = lines[row];
  if (line === undefined || receiver.start.line !== dotEnd.line || memberEnd.line !== dotEnd.line) return out;
  const withLine = (replacement: string, rest: readonly string[] = lines.slice(row + 1)): string =>
    [...lines.slice(0, row), replacement, ...rest].join('\n');
  out.push({ text: withLine(blank(line, dotEnd.col - 2, memberEnd.col - 1)), receiver });
  out.push({ text: withLine(blank(line, dotEnd.col - 1, memberEnd.col - 1)), receiver });

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

/**
 * 成员位置的字段补全：只列接收者类型（源码 Data）的字段，按文档词汇给本地化写法；
 * 每项带 textEdit，替换点号之后到光标的已输入前缀。不在成员位置或类型未知时返回 null。
 */
export function memberCompletions(
  entry: MemberDocument,
  pos: { line: number; character: number },
  lexicon: Lexicon | undefined,
): CompletionItem[] | null {
  const access = memberAccessAt(entry.tokens, pos);
  if (!access) return null;
  for (const c of candidates(entry.text, access, lexicon ?? EN_US)) {
    const doc = c.text === null ? entry : parseDocumentWith(c.text, lexicon, entry.vocabulary);
    const complete = !(doc.parseDiagnostics ?? []).some((d) => d.severity === 'error');
    const data = dataOf(complete ? resolveDocument(doc) : resolveForTyping(doc), c.receiver);
    if (data) return fieldItems(data, entry.vocabulary, access, pos);
  }
  return null;
}

function fieldItems(
  data: Core.Data,
  vocabulary: VocabularyScopes | undefined,
  access: MemberAccess,
  pos: { line: number; character: number },
): CompletionItem[] {
  const range = { start: { line: access.dotEnd.line - 1, character: access.dotEnd.col - 1 }, end: pos };
  return data.fields.map((f) => {
    const label = localizedField(vocabulary, data.name, f.name);
    return {
      label,
      kind: CompletionItemKind.Field,
      ...(label === f.name ? {} : { detail: f.name }),
      textEdit: { range, newText: label },
    };
  });
}
