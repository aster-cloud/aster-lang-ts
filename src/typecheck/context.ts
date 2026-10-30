import type { Core, Span } from '../types.js';
import type { EffectSignature } from '../effects/effect_signature.js';
import type { ModuleCache } from '../lsp/module_cache.js';
import type { Lexicon } from '../config/lexicons/types.js';
import type { ControlRegistry } from '../governance/controls.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { DiagnosticBuilder } from './diagnostics.js';
import { SymbolTable } from './symbol_table.js';
import type { SymbolKind } from './symbol_table.js';
import { TypeSystem } from './type_system.js';
import { formatType, typesEqual } from './pure.js';

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
  /**
   * effect 推断用的 IO / CPU 名称前缀（issue #88）。
   *
   * <p>**由调用方注入，而非由 effects.ts 自行 import**。原因是浏览器边界：
   * `browser.ts` 直接 `import { checkEffects } from './effects.js'`，而读配置的
   * `typecheck/utils.ts` 静态引用了 `node:module` / `node:path`——effects.ts 一旦
   * import 它，Node 内置模块就会被拉进浏览器 bundle 闭包（`pure.ts` 头注释 R15 记载
   * 过这条约束：**即使包在 try/catch 里**，打包器仍会看到该引用）。
   *
   * 注入让两侧各取所需：Node 入口传 `getIOPrefixesCompat()` 的配置值，浏览器入口
   * 留空、由 effects.ts 回落到 `pure.ts` 的内置默认值。effects.ts 因此保持
   * browser-safe，同时用户自定义 effect 配置在 Node 侧真正生效。
   *
   * 省略时等价于内置默认值。
   */
  effectPrefixes?: { readonly io: readonly string[]; readonly cpu: readonly string[] };
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
  lexicon?: Lexicon | undefined;
  /** 控制注册表（ADR 0045）；缺省用内置副本 */
  controls?: ControlRegistry | undefined;
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
  // ADR 0052：只有 Let 绑定可被 Set 赋值；形参、lambda 形参、模式绑定不可变（与 Java BaseTypeChecker 一致）。
  options.mutable = kind === 'var';
  context.symbols.define(name, type, kind, options);
}

/** 不可赋值的绑定种类在诊断里的英文称呼（与 Java 端一致）。 */
const IMMUTABLE_KIND_LABEL: Partial<Record<SymbolKind, string>> = {
  param: 'parameter',
  pattern: 'pattern binding',
};

export function assignSymbol(context: TypecheckWalkerContext, name: string, type: Core.Type, span?: Span): void {
  const symbol = context.symbols.lookup(name);
  if (!symbol) {
    context.diagnostics.undefinedVariable(name, span);
    return;
  }
  if (!symbol.mutable) {
    // 与 Java BaseTypeChecker 同码（E001）。专用错误码待语言包补齐译文后再引入（见 ADR 0052 §5）。
    context.diagnostics.error(ErrorCode.TYPE_MISMATCH, span, {
      expected: 'a Let binding',
      actual: `${IMMUTABLE_KIND_LABEL[symbol.kind] ?? symbol.kind} '${name}'`,
    });
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
