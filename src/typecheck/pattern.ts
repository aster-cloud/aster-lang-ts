import type { Core } from '../types.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { ModuleContext } from './context.js';
import { defineSymbol } from './context.js';
import { SymbolTable } from './symbol_table.js';
import type { DiagnosticBuilder } from './diagnostics.js';
import { formatType, isUnknown, unknownType } from './utils.js';

export function bindPattern(
  ctx: ModuleContext,
  symbols: SymbolTable,
  pattern: Core.Pattern,
  scrutineeType: Core.Type,
  diagnostics: DiagnosticBuilder
): void {
  if (pattern.kind === 'PatName') {
    defineSymbol({ module: ctx, symbols, diagnostics }, pattern.name, scrutineeType, 'var', pattern.span);
    return;
  }
  if (pattern.kind === 'PatNull') return;
  if (pattern.kind === 'PatInt') {
    const isInt =
      !isUnknown(scrutineeType) &&
      scrutineeType.kind === 'TypeName' &&
      scrutineeType.name === 'Int';
    if (!isInt) {
      diagnostics.error(ErrorCode.INTEGER_PATTERN_TYPE, pattern.span, {
        scrutineeType: formatType(scrutineeType),
      });
    }
    return;
  }
  if (pattern.kind !== 'PatCtor') return;
  bindPatternCtor(ctx, symbols, pattern, scrutineeType, diagnostics);
}

function bindPatternCtor(
  ctx: ModuleContext,
  symbols: SymbolTable,
  pattern: Core.PatCtor,
  scrutineeType: Core.Type,
  diagnostics: DiagnosticBuilder
): void {
  if (pattern.typeName === 'Ok' && !isUnknown(scrutineeType) && scrutineeType.kind === 'Result') {
    const inner = (scrutineeType as Core.Result).ok as Core.Type;
    const ctor = pattern as Core.PatCtor & { args?: readonly Core.Pattern[] };
    const child =
      ctor.args && ctor.args.length > 0
        ? (ctor.args[0] as Core.Pattern)
        : pattern.names && pattern.names[0]
          ? ({ kind: 'PatName', name: pattern.names[0] } as Core.PatName)
          : null;
    if (child) bindPattern(ctx, symbols, child, inner, diagnostics);
    return;
  }
  if (pattern.typeName === 'Err' && !isUnknown(scrutineeType) && scrutineeType.kind === 'Result') {
    const inner = (scrutineeType as Core.Result).err as Core.Type;
    const ctor = pattern as Core.PatCtor & { args?: readonly Core.Pattern[] };
    const child =
      ctor.args && ctor.args.length > 0
        ? (ctor.args[0] as Core.Pattern)
        : pattern.names && pattern.names[0]
          ? ({ kind: 'PatName', name: pattern.names[0] } as Core.PatName)
          : null;
    if (child) bindPattern(ctx, symbols, child, inner, diagnostics);
    return;
  }
  const dataDecl = ctx.datas.get(pattern.typeName);
  if (!dataDecl) {
    if (pattern.names) {
      for (const name of pattern.names) {
        defineSymbol({ module: ctx, symbols, diagnostics }, name, unknownType(), 'var', pattern.span);
      }
    }
    const ctor = pattern as Core.PatCtor & { args?: readonly Core.Pattern[] };
    if (ctor.args) {
      for (const arg of ctor.args as readonly Core.Pattern[]) {
        bindPattern(ctx, symbols, arg, unknownType(), diagnostics);
      }
    }
    return;
  }
  const arity = dataDecl.fields.length;
  const ctor = pattern as Core.PatCtor & { args?: readonly Core.Pattern[] };
  const args: readonly Core.Pattern[] = ctor.args ? (ctor.args as readonly Core.Pattern[]) : [];
  for (let i = 0; i < arity; i++) {
    const fieldType = dataDecl.fields[i]!.type as Core.Type;
    const child =
      i < args.length
        ? args[i]!
        : pattern.names && i < pattern.names.length
          ? ({ kind: 'PatName', name: pattern.names[i]! } as Core.PatName)
          : null;
    if (!child) continue;
    bindPattern(ctx, symbols, child, fieldType, diagnostics);
  }
}
