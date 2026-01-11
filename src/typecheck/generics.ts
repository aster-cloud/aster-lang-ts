import type { Core, Span } from '../types.js';
import { DefaultTypeVisitor } from '../ast/ast_visitor.js';
import { DiagnosticBuilder } from './diagnostics.js';
import type { ModuleContext } from './context.js';
import { TypeSystem } from './type_system.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { formatType, typesEqual } from './utils.js';

export function unifyTypeParameters(
  expected: Core.Type,
  actual: Core.Type,
  bindings: Map<string, Core.Type>,
  diagnostics: DiagnosticBuilder,
  span: Span | undefined
): void {
  const inferred = new Map<string, Core.Type>();
  if (!TypeSystem.unify(expected, actual, inferred)) return;

  for (const [name, type] of inferred) {
    const previous = bindings.get(name);
    if (previous) {
      if (!typesEqual(previous, type, true)) {
        diagnostics.error(ErrorCode.TYPEVAR_INCONSISTENT, span, {
          name,
          previous: formatType(previous),
          actual: formatType(type),
        });
      }
    } else {
      bindings.set(name, type);
    }
  }
}

export function checkGenericTypeParameters(
  ctx: ModuleContext,
  f: Core.Func,
  diagnostics: DiagnosticBuilder
): void {
  const typeParams = (f as unknown as { typeParams?: readonly string[] }).typeParams ?? [];

  // 收集已使用的类型变量
  const declared = new Set<string>(typeParams);
  const used = new Set<string>();
  const collector = new TypeParamCollector();
  for (const p of f.params) collector.visitType(p.type, used);
  collector.visitType(f.ret, used);

  // 检查未声明的类型变量使用
  for (const u of used) {
    if (!declared.has(u)) {
      diagnostics.error(ErrorCode.TYPE_VAR_UNDECLARED, f.span, {
        name: u,
        func: f.name,
      });
    }
  }

  // 检查未使用的类型参数
  for (const tv of declared) {
    if (!used.has(tv)) {
      diagnostics.warning(ErrorCode.TYPE_PARAM_UNUSED, f.span, {
        name: tv,
        func: f.name,
      });
    }
  }

  // 查找疑似类型变量的未知类型名
  const unknowns = new Set<string>();
  const finder = new UnknownTypeFinder();
  for (const p of f.params) finder.visitType(p.type, { unknowns, ctx });
  finder.visitType(f.ret, { unknowns, ctx });

  for (const nm of unknowns) {
    if (!declared.has(nm)) {
      diagnostics.error(ErrorCode.TYPEVAR_LIKE_UNDECLARED, f.span, {
        name: nm,
        func: f.name,
      });
    }
  }

  // 效应类型参数声明与使用校验
  const effectParams = (f as unknown as { effectParams?: readonly string[] }).effectParams ?? [];
  const declaredEffectVars = new Set<string>(effectParams);
  const usedEffectVars = new Set<string>();
  const effCollector = new EffectParamCollector();
  for (const p of f.params) effCollector.visitType(p.type, usedEffectVars);
  effCollector.visitType(f.ret, usedEffectVars);

  // 同时扫描函数的 declaredEffects，收集其中引用的效应变量
  const funcDeclaredEffects = (f as unknown as { declaredEffects?: readonly unknown[] }).declaredEffects ?? [];
  for (const eff of funcDeclaredEffects) {
    if (typeof eff === 'object' && eff !== null && (eff as { kind?: string }).kind === 'EffectVar') {
      usedEffectVars.add((eff as { name: string }).name);
    }
  }

  for (const ev of usedEffectVars) {
    if (!declaredEffectVars.has(ev)) {
      diagnostics.error(ErrorCode.EFFECT_VAR_UNDECLARED, f.span, { func: f.name, var: ev });
    }
  }
  for (const ev of declaredEffectVars) {
    if (!usedEffectVars.has(ev)) {
      diagnostics.warning(ErrorCode.TYPE_PARAM_UNUSED, f.span, { name: ev, func: f.name });
    }
  }
}

class TypeParamCollector extends DefaultTypeVisitor<Set<string>> {
  override visitTypeVar(v: Core.TypeVar, ctx: Set<string>): void {
    ctx.add(v.name);
  }
}

class EffectParamCollector extends DefaultTypeVisitor<Set<string>> {
  override visitTypeVar(_v: Core.TypeVar, _ctx: Set<string>): void {}
  override visitEffectVar(ev: Core.EffectVar, ctx: Set<string>): void {
    // EffectVar 独立于 TypeVar，仍沿用首字母大写约定
    ctx.add(ev.name);
  }
  override visitFuncType(ft: Core.FuncType, ctx: Set<string>): void {
    // 收集函数类型中的 declaredEffects 引用
    if (Array.isArray(ft.declaredEffects)) {
      for (const eff of ft.declaredEffects) {
        const asText = String(eff);
        if (/^[A-Z][A-Za-z0-9_]*$/.test(asText)) ctx.add(asText);
      }
    }
    super.visitFuncType?.(ft, ctx);
  }
}

class UnknownTypeFinder extends DefaultTypeVisitor<{ unknowns: Set<string>; ctx: ModuleContext }> {
  // 包含所有内置标量类型和常用容器类型
  private static readonly KNOWN_SCALARS = new Set([
    'Text', 'Int', 'Bool', 'Float', 'Long', 'Double', 'Unit',
    'Result', 'Option', 'List', 'Map', 'Set', 'Workflow',
  ]);
  private static readonly isMaybeTypeVarLike = (name: string): boolean => /^[A-Z][A-Za-z0-9_]*$/.test(name);

  override visitTypeName(n: Core.TypeName, context: { unknowns: Set<string>; ctx: ModuleContext }): void {
    const nm = n.name;
    if (
      !UnknownTypeFinder.KNOWN_SCALARS.has(nm) &&
      !context.ctx.datas.has(nm) &&
      !context.ctx.enums.has(nm) &&
      UnknownTypeFinder.isMaybeTypeVarLike(nm)
    ) {
      context.unknowns.add(nm);
    }
  }
}
