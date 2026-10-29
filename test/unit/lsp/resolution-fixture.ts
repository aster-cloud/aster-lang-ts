/**
 * 名称解析悬停 / 补全测试的共用夹具（ADR 0051）：带租户词汇的文档快照与 stub connection。
 *
 * 走真实的 parseDocumentText 与 register*Handlers 接线，只把词汇作用域直接塞进快照
 * （等价于 server 的 CachedDoc），避免依赖租户注册中心的全局状态。
 */
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocumentText } from '../../../src/lsp/parse-document.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import type { VocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import type { IdentifierMapping } from '../../../src/config/lexicons/identifiers/types.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

const struct = (canonical: string, localized: string): IdentifierMapping => ({ canonical, localized, kind: IdentifierKind.STRUCT });
const field = (parent: string, canonical: string, localized: string): IdentifierMapping => ({
  canonical, localized, kind: IdentifierKind.FIELD, parent,
});
const member = (parent: string, canonical: string, localized: string): IdentifierMapping => ({
  canonical, localized, kind: IdentifierKind.ENUM_VALUE, parent,
});

/** Driver（司机）字段 age → alter、name 无本地化；Owner（车主）字段 years → jahre、driver → fahrer；Level 成员 Hoch / Niedrig。 */
export const VOCAB: VocabularyScopes = buildVocabularyScopes({
  id: 'lsp-resolution', name: 't', locale: 'zh-CN', version: '1',
  structs: [struct('Driver', '司机'), struct('Owner', '车主'), struct('Level', '等级')],
  fields: [field('Driver', 'age', 'alter'), field('Owner', 'years', 'jahre'), field('Owner', 'driver', 'fahrer')],
  functions: [{ canonical: 'check', localized: '检查', kind: IdentifierKind.FUNCTION }],
  enumValues: [member('Level', 'High', 'Hoch'), member('Level', 'Low', 'Niedrig')],
});

export const DECLS = [
  '模块 m。',
  '',
  '定义 司机 包含 alter 作为 整数，name 作为 文本。',
  '',
  '定义 车主 包含 jahre 作为 整数，fahrer 作为 司机。',
  '',
  '定义 等级 为以下之一 Hoch、Niedrig。',
  '',
];

export interface Doc {
  readonly uri: string;
  readonly document: TextDocument;
  readonly lines: readonly string[];
}

let seq = 0;

export function docOf(lines: readonly string[]): Doc {
  const uri = `file:///resolution-${seq++}.aster`;
  return { uri, document: TextDocument.create(uri, 'aster', 1, lines.join('\n')), lines };
}

/** 等价 server 的 getOrParse：解析文档并附上租户词汇作用域。 */
export function getOrParseWith(lexicon: Lexicon, vocabulary: VocabularyScopes = VOCAB) {
  const entries = new Map<string, unknown>();
  return (doc: TextDocument) => {
    const key = `${doc.uri}@${doc.version}`;
    if (!entries.has(key)) {
      const parsed = parseDocumentText(doc.getText(), lexicon, undefined, undefined);
      entries.set(key, { ...parsed, text: doc.getText(), vocabulary });
    }
    return entries.get(key) as ReturnType<typeof parseDocumentText> & { text: string };
  };
}

/** 第 line 行（0 基）中第 nth 个 needle 的起始列 + offset。 */
export function posOf(doc: Doc, line: number, needle: string, offset = 0, nth = 0): { line: number; character: number } {
  let from = 0;
  let at = -1;
  for (let i = 0; i <= nth; i++) {
    at = doc.lines[line]!.indexOf(needle, from);
    from = at + 1;
  }
  if (at < 0) throw new Error(`第 ${line} 行找不到 ${needle}`);
  return { line, character: at + offset };
}

export function documentsOf(...docs: Doc[]) {
  const byUri = new Map(docs.map((d) => [d.uri, d.document]));
  return { get: (uri: string) => byUri.get(uri) };
}
