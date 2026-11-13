import type { Core, Span, Ty } from '../types.js';
import { originToSpan } from './pure.js';
import { DefaultTypeVisitor } from '../ast/ast_visitor.js';
import { DiagnosticBuilder } from './diagnostics.js';
import type { ModuleContext } from './context.js';
import { TypeSystem } from './type_system.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { formatType, typesEqual } from './pure.js';
import { VERDICT_TYPE_NAME } from './verdict_signatures.js';

export function unifyTypeParameters(
  expected: Ty.Type,
  actual: Ty.Type,
  bindings: Map<string, Ty.Type>,
  diagnostics: DiagnosticBuilder,
  span: Span | undefined
): void {
  const inferred = new Map<string, Ty.Type>();
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
      diagnostics.error(ErrorCode.TYPE_VAR_UNDECLARED, originToSpan(f.origin), {
        name: u,
        func: f.name,
      });
    }
  }

  // 检查未使用的类型参数
  for (const tv of declared) {
    if (!used.has(tv)) {
      diagnostics.warning(ErrorCode.TYPE_PARAM_UNUSED, originToSpan(f.origin), {
        name: tv,
        func: f.name,
      });
    }
  }

  // 不再按「首字母大写的未知类型名」猜测类型变量（E006）：Core 不含类型别名声明，签名里的别名名会被误报；
  // 未声明的类型名在名称解析阶段已报 E800，Java 亦不报 E006（aster-lang-ts#281）。

  // 效应类型参数声明与使用校验
  const declaredEffectVars = new Set<string>(f.effectParams);
  // ADR 0055 #5：效应参数名不得与保留效应名（io、cpu、pure、async，ASCII 大小写不敏感）相同（E213）
  for (const name of f.effectParams) {
    if (RESERVED_EFFECT_NAMES.has(asciiLower(name))) {
      diagnostics.error(ErrorCode.EFFECT_PARAM_SHADOWS_BUILTIN, originToSpan(f.origin), { name, func: f.name });
    }
  }
  const usedEffectVars = new Set<string>();
  const effCollector = new EffectParamCollector();
  for (const p of f.params) effCollector.visitType(p.type, usedEffectVars);
  effCollector.visitType(f.ret, usedEffectVars);

  // v2 的 effects 只含 io / cpu 与效应变量（ADR 0055 #5）：其余条目都是对效应变量的使用，
  // 未在 effectParams 中声明的由下方报 E210（对应 IR 不变式 undeclared-effect-var）
  for (const eff of f.effects) {
    if (eff !== 'io' && eff !== 'cpu') usedEffectVars.add(eff);
  }

  for (const ev of usedEffectVars) {
    if (!declaredEffectVars.has(ev)) {
      diagnostics.error(ErrorCode.EFFECT_VAR_UNDECLARED, originToSpan(f.origin), { func: f.name, var: ev });
    }
  }
  for (const ev of declaredEffectVars) {
    if (!usedEffectVars.has(ev)) {
      diagnostics.warning(ErrorCode.TYPE_PARAM_UNUSED, originToSpan(f.origin), { name: ev, func: f.name });
    }
  }
}

/** 保留效应名（schema `$defs/ReservedEffectName`）。 */
const RESERVED_EFFECT_NAMES: ReadonlySet<string> = new Set(['io', 'cpu', 'pure', 'async']);

/** ASCII 大小写不敏感比较用的小写化（保留效应名都是 ASCII）。 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

class TypeParamCollector extends DefaultTypeVisitor<Set<string>> {
  override visitTypeVar(v: Ty.TypeVar, ctx: Set<string>): void {
    ctx.add(v.name);
  }
}

class EffectParamCollector extends DefaultTypeVisitor<Set<string>> {
  override visitTypeVar(_v: Ty.TypeVar, _ctx: Set<string>): void {}
  override visitEffectVar(ev: Ty.EffectVar, ctx: Set<string>): void {
    // EffectVar 独立于 TypeVar，仍沿用首字母大写约定
    ctx.add(ev.name);
  }
  override visitFuncType(ft: Ty.FuncType, ctx: Set<string>): void {
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

/**
 * 内置类型名：全部内置标量类型和常用容器类型。类型检查据此判定疑似类型变量，
 * 名称解析 R1（ADR 0051）据此判定类型位置是否未解析。
 */
export const BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set([
  'Text', 'Int', 'Bool', 'Float', 'Long', 'Double', 'Unit',
  // ADR 0025：Decimal 为内置标量
  'Decimal',
  // 与 PrimitiveTypeName（types/type-inference.ts）对齐：DateTime 为内置基础类型
  'DateTime',
  'Result', 'Option', 'List', 'Map', 'Set', 'Workflow',
  // ADR 0039：Verdict 为内置类型，不是疑似类型变量
  VERDICT_TYPE_NAME,
]);

