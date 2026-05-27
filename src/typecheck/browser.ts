/**
 * Browser-compatible type checker for Aster CNL
 *
 * This module provides type checking without Node.js dependencies,
 * suitable for browser/edge runtime use.
 *
 * Limitations:
 * - No cross-module import resolution (single module only)
 * - No file system-based module loading
 *
 * **PII checking is ENABLED by default (P0-1, ADR-0009)**:
 * The PII flow analyzer (checkModulePII) is environment-agnostic — it does
 * not read process.env or the file system. So it works identically in
 * Node / browser / Cloudflare Workers. This is what makes Aster's
 * "PII as a first-class type" promise real across all runtimes.
 *
 * For cross-module import resolution + module-resolution-based diagnostics,
 * use the LSP server. But PII flow analysis is correct here regardless.
 */

import type { Core, TypecheckDiagnostic } from '../types.js';
import type { EffectSignature } from '../effects/effect_signature.js';
import { inferEffects } from '../effects/effect_inference_browser.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { checkModulePII as defaultCheckModulePII } from '../typecheck-pii.js';

/**
 * Testing-only seam for fault injection of the PII analyzer.
 * Production code should never set this; it remains `null` and the default
 * `checkModulePII` is used. Set in tests to a function that throws so the
 * catch branch in `typecheckBrowser` exercises {@link ErrorCode.PII_ANALYZER_FAILED}
 * end-to-end (P0-R2, codex review Medium #5).
 *
 * **生产保护（P0-R3, codex review High #3）**：函数在 production 环境
 * 拒绝任何 non-null 调用。这是 defense-in-depth：即使有人误用，PII 检查
 * 也不会被关闭。判定 production 用 `NODE_ENV === 'production'`，与
 * 其他 Node 生态库的惯例一致。
 */
type PiiCheckerFn = typeof defaultCheckModulePII;
let _piiCheckerOverride: PiiCheckerFn | null = null;

/**
 * @internal Exported for testing only. Calls the underlying `isProductionRuntime`
 * function so vm-sandboxed tests can exercise the real implementation rather
 * than copy-pasting the guard logic into a string.
 */
export function __isProductionRuntimeForTest(): boolean {
  return isProductionRuntime();
}

function isProductionRuntime(): boolean {
  // P0-R4 (codex round 4 review): 跨 runtime 可靠 production 探测。
  // 之前只读 globalThis.process.env.NODE_ENV，在 browser/CF Workers 下
  // false negative（globalThis.process 缺失）。
  //
  // 修复策略：多源探测，按可靠性排序：
  //   1. 直接 process.env.NODE_ENV —— 让 esbuild/webpack define 在编译期
  //      内联替换为字面量（这是 browser bundle 标准做法）
  //   2. globalThis.__ASTER_PRODUCTION__ —— 显式逃生窗口，CF Workers
  //      部署或自定义环境可手动设置
  //   3. globalThis.process.env.NODE_ENV —— Node 路径保留
  //
  // 任何一项判定为 production 都视为 production。保守判定缺失为非 production
  // 以允许 test 路径注入。

  // 1. Direct process.env access (replaced at build time by esbuild/webpack)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') {
      return true;
    }
  } catch {
    /* process not defined */
  }

  // 2. Explicit global escape hatch for runtimes without process (Workers)
  try {
    if ((globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__ === true) {
      return true;
    }
  } catch {
    /* globalThis not available */
  }

  // 3. globalThis.process fallback for embedded Node-in-browser shims
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    if (env?.NODE_ENV === 'production') return true;
  } catch {
    /* not accessible */
  }

  return false;
}

/**
 * @internal Testing seam — do NOT call in production code paths.
 * Throws in production runtime to prevent accidental misuse.
 */
export function __setPiiCheckerForTest(fn: PiiCheckerFn | null): void {
  if (isProductionRuntime() && fn !== null) {
    throw new Error(
      '__setPiiCheckerForTest is a testing-only API and cannot be used in ' +
        'production runtime (NODE_ENV=production). PII checks must always run ' +
        'with the default analyzer.',
    );
  }
  _piiCheckerOverride = fn;
}
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
   * @deprecated Since ADR-0009 (P0-1), PII flow analysis is always enabled.
   *   This option is kept for source-level backwards compatibility but has
   *   no effect. The PII checker (checkModulePII) runs unconditionally in
   *   all runtimes (Node / browser / CF Workers) because it is
   *   environment-agnostic.
   *
   *   Compliance policy packs (which DO need configuration) remain
   *   opt-in via a separate mechanism — see future ADR.
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

    // Effect inference — doesn't require filesystem, but cross-module
    // effects require the caller to supply `importedEffects`. We only warn
    // when the module body actually REFERENCES an import alias that has no
    // effect signature — declared-but-unused imports don't degrade analysis
    // quality, so warning on those would be noise.
    const effectDiags: TypecheckDiagnostic[] = [];
    const referencedAliases = collectReferencedImportAliases(m, ctx.imports);
    const unresolvedReferenced = [...referencedAliases].filter(
      (alias) => !ctx.importedEffects.has(alias),
    );
    if (unresolvedReferenced.length > 0) {
      effectDiags.push({
        severity: 'warning',
        code: ErrorCode.UNDEFINED_VARIABLE,
        message:
          `[browser-typecheck/partial] cross-module effect checks unavailable for ` +
          `referenced imports: ${unresolvedReferenced.join(', ')}. ` +
          `Pass options.importedEffects (fetch from the LSP server) for full coverage.`,
      });
    }
    try {
      const effectResults = inferEffects(m, {
        moduleName,
        imports: ctx.imports,
        importedEffects: ctx.importedEffects,
        moduleUri: options?.uri ?? null,
      });
      effectDiags.push(...effectResults);
    } catch (e) {
      // Previously this catch was empty — effect-inference failures were swallowed
      // and the user got back "no errors" while the check had aborted halfway.
      // Surface as an `unsupported` diagnostic so the UI can show "partial".
      effectDiags.push({
        severity: 'warning',
        code: ErrorCode.UNDEFINED_VARIABLE,
        message:
          `[browser-typecheck/partial] effect inference aborted: ` +
          `${e instanceof Error ? e.message : String(e)}. ` +
          `Effect-related diagnostics may be missing; re-run via LSP server for full coverage.`,
      });
    }

    // P0-1: PII flow 检查永远启用（不再依赖 enforcePii option）。
    // checkModulePII 不读取 process.env / fs，跨运行时（Node / browser /
    // Workers）行为一致。详见 ADR-0009。
    const piiDiagnostics: TypecheckDiagnostic[] = [];
    const funcs = m.decls.filter((decl): decl is Core.Func => decl.kind === 'Func');
    if (funcs.length > 0) {
      try {
        const piiChecker = _piiCheckerOverride ?? defaultCheckModulePII;
        piiChecker(funcs, piiDiagnostics, ctx.imports);
      } catch (e) {
        // 防御性 fallback：checkModulePII 抛错时仍能继续编译流程，但**必须
        // 明确标记安全检查失败**——不能伪装成普通 warning。使用专用 code
        // PII_ANALYZER_FAILED + severity=error，让 UI/CI 把这种情况当成
        // hard failure 处理。
        // Node 路径（module.ts）让异常向上传播；浏览器路径捕获是为了保证
        // 编辑器其他诊断（语法、类型）仍能显示，但 PII 安全失败本身必须
        // 显式可见。
        const reason = e instanceof Error ? e.message : String(e);
        piiDiagnostics.push({
          severity: 'error',
          code: ErrorCode.PII_ANALYZER_FAILED,
          // P0-R2 (codex review High #6): 业务用户友好消息——避免编译器
          // 内部语气；给出可执行的恢复建议（保存重试/联系管理员）。
          message:
            `PII safety analysis failed for this module — the editor ` +
            `cannot verify whether sensitive data is correctly handled. ` +
            `This policy should not be deployed until the analysis ` +
            `succeeds. Internal reason: ${reason}`,
        });
      }
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
 * Walk the module and collect import aliases that are actually referenced
 * by any expression in the function bodies. This lets the partial-coverage
 * warning fire only when missing effects would matter — declared-but-unused
 * imports don't degrade analysis quality.
 *
 * Approach: recurse through Core.Expression nodes looking for `Name` nodes
 * whose `name` matches an import alias. Lightweight tree walk; no
 * type information needed.
 */
function collectReferencedImportAliases(
  m: Core.Module,
  imports: ReadonlyMap<string, string>,
): Set<string> {
  if (imports.size === 0) return new Set();
  const referenced = new Set<string>();
  const aliases = [...imports.keys()];
  // Match either a bare alias (`Http`) or a qualified reference
  // (`Http.get` → matches alias `Http`). Core IR keeps Module.member as a
  // single dotted Name, so the check is on the prefix before the first dot.
  const match = (name: string): string | undefined => {
    for (const a of aliases) {
      if (name === a || name.startsWith(a + '.')) return a;
    }
    return undefined;
  };
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as { kind?: unknown; name?: unknown };
    if (obj.kind === 'Name' && typeof obj.name === 'string') {
      const hit = match(obj.name);
      if (hit) referenced.add(hit);
    }
    // Recurse over every enumerable property — the AST shape is irregular
    // enough that hand-listing each child slot is brittle. Cycles aren't
    // possible since Core IR is a tree built fresh per module.
    for (const v of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') visit(v);
    }
  };
  for (const d of m.decls) {
    if (d.kind === 'Func' && d.body) visit(d.body);
  }
  return referenced;
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
