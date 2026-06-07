/**
 * @module @aster-cloud/aster-lang-ts/browser
 *
 * Lightweight browser/edge-compatible entry point for Aster CNL compiler.
 * This module excludes Node.js dependencies and is suitable for:
 * - Browser-based editors
 * - Cloudflare Workers/Pages
 * - Edge runtimes (Vercel Edge, Deno Deploy, etc.)
 *
 * **Compilation Pipeline**:
 * ```
 * CNL Source → canonicalize → lex → parse → AST → lowerModule → Core IR → typecheck
 * ```
 *
 * @example Basic compilation
 * ```typescript
 * import { compile, compileWithDiagnostics } from '@aster-cloud/aster-lang-ts/browser';
 *
 * const source = `Module app. Rule greet given name as Text, produce Text: Return "Hello, " + name.`;
 * const result = compile(source);
 *
 * if (result.success) {
 *   console.log('Compiled Core IR:', result.core);
 * } else {
 *   console.error('Compilation errors:', result.errors);
 * }
 * ```
 */

// Core compilation pipeline functions
export { canonicalize } from './frontend/canonicalizer.js';
export { lex } from './frontend/lexer.js';
export { parse } from './parser.js';
export { lowerModule } from './lower_to_core.js';

// Keyword translation (multi-language CNL support)
export {
  createKeywordTranslator,
  buildKeywordTranslationIndex,
  buildFullTranslationIndex,
  translateTokens,
  translateTokensWithMarkers,
  translateToken,
  needsKeywordTranslation,
} from './frontend/keyword-translator.js';
export type {
  KeywordTranslationIndex,
  MarkerKeywordIndex,
  TranslationIndexResult,
} from './frontend/keyword-translator.js';

// Core types and enums
export { Core, Effect } from './core/core_ir.js';
export { TokenKind, KW } from './frontend/tokens.js';
export { Node } from './ast/ast.js';

// Core IR interpreter (evaluate policies in the browser)
export { evaluate } from './core/interpreter.js';
export type { EvalResult } from './core/interpreter.js';

// Input value generation (for policy execution)
export {
  generateFieldValue,
  generateInputValues,
  getFieldValueHint,
} from './parser/input-generator.js';
export type {
  TypeKind,
  FieldInfo,
  ParameterInfo,
} from './parser/input-generator.js';

// Type definitions re-export
export type * from './types.js';

// Lexicons for multi-language support.
// 浏览器路径下使用 initializeAllBundledLexicons —— 因为浏览器 bundle 本来就把
// en/zh/de 编译进去，不存在"按需加载"的服务端约束。后续可在 next major 时
// 由消费者改用 initializeDefaultLexicons + 显式 register。
import { LexiconRegistry, initializeAllBundledLexicons } from './config/lexicons/index.js';
export {
  EN_US,
  ZH_CN,
  DE_DE,
  LexiconRegistry,
  initializeDefaultLexicons,
  initializeAllBundledLexicons,
} from './config/lexicons/index.js';
export type { Lexicon } from './config/lexicons/types.js';

// LSP UI texts (localized labels for hover, completion, etc.)
export { getLspUiTexts } from './config/lexicons/lsp-ui-texts.js';
export type { LspUiTexts } from './config/lexicons/lsp-ui-texts.js';

// ============================================================================
// High-level compilation API (browser-friendly)
// ============================================================================

import { canonicalize } from './frontend/canonicalizer.js';
import { lex } from './frontend/lexer.js';
import { parse } from './parser.js';
import { lowerModule } from './lower_to_core.js';
import type { Core as CoreTypes, Token, Module as AstModule } from './types.js';
import type { Lexicon } from './config/lexicons/types.js';
import { typecheckBrowser as _typecheckBrowser } from './typecheck/browser.js';
import { createKeywordTranslator, needsKeywordTranslation } from './frontend/keyword-translator.js';
import { attachTypeInferenceRules } from './config/lexicons/type-inference-rules.js';
import { DiagnosticError } from './diagnostics/diagnostics.js';

/**
 * Parse error with position information
 */
export interface ParseError {
  /** Error message */
  message: string;
  /** Position information (optional, for backward compatibility) */
  span?: {
    start: { line: number; col: number };
    end: { line: number; col: number };
  };
}

/**
 * Compilation result with success/failure status
 */
export interface CompileResult {
  /** Whether compilation succeeded */
  success: boolean;
  /** Compiled Core IR module (if successful) */
  core?: CoreTypes.Module;
  /** Parse errors (if any) - now includes position information */
  parseErrors?: ParseError[];
  /** Lowering errors (if any) */
  loweringErrors?: string[];
  /** Raw tokens from lexer (only when includeIntermediates is true) */
  tokens?: Token[];
  /** AST from parser (only when includeIntermediates is true) */
  ast?: AstModule;
}

/**
 * Compilation options
 */
export interface CompileOptions {
  /** CNL lexicon (default: EN_US). Pass a Lexicon object from the exports. */
  lexicon?: Lexicon;
  /** 领域标识符（如 'insurance.auto'），启用领域标识符翻译 */
  domain?: string;
  /**
   * 租户标识符。提供时，领域词汇翻译优先命中该租户的自定义词汇
   * （需先经 `vocabularyRegistry.registerCustom` 注册），未命中回退内置。
   */
  tenantId?: string;
  /** Include intermediate representations in result */
  includeIntermediates?: boolean;
}

/**
 * Compile CNL source code to Core IR
 *
 * This is the main compilation function for browser/edge use.
 * It runs the full compilation pipeline without type checking
 * (type checking requires module resolution which needs file system access).
 *
 * @param source - CNL source code
 * @param options - Compilation options
 * @returns Compilation result with Core IR or errors
 *
 * @example
 * ```typescript
 * const result = compile(`
 *   Module pricing.
 *   Rule calculate_discount given amount as Number, produce Number:
 *     If amount > 100 then Return amount * 0.1
 *     Otherwise Return 0.
 * `);
 *
 * if (result.success) {
 *   console.log(result.core);
 * }
 * ```
 */
export function compile(source: string, options?: CompileOptions): CompileResult {
  try {
    const lexicon = options?.lexicon;
    const domain = options?.domain;
    const tenantId = options?.tenantId;

    // Step 1: Canonicalize source WITH lexicon for language-specific normalization
    // If domain is specified, pass CanonicalizerOptions to enable identifier translation
    let canonical: string;
    if (domain) {
      // Resolve effective lexicon for domain translation (default to EN_US)
      // M3: 浏览器入口预注册 en + zh + de（这些已在 bundle 里）
      const effectiveLexicon = lexicon ?? (initializeAllBundledLexicons(), LexiconRegistry.getDefault());
      canonical = canonicalize(source, { lexicon: effectiveLexicon, domain, locale: effectiveLexicon.id, tenantId });
    } else {
      canonical = canonicalize(source, lexicon);
    }

    // Step 2: Lexical analysis
    let tokens = lex(canonical, lexicon);

    // Step 3: Translate non-English tokens to English for parser compatibility
    // Parser uses hardcoded English keywords (e.g., 'Module', 'if', 'return')
    // so we need to translate German/Chinese tokens to English before parsing
    if (lexicon && needsKeywordTranslation(lexicon)) {
      const translator = createKeywordTranslator(lexicon);
      tokens = translator.translateTokens(tokens);
    }

    // Step 4: Parse to AST (now with English tokens)
    const effectiveLex = lexicon ? attachTypeInferenceRules(lexicon) : undefined;
    const parseResult = parse(tokens, effectiveLex);

    // Parse 诊断分级：error 必须导致 success=false（即使部分 decl 可恢复），
    // warning 不阻塞编译。原实现仅在 decls 全空时才报失败，导致调用方在
    // 部分恢复场景下误以为编译成功 —— 实际产物（Core IR）来自残缺 AST。
    const parseErrorDiagnostics = parseResult.diagnostics.filter(d => d.severity === 'error');
    if (parseErrorDiagnostics.length > 0) {
      const result: CompileResult = {
        success: false,
        parseErrors: parseResult.diagnostics.map(d => ({
          message: d.message,
          span: d.span,
        })),
      };
      if (options?.includeIntermediates) {
        result.tokens = tokens;
      }
      return result;
    }

    const ast = parseResult.ast;

    // Step 5: Lower to Core IR
    const core = lowerModule(ast);

    const result: CompileResult = {
      success: true,
      core,
    };
    if (parseResult.diagnostics.length > 0) {
      // 此时只剩 warning（error 已在上面 short-circuit），保留以便调用方展示
      result.parseErrors = parseResult.diagnostics.map(d => ({ message: d.message, span: d.span }));
    }
    if (options?.includeIntermediates) {
      result.tokens = tokens;
      result.ast = ast;
    }
    return result;
  } catch (error) {
    // Handle DiagnosticError with position information
    if (error instanceof DiagnosticError) {
      const diagnostic = error.diagnostic;
      return {
        success: false,
        parseErrors: [{
          message: diagnostic.message,
          span: diagnostic.span,
        }],
      };
    }
    return {
      success: false,
      loweringErrors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Validate CNL source code syntax without full compilation
 *
 * This is a lightweight validation that only runs lexer and parser,
 * useful for real-time editor validation.
 *
 * @param source - CNL source code
 * @param lexicon - CNL lexicon (optional, defaults to EN_US)
 * @returns Array of error messages (empty if valid)
 */
/**
 * Validation result with position information
 */
export interface ValidationError {
  /** Error message */
  message: string;
  /** Position information (optional) */
  span?: {
    start: { line: number; col: number };
    end: { line: number; col: number };
  };
}

/**
 * Validate CNL source code syntax without full compilation
 *
 * This is a lightweight validation that only runs lexer and parser,
 * useful for real-time editor validation.
 *
 * @param source - CNL source code
 * @param lexicon - CNL lexicon (optional, defaults to EN_US)
 * @returns Array of validation errors with position information
 */
export function validateSyntaxWithSpan(source: string, lexicon?: Lexicon): ValidationError[] {
  try {
    // Canonicalize with lexicon for language-specific normalization
    const canonical = canonicalize(source, lexicon);
    let tokens = lex(canonical, lexicon);

    // Translate non-English tokens to English for parser compatibility
    if (lexicon && needsKeywordTranslation(lexicon)) {
      const translator = createKeywordTranslator(lexicon);
      tokens = translator.translateTokens(tokens);
    }

    const effectiveLexForValidation = lexicon ? attachTypeInferenceRules(lexicon) : undefined;
    const result = parse(tokens, effectiveLexForValidation);

    // 错误恢复模式：直接返回收集到的诊断
    if (result.diagnostics.length > 0) {
      return result.diagnostics.map(d => ({
        message: d.message,
        span: d.span,
      }));
    }

    return [];
  } catch (error) {
    // Handle DiagnosticError with position information
    if (error instanceof DiagnosticError) {
      const diagnostic = error.diagnostic;
      return [{
        message: diagnostic.message,
        span: diagnostic.span,
      }];
    }
    return [{ message: error instanceof Error ? error.message : String(error) }];
  }
}


/**
 * Get tokens from CNL source (for syntax highlighting)
 *
 * @param source - CNL source code
 * @param lexicon - CNL lexicon (optional, defaults to EN_US)
 * @returns Array of tokens
 */
export function tokenize(source: string, lexicon?: Lexicon): Token[] {
  // Canonicalize with lexicon for language-specific normalization
  const canonical = canonicalize(source, lexicon);
  return lex(canonical, lexicon);
}

// ============================================================================
// Schema extraction API (for dynamic form generation)
// ============================================================================
// 实现移到 ./browser/schema.ts；这里只再导出以保持公共 API 不变。
// 见 Round-3 codex 重构记录。

export { extractSchema } from './browser/schema.js';
export type { SchemaResult, SchemaOptions } from './browser/schema.js';

// ============================================================================
// Browser-compatible Type Checking API
// ============================================================================

export { typecheckBrowser } from './typecheck/browser.js';
export type { BrowserTypecheckOptions } from './typecheck/browser.js';
export type { TypecheckDiagnostic } from './types.js';

/**
 * Compile and type check CNL source in one call
 *
 * This is the recommended API for browser/edge use when you need
 * both compilation and type checking.
 *
 * **PII flow analysis is always enabled** since ADR-0009 P0-1. The
 * `enforcePii` option is accepted for source-level backwards compatibility
 * but is ignored — see {@link compileAndTypecheck} options below.
 *
 * @param source - CNL source code
 * @param options - Compile and type check options. Note: `enforcePii` is
 *   **deprecated** and ignored; PII checks are always on.
 * @returns Object containing compilation result and type diagnostics
 *
 * @example
 * ```typescript
 * import { compileAndTypecheck } from '@aster-cloud/aster-lang-ts/browser';
 *
 * const result = compileAndTypecheck(source);
 *
 * if (result.parseErrors.length > 0) {
 *   console.log('Parse errors:', result.parseErrors);
 * }
 *
 * if (result.typeErrors.length > 0) {
 *   console.log('Type errors:', result.typeErrors);
 * }
 *
 * if (result.success && result.core) {
 *   console.log('Compiled successfully:', result.core);
 * }
 * ```
 */
export function compileAndTypecheck(
  source: string,
  options?: CompileOptions & {
    /**
     * @deprecated ADR-0009 P0-1: PII flow analysis is always enabled.
     *   Setting `false` does NOT disable it. Field kept for source-level
     *   backwards compatibility; will be removed next major.
     */
    enforcePii?: boolean;
  }
): CompileResult & { typeErrors: import('./types.js').TypecheckDiagnostic[] } {
  const compileResult = compile(source, options);

  if (!compileResult.success || !compileResult.core) {
    return {
      ...compileResult,
      typeErrors: [],
    };
  }

  // enforcePii is forwarded only for source-level compat. _typecheckBrowser
  // ignores it (PII checks always on).
  const typecheckOptions: { enforcePii?: boolean } = {};
  if (options?.enforcePii !== undefined) {
    typecheckOptions.enforcePii = options.enforcePii;
  }

  const typeErrors = _typecheckBrowser(compileResult.core, typecheckOptions);

  return {
    ...compileResult,
    typeErrors,
  };
}
