/**
 * LSP 文档解析（无副作用，便于直接测试）。
 *
 * ★非英文文档必须把 lexicon 一路传给 canonicalize **和 lex**：canonicalize 只做
 *   标点/空白归一（「。」→「.」），关键字仍是原文；无 lexicon 的 lexer 见到「模」
 *   就抛 "Unexpected character"。曾因 getOrParse 写成 `lex(can)`，zh/de 文档的
 *   hover、跳转、文档符号全部失败（诊断路径吞掉异常，表现为「无问题」）。
 *   浏览器侧编译（browser.ts）与 formatter 一直是 `lex(canonical, lexicon)`，此处对齐。
 */
import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { parse, parseWithLexicon } from '../parser.js';
import { needsKeywordTranslation } from '../frontend/keyword-translator.js';
import type { Module as AstModule } from '../types.js';
import type { Diagnostic } from '../diagnostics/diagnostics.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { buildCanonicalizeOptions } from './canonicalize-options.js';

export interface ParsedDocument {
  readonly can: string;
  readonly tokens: readonly any[];
  readonly ast: AstModule | null;
  readonly parseDiagnostics: readonly Diagnostic[];
}

export function parseDocumentText(
  text: string,
  lexicon: Lexicon | undefined,
  tenantId: string | undefined,
  domain: string | undefined,
): ParsedDocument {
  const can = canonicalize(text, buildCanonicalizeOptions(lexicon, tenantId, domain));
  const tokens = lex(can, lexicon);
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
  return { can, tokens, ast, parseDiagnostics };
}
