import type { Core, Ty } from '../types.js';
import { originToSpan } from './pure.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { ModuleContext } from './context.js';
import { defineSymbol } from './context.js';
import { SymbolTable } from './symbol_table.js';
import type { DiagnosticBuilder } from './diagnostics.js';
import { formatType, isNameInferredType, isUnknown, unknownType } from './pure.js';

export function bindPattern(
  ctx: ModuleContext,
  symbols: SymbolTable,
  pattern: Core.Pattern,
  scrutineeType: Ty.Type,
  diagnostics: DiagnosticBuilder
): void {
  if (pattern.kind === 'PatName') {
    defineSymbol({ module: ctx, symbols, diagnostics }, pattern.name, scrutineeType, 'pattern', originToSpan(pattern.origin));
    return;
  }
  if (pattern.kind === 'PatNull') return;
  if (pattern.kind === 'PatInt') {
    // 未知或只按名字推断的 scrutinee 拿不准类型，放行（TS 不比 Java 严，aster-lang-ts#281）
    if (isUnknown(scrutineeType) || isNameInferredType(scrutineeType)) return;
    const isInt = scrutineeType.kind === 'TypeName' && scrutineeType.name === 'Int';
    if (!isInt) {
      diagnostics.error(ErrorCode.INTEGER_PATTERN_TYPE, originToSpan(pattern.origin), {
        scrutineeType: formatType(scrutineeType),
      });
    }
    return;
  }
  if (pattern.kind !== 'PatCtor') return;
  bindPatternCtor(ctx, symbols, pattern, scrutineeType, diagnostics);
}

/** 构造器模式（ADR 0055 #15）：绑定全部在 args 中，按位置对应 Ok / Err 的内层类型或 Data 的字段类型。 */
function bindPatternCtor(
  ctx: ModuleContext,
  symbols: SymbolTable,
  pattern: Core.PatCtor,
  scrutineeType: Ty.Type,
  diagnostics: DiagnosticBuilder
): void {
  const result = !isUnknown(scrutineeType) && scrutineeType.kind === 'Result' ? scrutineeType : undefined;
  if (result && (pattern.typeName === 'Ok' || pattern.typeName === 'Err')) {
    const child = pattern.args[0];
    if (child) bindPattern(ctx, symbols, child, pattern.typeName === 'Ok' ? result.ok : result.err, diagnostics);
    return;
  }
  const dataDecl = ctx.datas.get(pattern.typeName);
  if (!dataDecl) {
    for (const arg of pattern.args) bindPattern(ctx, symbols, arg, unknownType(), diagnostics);
    return;
  }
  const arity = Math.min(dataDecl.fields.length, pattern.args.length);
  for (let i = 0; i < arity; i++) {
    bindPattern(ctx, symbols, pattern.args[i]!, dataDecl.fields[i]!.type, diagnostics);
  }
}
