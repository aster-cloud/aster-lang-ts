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
 * const source = `This module is app. To greet name String, produce String: Return "Hello, " + name.`;
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

// Lexicons for multi-language support
import { LexiconRegistry, initializeDefaultLexicons } from './config/lexicons/index.js';
export { EN_US, ZH_CN, DE_DE, LexiconRegistry, initializeDefaultLexicons } from './config/lexicons/index.js';
export type { Lexicon } from './config/lexicons/types.js';

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
 *   This module is pricing.
 *   To calculate_discount amount Number, produce Number:
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

    // Step 1: Canonicalize source WITH lexicon for language-specific normalization
    // If domain is specified, pass CanonicalizerOptions to enable identifier translation
    let canonical: string;
    if (domain) {
      // Resolve effective lexicon for domain translation (default to EN_US)
      const effectiveLexicon = lexicon ?? (initializeDefaultLexicons(), LexiconRegistry.getDefault());
      canonical = canonicalize(source, { lexicon: effectiveLexicon, domain, locale: effectiveLexicon.id });
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
    const ast = parse(tokens);

    // Check for parse errors
    if ('error' in ast || !ast) {
      const result: CompileResult = {
        success: false,
        parseErrors: [{
          message: 'error' in ast ? (ast as { error: string }).error : 'Parse failed',
        }],
      };
      if (options?.includeIntermediates) {
        result.tokens = tokens;
      }
      return result;
    }

    // Step 4: Lower to Core IR
    const core = lowerModule(ast);

    const result: CompileResult = {
      success: true,
      core,
    };
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

    const ast = parse(tokens);

    if ('error' in ast) {
      return [{ message: (ast as { error: string }).error }];
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
 * Validate CNL source code syntax without full compilation
 *
 * This is a lightweight validation that only runs lexer and parser,
 * useful for real-time editor validation.
 *
 * @param source - CNL source code
 * @param lexicon - CNL lexicon (optional, defaults to EN_US)
 * @returns Array of error messages (empty if valid)
 * @deprecated Use validateSyntaxWithSpan for position information
 */
export function validateSyntax(source: string, lexicon?: Lexicon): string[] {
  return validateSyntaxWithSpan(source, lexicon).map(e => e.message);
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

import type { TypeKind, ParameterInfo, FieldInfo } from './parser/input-generator.js';
import type { Module, Declaration, Func, Data, Type } from './types.js';

/**
 * Schema extraction result
 */
export interface SchemaResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Module name */
  moduleName?: string;
  /** Function name */
  functionName?: string;
  /** Parameter schema */
  parameters?: ParameterInfo[];
  /** Error message if failed */
  error?: string;
}

/**
 * Schema extraction options
 */
export interface SchemaOptions {
  /** CNL lexicon (default: EN_US) */
  lexicon?: Lexicon;
  /** Target function name (default: first function) */
  functionName?: string;
}

/**
 * Convert AST Type to type kind
 */
function getTypeKind(type: Type): TypeKind {
  if (!type || typeof type !== 'object' || !('kind' in type)) {
    return 'unknown';
  }

  switch (type.kind) {
    case 'TypeName': {
      const name = type.name.toLowerCase();
      if (['int', 'float', 'double', 'number', 'bool', 'boolean', 'text', 'string', 'datetime', 'date', 'time'].includes(name)) {
        return 'primitive';
      }
      // Custom type names are typically structs
      return 'struct';
    }
    case 'List':
      return 'list';
    case 'Map':
      return 'map';
    case 'Option':
    case 'Maybe':
      return 'option';
    case 'Result':
      return 'result';
    case 'FuncType':
      return 'function';
    default:
      return 'unknown';
  }
}

/**
 * Convert AST Type to display string
 */
function typeToString(type: Type): string {
  if (!type || typeof type !== 'object' || !('kind' in type)) {
    return 'Unknown';
  }

  switch (type.kind) {
    case 'TypeName':
      return type.name;
    case 'List':
      return `List<${typeToString(type.type)}>`;
    case 'Map':
      return `Map<${typeToString(type.key)}, ${typeToString(type.val)}>`;
    case 'Option':
      return `Option<${typeToString(type.type)}>`;
    case 'Maybe':
      return `Maybe<${typeToString(type.type)}>`;
    case 'Result':
      return `Result<${typeToString(type.ok)}, ${typeToString(type.err)}>`;
    default:
      return 'Unknown';
  }
}

/**
 * Extract schema from CNL source code
 *
 * Parses CNL source and extracts parameter schema for the specified function,
 * suitable for dynamic form generation.
 *
 * @param source - CNL source code
 * @param options - Schema extraction options
 * @returns Schema extraction result
 *
 * @example
 * ```typescript
 * const result = extractSchema(`
 *   This module is loan.
 *   A LoanApplication has creditScore Int, amount Float, term Int.
 *   To evaluate application LoanApplication, produce Bool:
 *     If application.creditScore >= 700 then Return true
 *     Otherwise Return false.
 * `);
 *
 * if (result.success) {
 *   console.log(result.parameters);
 *   // [{ name: 'application', type: 'LoanApplication', typeKind: 'struct', ... }]
 * }
 * ```
 */
export function extractSchema(source: string, options?: SchemaOptions): SchemaResult {
  try {
    const lexicon = options?.lexicon;

    // Canonicalize with lexicon for language-specific normalization
    const canonical = canonicalize(source, lexicon);
    let tokens = lex(canonical, lexicon);

    // Translate non-English tokens to English for parser compatibility
    if (lexicon && needsKeywordTranslation(lexicon)) {
      const translator = createKeywordTranslator(lexicon);
      tokens = translator.translateTokens(tokens);
    }

    // Parse to AST
    const ast = parse(tokens);

    if ('error' in ast || !ast) {
      return {
        success: false,
        error: 'error' in ast ? (ast as { error: string }).error : 'Parse failed',
      };
    }

    const module = ast as Module;
    const moduleName = module.name ?? 'unknown';

    // Find all Data declarations (for struct field resolution)
    const dataDecls = new Map<string, FieldInfo[]>();
    for (const decl of module.decls) {
      if (decl.kind === 'Data') {
        const data = decl as Data;
        const fields: FieldInfo[] = data.fields.map((f) => ({
          name: f.name,
          type: typeToString(f.type),
          typeKind: getTypeKind(f.type),
        }));
        dataDecls.set(data.name, fields);
      }
    }

    // Find the target function
    const funcs = module.decls.filter((d: Declaration) => d.kind === 'Func') as Func[];
    if (funcs.length === 0) {
      return {
        success: false,
        error: 'No functions found in module',
      };
    }

    const targetFuncName = options?.functionName;
    const func = targetFuncName
      ? funcs.find((f: Func) => f.name === targetFuncName)
      : funcs[0];

    if (!func) {
      return {
        success: false,
        error: targetFuncName
          ? `Function '${targetFuncName}' not found`
          : 'No functions found in module',
      };
    }

    // Extract parameters
    const parameters: ParameterInfo[] = func.params.map((param, index) => {
      let typeName = typeToString(param.type);
      let typeKind = getTypeKind(param.type);
      let fields: FieldInfo[] | undefined;

      // Resolve struct fields if applicable
      if (typeKind === 'struct' && dataDecls.has(typeName)) {
        fields = dataDecls.get(typeName);
      } else if (typeKind === 'primitive' && dataDecls.has(param.name)) {
        // 当参数类型为基本类型但参数名与 Data 定义匹配时，
        // 推断参数类型为该 Data 类型（支持中文无类型参数语法）
        // 例如：规则 评估贷款 给定 申请人：
        // 此时参数名"申请人"与 Data "申请人"匹配，推断类型为结构体
        typeName = param.name;
        typeKind = 'struct';
        fields = dataDecls.get(param.name);
      }

      const result: ParameterInfo = {
        name: param.name,
        type: typeName,
        typeKind,
        optional: false, // Parameters don't have optional field in AST
        position: index,
      };

      if (fields) {
        result.fields = fields;
      }

      return result;
    });

    return {
      success: true,
      moduleName,
      functionName: func.name,
      parameters,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

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
 * @param source - CNL source code
 * @param options - Compile and type check options
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
  options?: CompileOptions & { enforcePii?: boolean }
): CompileResult & { typeErrors: import('./types.js').TypecheckDiagnostic[] } {
  const compileResult = compile(source, options);

  if (!compileResult.success || !compileResult.core) {
    return {
      ...compileResult,
      typeErrors: [],
    };
  }

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
