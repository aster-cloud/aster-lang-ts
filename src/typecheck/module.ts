import { performance } from 'node:perf_hooks';
import type { Core, TypecheckDiagnostic } from '../types.js';
import {
  type CapabilityManifest,
  type CapabilityContext,
  isAllowed,
  normalizeManifest,
  parseLegacyCapability,
} from '../effects/capabilities.js';
import { CapabilityKind } from '../config/semantic.js';
import { inferEffects } from '../effects/effect_inference.js';
import { createLogger, logPerformance } from '../utils/logger.js';
import { checkModulePII } from '../typecheck-pii.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { EffectSignature } from '../effects/effect_signature.js';
import { ModuleCache, defaultModuleCache } from '../lsp/module_cache.js';
import {
  defineSymbol,
  type ModuleContext,
  type TypecheckOptions,
  type TypecheckWalkerContext,
} from './context.js';
import { DiagnosticBuilder } from './diagnostics.js';
import { SymbolTable } from './symbol_table.js';
import {
  formatType,
  isUnknown,
  normalizeModuleSearchPaths,
  normalizeType,
  shouldEnforcePii,
  typesEqual,
  unknownType,
} from './utils.js';
import { checkAsyncDiscipline } from './async.js';
import { typecheckBlock } from './statement.js';
import {
  collectCapabilities,
  checkCapabilities,
} from './capabilities.js';
import {
  checkEffects,
  checkCapabilityInferredEffects,
} from './effects.js';
import { unifyTypeParameters, checkGenericTypeParameters } from './generics.js';
import { TypeSystem } from './type_system.js';

const typecheckLogger = createLogger('typecheck');
const MODULE_NOT_FOUND_ERROR = 'MODULE_NOT_FOUND';

export function typecheckModule(m: Core.Module, options?: TypecheckOptions): TypecheckDiagnostic[] {
  const moduleName = m.name ?? '<anonymous>';
  const startTime = performance.now();
  typecheckLogger.info('开始类型检查模块', { moduleName });
  try {
    const moduleCache = options?.moduleCache ?? defaultModuleCache;
    const moduleSearchPaths = normalizeModuleSearchPaths(options?.moduleSearchPaths);
    const diagnostics = new DiagnosticBuilder({
      diagnosticMessages: options?.lexicon?.diagnosticMessages,
      diagnosticHelp: options?.lexicon?.diagnosticHelp,
    });
    const ctx: ModuleContext = {
      datas: new Map(),
      enums: new Map(),
      imports: new Map(),
      funcSignatures: new Map(),
      importedEffects: new Map(),
      moduleSearchPaths,
    };
    const importDecls: Core.Import[] = [];
    for (const d of m.decls) {
      if (d.kind === 'Func') {
        const params = d.params.map(param => normalizeType(param.type as Core.Type));
        let ret = normalizeType(d.ret as Core.Type);
        if ((d as { retTypeInferred?: boolean }).retTypeInferred) {
          const inferred = TypeSystem.inferFunctionType(d.params, d.body.statements).ret as Core.Type;
          if (!isUnknown(inferred)) ret = inferred;
        }
        ctx.funcSignatures.set(d.name, { params, ret });
      }
    }

    for (const d of m.decls) {
      if (d.kind === 'Import') {
        importDecls.push(d);
        const alias = d.asName ?? d.name;
        if (ctx.imports.has(alias)) {
          diagnostics.warning(ErrorCode.DUPLICATE_IMPORT_ALIAS, d.span, { alias });
        } else {
          ctx.imports.set(alias, d.name);
        }
      }
    }
    for (const d of m.decls) {
      if (d.kind === 'Data') ctx.datas.set(d.name, d);
      if (d.kind === 'Enum') ctx.enums.set(d.name, d);
    }
    for (const d of m.decls) {
      if (d.kind === 'Func') {
        typecheckFunc(ctx, d, diagnostics);
      }
    }
    const importedEffectsResult = loadImportedEffects(importDecls, moduleCache, moduleSearchPaths);
    if (importedEffectsResult instanceof Map) {
      ctx.importedEffects = importedEffectsResult;
    } else {
      return [...diagnostics.getDiagnostics(), importedEffectsResult];
    }
    const effectDiags = inferEffects(m, {
      moduleName,
      imports: ctx.imports,
      importedEffects: ctx.importedEffects,
      moduleUri: options?.uri ?? null,
      moduleCache,
    });
    const piiDiagnostics: TypecheckDiagnostic[] = [];
    if (shouldEnforcePii()) {
      const funcs = m.decls.filter((decl): decl is Core.Func => decl.kind === 'Func');
      if (funcs.length > 0) {
        checkModulePII(funcs, piiDiagnostics, ctx.imports);
      }
    }
    const result = [...diagnostics.getDiagnostics(), ...effectDiags, ...piiDiagnostics];
    const duration = performance.now() - startTime;
    const baseMeta = { moduleName, errorCount: result.length };
    logPerformance({
      component: 'typecheck',
      operation: '模块类型检查',
      duration,
      metadata: baseMeta,
    });
    typecheckLogger.info('类型检查完成', {
      ...baseMeta,
      duration_ms: duration,
    });
    return result;
  } catch (error) {
    typecheckLogger.error('类型检查失败', error as Error, { moduleName });
    throw error;
  }
}

export function loadImportedEffects(
  imports: readonly Core.Import[],
  moduleCache: ModuleCache,
  searchPaths: readonly string[]
): Map<string, EffectSignature> | TypecheckDiagnostic {
  const effectMap = new Map<string, EffectSignature>();
  if (imports.length === 0) return effectMap;

  const visited = new Set<string>();
  for (const imp of imports) {
    const moduleName = (imp.name ?? '').trim();
    if (!moduleName || visited.has(moduleName)) continue;
    visited.add(moduleName);

    const cached = moduleCache.getModuleEffectSignatures(moduleName, searchPaths);
    if (cached) {
      for (const [qualifiedName, signature] of cached) {
        effectMap.set(qualifiedName, signature);
      }
      continue;
    }

    const loaded = moduleCache.loadModule(moduleName, searchPaths);
    if (loaded instanceof Error) {
      if (!moduleName.includes('.')) {
        continue;
      }
      const message = loaded.message.includes(MODULE_NOT_FOUND_ERROR)
        ? `${MODULE_NOT_FOUND_ERROR}: 找不到模块 ${moduleName}，请检查依赖或运行 aster install`
        : loaded.message;
      const diagnostic: TypecheckDiagnostic = {
        severity: 'error',
        code: ErrorCode.UNDEFINED_VARIABLE,
        message,
      };
      if (imp.origin) diagnostic.origin = imp.origin;
      return diagnostic;
    }

    for (const [qualifiedName, signature] of loaded) {
      effectMap.set(qualifiedName, signature);
    }
  }

  return effectMap;
}

export function typecheckModuleWithCapabilities(
  m: Core.Module,
  manifest: CapabilityManifest | null,
  options?: TypecheckOptions
): TypecheckDiagnostic[] {
  const normalizedManifest = manifest ? normalizeManifest(manifest) : null;
  const baseDiagnostics = typecheckModule(m, options);
  if (!normalizedManifest) return baseDiagnostics;

  const builder = new DiagnosticBuilder({
    diagnosticMessages: options?.lexicon?.diagnosticMessages,
    diagnosticHelp: options?.lexicon?.diagnosticHelp,
  });
  const capCtx: CapabilityContext = { moduleName: m.name ?? '' };

  for (const d of m.decls) {
    if (d.kind !== 'Func') continue;

    const declaredCaps = new Set<CapabilityKind>();
    for (const eff of d.effects) {
      const effName = String(eff).toLowerCase();
      if (effName === 'io') {
        for (const cap of parseLegacyCapability('io')) declaredCaps.add(cap);
      } else if (effName === 'cpu') {
        declaredCaps.add(CapabilityKind.CPU);
      }
    }

    const meta = d as unknown as { effectCaps: readonly CapabilityKind[]; effectCapsExplicit: boolean };
    if (meta.effectCapsExplicit) {
      for (const cap of meta.effectCaps) declaredCaps.add(cap);
    }

    const usedCaps = collectCapabilities(d.body);
    for (const cap of usedCaps.keys()) declaredCaps.add(cap);

    for (const cap of declaredCaps) {
      if (!isAllowed(cap, d.name, capCtx, normalizedManifest)) {
        builder.error(ErrorCode.CAPABILITY_NOT_ALLOWED, d.span, {
          func: d.name,
          module: m.name ?? '',
          cap,
        });
      }
    }
  }
  return [...baseDiagnostics, ...builder.getDiagnostics()];
}

function typecheckFunc(ctx: ModuleContext, f: Core.Func, diagnostics: DiagnosticBuilder): void {
  const symbols = new SymbolTable();
  symbols.enterScope('function');
  const functionContext: TypecheckWalkerContext = { module: ctx, symbols, diagnostics };

  for (const param of f.params) {
    const paramType = normalizeType(param.type as Core.Type);
    defineSymbol(functionContext, param.name, paramType, 'param');
  }

  const declaredReturn = normalizeType(f.ret as Core.Type);
  const bodyReturn = f.body ? typecheckBlock(ctx, symbols, f.body, diagnostics) : unknownType();
  const retTypeInferred = (f as { retTypeInferred?: boolean }).retTypeInferred === true;

  if (!retTypeInferred && !typesEqual(bodyReturn, declaredReturn)) {
    diagnostics.error(ErrorCode.RETURN_TYPE_MISMATCH, f.body?.span ?? f.ret?.span ?? f.span, {
      expected: formatType(declaredReturn),
      actual: formatType(bodyReturn),
    });
  }

  checkEffects(ctx, f, diagnostics);
  checkCapabilityInferredEffects(f, diagnostics);
  checkAsyncDiscipline(f, diagnostics);
  checkCapabilities(f, diagnostics);

  const typeParams = (f as unknown as { typeParams?: readonly string[] }).typeParams ?? [];
  if (typeParams.length > 0 && !retTypeInferred) {
    const bindings = new Map<string, Core.Type>();
    unifyTypeParameters(declaredReturn, bodyReturn, bindings, diagnostics, f.ret?.span ?? f.span);
  }

  checkGenericTypeParameters(ctx, f, diagnostics);

  symbols.exitScope();
}
