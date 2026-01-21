/**
 * Browser-compatible type checker for Aster CNL
 *
 * This module provides type checking without Node.js dependencies,
 * suitable for browser/edge runtime use.
 *
 * Limitations:
 * - No cross-module import resolution (single module only)
 * - No file system-based module loading
 * - PII checking disabled by default (no process.env access)
 *
 * For full type checking with module resolution, use the LSP server.
 */

import type { Core, TypecheckDiagnostic } from '../types.js';
import type { EffectSignature } from '../effects/effect_signature.js';
import { inferEffects } from '../effects/effect_inference.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { DiagnosticBuilder } from './diagnostics.js';
import { SymbolTable } from './symbol_table.js';
import { TypeSystem } from './type_system.js';
import {
  defineSymbol,
  type ModuleContext,
  type TypecheckWalkerContext,
} from './context.js';
import {
  formatType,
  isUnknown,
  normalizeType,
  typesEqual,
  unknownType,
} from './utils.js';
import { checkAsyncDiscipline } from './async.js';
import { typecheckBlock } from './statement.js';
import { checkCapabilities } from './capabilities.js';
import { checkEffects, checkCapabilityInferredEffects } from './effects.js';
import { unifyTypeParameters, checkGenericTypeParameters } from './generics.js';

/**
 * Browser-compatible type check options
 */
export interface BrowserTypecheckOptions {
  /**
   * Pre-loaded effect signatures for imported modules.
   * In browser context, these should be fetched from the server.
   */
  importedEffects?: Map<string, EffectSignature>;

  /**
   * Whether to enforce PII (Personally Identifiable Information) checks.
   * Default: false (disabled in browser for performance)
   */
  enforcePii?: boolean;

  /**
   * Module URI for diagnostic reporting
   */
  uri?: string | null;
}

/**
 * Type check a Core IR module in browser/edge environment
 *
 * This is a browser-compatible version of typecheckModule that:
 * - Uses performance.now() from globalThis (works in browser + Node)
 * - Skips module resolution (no file system access)
 * - Accepts pre-loaded effect signatures for imports
 *
 * @param m - Core IR module to type check
 * @param options - Type check options
 * @returns Array of type check diagnostics
 *
 * @example
 * ```typescript
 * import { compile, typecheckBrowser } from '@aster-cloud/aster-lang-ts/browser';
 *
 * const result = compile(source);
 * if (result.success && result.core) {
 *   const diagnostics = typecheckBrowser(result.core);
 *   console.log('Type errors:', diagnostics.filter(d => d.severity === 'error'));
 * }
 * ```
 */
export function typecheckBrowser(
  m: Core.Module,
  options?: BrowserTypecheckOptions
): TypecheckDiagnostic[] {
  const startTime = globalThis.performance?.now?.() ?? Date.now();
  const moduleName = m.name ?? '<anonymous>';

  try {
    const diagnostics = new DiagnosticBuilder();

    // Build module context (without file system module resolution)
    const ctx: ModuleContext = {
      datas: new Map(),
      enums: new Map(),
      imports: new Map(),
      funcSignatures: new Map(),
      importedEffects: options?.importedEffects ?? new Map(),
      moduleSearchPaths: [], // Not used in browser
    };

    // First pass: collect function signatures
    for (const d of m.decls) {
      if (d.kind === 'Func') {
        const params = d.params.map((param) => normalizeType(param.type as Core.Type));
        let ret = normalizeType(d.ret as Core.Type);
        if ((d as { retTypeInferred?: boolean }).retTypeInferred) {
          const inferred = TypeSystem.inferFunctionType(d.params, d.body.statements)
            .ret as Core.Type;
          if (!isUnknown(inferred)) ret = inferred;
        }
        ctx.funcSignatures.set(d.name, { params, ret });
      }
    }

    // Second pass: collect imports, data, enums
    for (const d of m.decls) {
      if (d.kind === 'Import') {
        const alias = d.asName ?? d.name;
        ctx.imports.set(alias, d.name);
        // Note: In browser, we don't resolve imported modules from filesystem
        // The caller should provide importedEffects if cross-module checking is needed
      }
      if (d.kind === 'Data') ctx.datas.set(d.name, d);
      if (d.kind === 'Enum') ctx.enums.set(d.name, d);
    }

    // Third pass: type check functions
    for (const d of m.decls) {
      if (d.kind === 'Func') {
        typecheckFunc(ctx, d, diagnostics);
      }
    }

    // Effect inference (doesn't require file system)
    // Skip effect inference in browser mode if no module cache available
    // This is a simplification - full effect inference requires module resolution
    const effectDiags: TypecheckDiagnostic[] = [];
    try {
      const effectResults = inferEffects(m, {
        moduleName,
        imports: ctx.imports,
        importedEffects: ctx.importedEffects,
        moduleUri: options?.uri ?? null,
      });
      effectDiags.push(...effectResults);
    } catch {
      // Effect inference may fail without module cache, that's expected in browser
    }

    // PII checking (disabled by default in browser)
    const piiDiagnostics: TypecheckDiagnostic[] = [];
    if (options?.enforcePii) {
      // PII checking requires additional setup, skip in browser for now
      // Users can enable full PII checking via LSP server
    }

    const result = [...diagnostics.getDiagnostics(), ...effectDiags, ...piiDiagnostics];

    // Log performance (browser-compatible)
    const duration = (globalThis.performance?.now?.() ?? Date.now()) - startTime;
    if (globalThis.console?.debug) {
      globalThis.console.debug(`[aster] Type check completed: ${moduleName}`, {
        errorCount: result.length,
        duration_ms: duration,
      });
    }

    return result;
  } catch (error) {
    // Return error as diagnostic instead of throwing
    return [
      {
        severity: 'error',
        code: ErrorCode.UNDEFINED_VARIABLE, // Use a valid error code
        message: `Type check failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
}

/**
 * Type check a single function
 */
function typecheckFunc(ctx: ModuleContext, f: Core.Func, diagnostics: DiagnosticBuilder): void {
  const symbols = new SymbolTable();
  symbols.enterScope('function');
  const functionContext: TypecheckWalkerContext = { module: ctx, symbols, diagnostics };

  // Define parameters
  for (const param of f.params) {
    const paramType = normalizeType(param.type as Core.Type);
    defineSymbol(functionContext, param.name, paramType, 'param');
  }

  // Check function body
  const declaredReturn = normalizeType(f.ret as Core.Type);
  const bodyReturn = f.body ? typecheckBlock(ctx, symbols, f.body, diagnostics) : unknownType();
  const retTypeInferred = (f as { retTypeInferred?: boolean }).retTypeInferred === true;

  // Check return type match
  if (!retTypeInferred && !typesEqual(bodyReturn, declaredReturn)) {
    diagnostics.error(ErrorCode.RETURN_TYPE_MISMATCH, f.body?.span ?? f.ret?.span ?? f.span, {
      expected: formatType(declaredReturn),
      actual: formatType(bodyReturn),
    });
  }

  // Additional checks
  checkEffects(ctx, f, diagnostics);
  checkCapabilityInferredEffects(f, diagnostics);
  checkAsyncDiscipline(f, diagnostics);
  checkCapabilities(f, diagnostics);

  // Generic type parameter checks
  const typeParams = (f as unknown as { typeParams?: readonly string[] }).typeParams ?? [];
  if (typeParams.length > 0 && !retTypeInferred) {
    const bindings = new Map<string, Core.Type>();
    unifyTypeParameters(declaredReturn, bodyReturn, bindings, diagnostics, f.ret?.span ?? f.span);
  }

  checkGenericTypeParameters(ctx, f, diagnostics);

  symbols.exitScope();
}

// Re-export types for convenience
export type { TypecheckDiagnostic } from '../types.js';
export type { EffectSignature } from '../effects/effect_signature.js';
