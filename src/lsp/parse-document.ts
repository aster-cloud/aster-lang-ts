/**
 * LSP 文档解析（无副作用，便于直接测试）。
 *
 * ★非英文文档必须把 lexicon 一路传给 canonicalize **和 lex**：canonicalize 只做
 *   标点/空白归一（「。」→「.」），关键字仍是原文；无 lexicon 的 lexer 见到「模」
 *   就抛 "Unexpected character"。曾因 getOrParse 写成 `lex(can)`，zh/de 文档的
 *   hover、跳转、文档符号全部失败（诊断路径吞掉异常，表现为「无问题」）。
 *   浏览器侧编译（browser.ts）与 formatter 一直是 `lex(canonical, lexicon)`，此处对齐。
 *
 * 返回的 tokens 与 ast 的位置均为**原文**坐标（`can` 仅供需要规范化文本的调用方）。
 *
 * ★词法错误（未闭合字符串、非法字符、缩进错误）不抛出：返回 `tokens: []`、`ast: null`，
 *   把词法诊断放进 parseDiagnostics，由诊断路径照常发布。抛出会让 getOrParse 失败，
 *   pull 诊断整体 reject 后返回空列表——用户正在输入字符串时反而看到「无问题」。
 *   规范化保持行数不变，词法诊断的行号即原文行号。
 */
import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { parse, parseWithLexicon } from '../parser.js';
import { needsKeywordTranslation } from '../frontend/keyword-translator.js';
import type { Module as AstModule } from '../types.js';
import { DiagnosticError, type Diagnostic } from '../diagnostics/diagnostics.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { buildCanonicalizeOptions } from './canonicalize-options.js';
import { alignTokensToSource } from './source-positions.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';

export interface ParsedDocument {
  readonly can: string;
  readonly tokens: readonly any[];
  readonly ast: AstModule | null;
  readonly parseDiagnostics: readonly Diagnostic[];
  /** 本文档使用的租户词汇作用域（名称解析 R1/R2 用）；无租户词汇时缺省 */
  readonly vocabulary?: VocabularyScopes;
}

export function parseDocumentText(
  text: string,
  lexicon: Lexicon | undefined,
  tenantId: string | undefined,
  domain: string | undefined,
): ParsedDocument {
  const options = buildCanonicalizeOptions(lexicon, tenantId, domain);
  const vocabulary = options && 'vocabulary' in options ? options.vocabulary : undefined;
  const can = canonicalize(text, options);
  // ★token 位置改为原文坐标后再解析：AST span 由 token 派生，于是高亮/跳转/hover/重命名/
  //   诊断的位置都对应原文（canonicalize 删冠词等会改变行内长度，见 source-positions.ts）。
  let tokens: readonly any[];
  try {
    tokens = alignTokensToSource(text, can, lex(can, lexicon));
  } catch (error) {
    if (!(error instanceof DiagnosticError)) throw error;
    const lexFailed = { can, tokens: [], ast: null, parseDiagnostics: [error.diagnostic] };
    return vocabulary ? { ...lexFailed, vocabulary } : lexFailed;
  }
  let ast: AstModule | null;
  let parseDiagnostics: readonly Diagnostic[] = [];
  try {
    const result = lexicon && needsKeywordTranslation(lexicon)
      ? parseWithLexicon(tokens, lexicon)
      : parse(tokens, lexicon);
    ast = result.ast as AstModule;
    parseDiagnostics = result.diagnostics;
  } catch {
    ast = null;
  }
  return vocabulary ? { can, tokens, ast, parseDiagnostics, vocabulary } : { can, tokens, ast, parseDiagnostics };
}
