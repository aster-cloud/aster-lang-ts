import type { Core, Span } from '../types.js';
import type { EffectSignature } from '../effects/effect_signature.js';
import type { ModuleCache } from '../lsp/module_cache.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { DiagnosticBuilder } from './diagnostics.js';
import { SymbolTable } from './symbol_table.js';
import type { SymbolKind } from './symbol_table.js';
import { TypeSystem } from './type_system.js';
import { formatType, typesEqual } from './utils.js';

// 类型检查上下文模块：集中管理模块/函数上下文字段以及符号定义与赋值操作。

export interface FunctionSignature {
  params: Core.Type[];
  ret: Core.Type;
}

export interface ModuleContext {
  datas: Map<string, Core.Data>;
  enums: Map<string, Core.Enum>;
  imports: Map<string, string>;
  funcSignatures: Map<string, FunctionSignature>;
  importedEffects: Map<string, EffectSignature>;
  moduleSearchPaths: readonly string[];
}

export interface TypecheckWalkerContext {
  module: ModuleContext;
  symbols: SymbolTable;
  diagnostics: DiagnosticBuilder;
}

export interface TypecheckOptions {
  uri?: string | null;
  moduleSearchPaths?: readonly string[];
  moduleCache?: ModuleCache;
}

export function defineSymbol(
  context: TypecheckWalkerContext,
  name: string,
  type: Core.Type,
  kind: SymbolKind,
  span?: Span
): void {
  const existing = context.symbols.lookupInCurrentScope(name);
  if (existing) {
    // 报告重复符号错误，而非静默覆盖
    context.diagnostics.error(ErrorCode.DUPLICATE_SYMBOL, span, {
      name,
      previous: existing.span,
    });
    return;
  }
  const options: { span?: Span; mutable?: boolean } = {};
  if (span) options.span = span;
  options.mutable = kind !== 'param';
  context.symbols.define(name, type, kind, options);
}

export function assignSymbol(context: TypecheckWalkerContext, name: string, type: Core.Type, span?: Span): void {
  const symbol = context.symbols.lookup(name);
  if (!symbol) {
    context.diagnostics.undefinedVariable(name, span);
    return;
  }
  if (!typesEqual(symbol.type, type) && !TypeSystem.isSubtype(type, symbol.type)) {
    context.diagnostics.error(ErrorCode.TYPE_MISMATCH_ASSIGN, span, {
      name,
      expected: formatType(symbol.type),
      actual: formatType(type),
    });
  }
  symbol.type = type;
}
