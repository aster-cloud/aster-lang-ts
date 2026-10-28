/**
 * @module compile-pipeline
 *
 * 各编译入口（browser compile / compileAndTypecheck、emit-core、resolvePolicyTypes）共用的前端：
 *
 * ```
 * 源码 ─canonicalize（关键词 / 别名 / 字面量宏 / 空白）─▶ lex ─▶ 关键词翻译 ─▶ parse ─▶ AST
 *      ─▶ R1 resolveDeclarations ─▶ lowerModule ─▶ R2 resolveTypedReferences ─▶ Core（只含规范名）
 * ```
 *
 * R2 依赖 lower 在同一进程内登记的 ResolutionMark（按对象身份的旁路表），因此必须紧接 lower、
 * 作用于同一个 Core 对象运行，不能跨序列化边界。
 */
import { canonicalize } from './frontend/canonicalizer.js';
import { lex } from './frontend/lexer.js';
import { parse } from './parser.js';
import { lowerModule } from './lower_to_core.js';
import { createKeywordTranslator, needsKeywordTranslation } from './frontend/keyword-translator.js';
import { attachTypeInferenceRules } from './config/lexicons/type-inference-rules.js';
import { resolveDeclarations } from './frontend/resolve-declarations.js';
import { NO_IMPORTS } from './frontend/resolution-context.js';
import type { ResolutionContext } from './frontend/resolution-context.js';
import { resolveTypedReferences } from './core/resolve-typed-references.js';
import type { Lexicon } from './config/lexicons/types.js';
import type { VocabularyScopes } from './config/lexicons/identifiers/scopes.js';
import type { Diagnostic } from './diagnostics/diagnostics.js';
import type { Core, Module as AstModule, Token, TypecheckDiagnostic } from './types.js';

export interface ParsedSource {
  readonly tokens: Token[];
  readonly ast: AstModule;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * canonicalize → lex → 关键词翻译 → parse。词汇只用于字面量宏展开，标识符保持原写法。
 * 词法错误以 DiagnosticError 抛出，由调用方处理。
 */
export function parseSource(source: string, lexicon?: Lexicon, scopes?: VocabularyScopes): ParsedSource {
  const canonical = canonicalize(source, { lexicon, vocabulary: scopes });
  let tokens = lex(canonical, lexicon);
  // 解析器使用英文关键词，非英文 lexicon 需先把关键词 token 翻译为英文
  if (lexicon && needsKeywordTranslation(lexicon)) {
    tokens = createKeywordTranslator(lexicon).translateTokens(tokens);
  }
  const result = parse(tokens, lexicon ? attachTypeInferenceRules(lexicon) : undefined);
  return { tokens, ast: result.ast, diagnostics: result.diagnostics };
}

export interface ResolvedCore {
  /** R1 输出的 AST（标识符节点带 resolved） */
  readonly ast: AstModule;
  /** R2 输出的 Core：只含规范名，原写法记在 origin.written */
  readonly core: Core.Module;
  /** R1 与 R2 的诊断（E800–E807 / W800–W801） */
  readonly diagnostics: readonly TypecheckDiagnostic[];
}

/**
 * 名称解析上下文。
 *
 * 导入模块的声明在 CNL 中只能经导入别名限定访问（`R.calc(x)`；解析器不接受限定类型名与限定构造），
 * 限定前缀属于 MODULE 段、不参与词汇解析，R1/R2 原样保留整个点分名。因此不存在需要按名查找的
 * 未限定导入声明，各入口（包括无文件系统的浏览器编译）都使用空的导入表。
 */
function contextOf(scopes: VocabularyScopes | undefined): ResolutionContext {
  return scopes ? { scopes, imports: NO_IMPORTS } : { imports: NO_IMPORTS };
}

/** R1 → lower → R2（ADR 0051 §4）。任一 error 级诊断时调用方不得发出 core。 */
export function resolveAndLower(ast: AstModule, scopes?: VocabularyScopes): ResolvedCore {
  const ctx = contextOf(scopes);
  const r1 = resolveDeclarations(ast, ctx);
  const r2 = resolveTypedReferences(lowerModule(r1.module), ctx);
  return { ast: r1.module, core: r2.module, diagnostics: [...r1.diagnostics, ...r2.diagnostics] };
}

export function hasErrors(diagnostics: readonly { readonly severity: string }[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
