import type { Core } from '../types.js';
import { DefaultCoreVisitor } from '../core/visitor.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { TypeSystem } from './type_system.js';
import type { ModuleContext, TypecheckWalkerContext } from './context.js';
import type { DiagnosticBuilder } from './diagnostics.js';
import { SymbolTable } from './symbol_table.js';
import {
  formatType,
  isAssignable,
  isUnknown,
  normalizeType,
  originToSpan,
  unknownType,
} from './pure.js';

export class TypeOfExprVisitor extends DefaultCoreVisitor<TypecheckWalkerContext> {
  public handled = false;
  public result: Core.Type = unknownType();

  override visitExpression(expression: Core.Expression, context: TypecheckWalkerContext): void {
    const { module, symbols, diagnostics } = context;
    switch (expression.kind) {
      case 'Name': {
        if (expression.name.includes('.')) {
          const parts = expression.name.split('.');
          const baseName = parts[0]!;
          const fieldPath = parts.slice(1);
          const baseSymbol = symbols.lookup(baseName);
          if (!baseSymbol) {
            diagnostics.undefinedVariable(baseName, originToSpan(expression.origin));
            this.result = unknownType();
            this.handled = true;
            return;
          }
          let currentType = baseSymbol.type;
          for (const fieldName of fieldPath) {
            const expanded = TypeSystem.expand(currentType, symbols.getTypeAliases());
            if (expanded.kind === 'TypeName') {
              const dataDecl = module.datas.get(expanded.name);
              const resolvedDataDecl =
                dataDecl ?? inferDataDeclFromField(module, baseName, fieldName);
              if (!resolvedDataDecl) {
                diagnostics.error(ErrorCode.UNKNOWN_FIELD, originToSpan(expression.origin), {
                  field: fieldName,
                  type: formatType(currentType),
                });
                this.result = unknownType();
                this.handled = true;
                return;
              }
              const field = resolvedDataDecl.fields.find(item => item.name === fieldName);
              if (!field) {
                diagnostics.error(ErrorCode.UNKNOWN_FIELD, originToSpan(expression.origin), {
                  field: fieldName,
                  type: resolvedDataDecl.name,
                });
                this.result = unknownType();
                this.handled = true;
                return;
              }
              currentType = field.type as Core.Type;
            } else {
              diagnostics.error(ErrorCode.UNKNOWN_FIELD, originToSpan(expression.origin), {
                field: fieldName,
                type: formatType(currentType),
              });
              this.result = unknownType();
              this.handled = true;
              return;
            }
          }
          this.result = currentType;
          this.handled = true;
          return;
        }

        const symbol = symbols.lookup(expression.name);
        if (symbol) {
          this.result = symbol.type;
        } else {
          let matched: Core.Enum | undefined;
          for (const en of module.enums.values()) {
            if (en.variants.includes(expression.name)) {
              matched = en;
              break;
            }
          }
          if (matched) {
            this.result = { kind: 'TypeName', name: matched.name } as Core.TypeName;
          } else {
            diagnostics.undefinedVariable(expression.name, originToSpan(expression.origin));
            this.result = unknownType();
          }
        }
        this.handled = true;
        return;
      }
      case 'Bool':
        this.result = { kind: 'TypeName', name: 'Bool' } as Core.TypeName;
        this.handled = true;
        return;
      case 'Int':
        this.result = { kind: 'TypeName', name: 'Int' } as Core.TypeName;
        this.handled = true;
        return;
      case 'Long':
        this.result = { kind: 'TypeName', name: 'Long' } as Core.TypeName;
        this.handled = true;
        return;
      case 'Double':
        this.result = { kind: 'TypeName', name: 'Double' } as Core.TypeName;
        this.handled = true;
        return;
      case 'Decimal':
        // Decimal 一等公民（ADR 0025）：m 后缀字面量的静态类型。
        this.result = { kind: 'TypeName', name: 'Decimal' } as Core.TypeName;
        this.handled = true;
        return;
      case 'String':
        this.result = { kind: 'TypeName', name: 'Text' } as Core.TypeName;
        this.handled = true;
        return;
      case 'Null':
        this.result = { kind: 'Maybe', type: unknownType() } as Core.Maybe;
        this.handled = true;
        return;
      case 'Ok': {
        const inner = typeOfExpr(module, symbols, expression.expr, diagnostics);
        this.result = {
          kind: 'Result',
          ok: isUnknown(inner) ? unknownType() : inner,
          err: unknownType(),
        } as Core.Result;
        this.handled = true;
        return;
      }
      case 'Err': {
        const inner = typeOfExpr(module, symbols, expression.expr, diagnostics);
        this.result = {
          kind: 'Result',
          ok: unknownType(),
          err: isUnknown(inner) ? unknownType() : inner,
        } as Core.Result;
        this.handled = true;
        return;
      }
      case 'Some': {
        const inner = typeOfExpr(module, symbols, expression.expr, diagnostics);
        this.result = {
          kind: 'Option',
          type: isUnknown(inner) ? unknownType() : inner,
        } as Core.Option;
        this.handled = true;
        return;
      }
      case 'None':
        this.result = { kind: 'Option', type: unknownType() } as Core.Option;
        this.handled = true;
        return;
      case 'Construct': {
        const dataDecl = module.datas.get(expression.typeName);
        if (!dataDecl) {
          this.result = unknownType();
          this.handled = true;
          return;
        }
        const provided = new Set<string>();
        for (const field of expression.fields) {
          provided.add(field.name);
          const schemaField = dataDecl.fields.find(item => item.name === field.name);
          if (!schemaField) {
            diagnostics.error(ErrorCode.UNKNOWN_FIELD, originToSpan(expression.origin), {
              field: field.name,
              type: dataDecl.name,
            });
            continue;
          }
          const valueType = typeOfExpr(module, symbols, field.expr, diagnostics);
          // 使用 isAssignable 支持数值类型隐式提升（Int → Float 等）
          if (!isAssignable(schemaField.type as Core.Type, valueType)) {
            diagnostics.error(ErrorCode.FIELD_TYPE_MISMATCH, originToSpan(field.expr.origin) ?? originToSpan(expression.origin), {
              field: field.name,
              expected: formatType(schemaField.type as Core.Type),
              actual: formatType(valueType),
            });
          }
        }
        for (const field of dataDecl.fields) {
          if (!provided.has(field.name)) {
            diagnostics.error(ErrorCode.MISSING_REQUIRED_FIELD, originToSpan(expression.origin), {
              type: dataDecl.name,
              field: field.name,
            });
          }
        }
        this.result = { kind: 'TypeName', name: expression.typeName } as Core.TypeName;
        this.handled = true;
        return;
      }
      case 'Await': {
        const awaited = typeOfExpr(module, symbols, expression.expr, diagnostics);
        if (!isUnknown(awaited) && awaited.kind === 'Maybe') {
          this.result = awaited.type as Core.Type;
        } else if (!isUnknown(awaited) && awaited.kind === 'Result') {
          this.result = awaited.ok as Core.Type;
        } else {
          diagnostics.warning(ErrorCode.AWAIT_TYPE, originToSpan(expression.origin), { type: formatType(awaited) });
          this.result = unknownType();
        }
        this.handled = true;
        return;
      }
      case 'Lambda': {
        const params = expression.params.map(param => normalizeType(param.type as Core.Type)) as readonly Core.Type[];
        const funcType: Core.FuncType = {
          kind: 'FuncType',
          params,
          ret: normalizeType(expression.ret as Core.Type),
          effectParams: [],
          declaredEffects: [],
        };
        this.result = funcType;
        this.handled = true;
        return;
      }
      case 'IfExpr': {
        // ADR 0019 G2b：表达式级 if 的类型 = then 分支类型（两分支类型一致性由
        // Java 引擎 typecheck + 双引擎 parity 把守；TS typechecker 取 then 作代表）。
        // 仍递归 cond/else 以触发其中的子表达式类型检查。
        typeOfExpr(module, symbols, expression.cond, diagnostics);
        const thenType = typeOfExpr(module, symbols, expression.thenE, diagnostics);
        typeOfExpr(module, symbols, expression.elseE, diagnostics);
        this.result = thenType;
        this.handled = true;
        return;
      }
      case 'Call': {
        if (expression.target.kind === 'Name' && expression.target.name === 'not') {
          if (expression.args.length !== 1) {
            diagnostics.error(ErrorCode.NOT_CALL_ARITY, originToSpan(expression.origin) ?? originToSpan(expression.target.origin), {});
          } else {
            void typeOfExpr(module, symbols, expression.args[0]!, diagnostics);
          }
          this.result = { kind: 'TypeName', name: 'Bool' } as Core.TypeName;
          this.handled = true;
          return;
        }

        for (const arg of expression.args) {
          void typeOfExpr(module, symbols, arg, diagnostics);
        }

        // Decimal↔Double 混算编译期拦截（ADR 0025）。runtime 只能 catch 非整数 Double
        // （2.5），整数值 Double（2.0）与 Int（2）在 JS number 不可分——必须靠编译期 AST
        // 节点 kind（Double vs Decimal）区分。Codex 审查 P0：不止算术 +/-/*///%，还须覆盖
        // **比较运算符** == != < <= > >=（lower 为 Call{Name op}）——`1.0m equals to 1.0`
        // TS runtime 当 Int 提升=true，Truffle 区分 Double 抛错 → 双引擎分歧。Int/Long↔Decimal
        // 精确提升放行。
        const named = (t: Core.Type, n: string): boolean => t.kind === 'TypeName' && t.name === n;
        const isDec = (t: Core.Type): boolean => named(t, 'Decimal');
        const isDbl = (t: Core.Type): boolean => named(t, 'Double');
        const isIntLong = (t: Core.Type): boolean => named(t, 'Int') || named(t, 'Long');
        const ARITH_OPS = ['+', '-', '*', '/', '//', '%'];
        const COMPARE_OPS = ['==', '!=', '<', '<=', '>', '>='];
        if (
          expression.target.kind === 'Name' &&
          (ARITH_OPS.includes(expression.target.name) || COMPARE_OPS.includes(expression.target.name)) &&
          expression.args.length === 2
        ) {
          const op = expression.target.name;
          const lhs = typeOfExpr(module, symbols, expression.args[0]!, diagnostics);
          const rhs = typeOfExpr(module, symbols, expression.args[1]!, diagnostics);
          if ((isDec(lhs) && isDbl(rhs)) || (isDbl(lhs) && isDec(rhs))) {
            diagnostics.error(
              ErrorCode.DECIMAL_DOUBLE_MIXING,
              originToSpan(expression.origin) ?? originToSpan(expression.target.origin),
              { operator: op },
            );
          }
          // 传播算术结果类型（与 type_system.ts promoteNumericTypes 对齐 + Decimal 扩展），
          // 使嵌套算术（如 `(a times b) plus 2.5m`）的 Decimal-ness 能继续被上层检查到。
          // 仅算术运算符返回操作数类型；比较运算符返回 Bool（不在此设 result，走后续默认）。
          if (
            ARITH_OPS.includes(op) &&
            (isDec(lhs) || isDec(rhs)) && (isDec(lhs) || isIntLong(lhs)) && (isDec(rhs) || isIntLong(rhs))
          ) {
            this.result = { kind: 'TypeName', name: 'Decimal' } as Core.TypeName;
            this.handled = true;
            return;
          }
        }

        // Codex 审查 P0：Decimal.round(x,…) / Decimal.divide(x,y,…) 的 Decimal 操作数位（x、y）
        // 不得是 Double——`Decimal.divide(1m, 2.0, …)` TS runtime 当 Int 提升、Truffle 拒 = 分歧。
        // scale/mode 位（Int/Text）不在此检查。
        if (expression.target.kind === 'Name' &&
            (expression.target.name === 'Decimal.round' || expression.target.name === 'Decimal.divide')) {
          const decimalArgCount = expression.target.name === 'Decimal.divide' ? 2 : 1;
          for (let i = 0; i < Math.min(decimalArgCount, expression.args.length); i++) {
            const at = typeOfExpr(module, symbols, expression.args[i]!, diagnostics);
            if (isDbl(at)) {
              diagnostics.error(
                ErrorCode.DECIMAL_DOUBLE_MIXING,
                originToSpan(expression.args[i]!.origin) ?? originToSpan(expression.origin),
                { operator: expression.target.name },
              );
            }
          }
        }

        if (expression.target.kind === 'Name' && expression.target.name.includes('.')) {
          let hasInt = false;
          let hasLong = false;
          let hasDouble = false;
          for (const arg of expression.args) {
            switch (arg.kind) {
              case 'Int':
                hasInt = true;
                break;
              case 'Long':
                hasLong = true;
                break;
              case 'Double':
                hasDouble = true;
                break;
            }
          }
          const kindCount = (hasInt ? 1 : 0) + (hasLong ? 1 : 0) + (hasDouble ? 1 : 0);
          if (kindCount > 1) {
            diagnostics.warning(ErrorCode.AMBIGUOUS_INTEROP_NUMERIC, originToSpan(expression.origin) ?? originToSpan(expression.target.origin), {
              target: expression.target.name,
              hasInt,
              hasLong,
              hasDouble,
            });
          }
        }

        if (expression.target.kind === 'Name' && expression.target.name === 'await' && expression.args.length === 1) {
          const awaitedType = typeOfExpr(module, symbols, expression.args[0]!, diagnostics);
          if (!isUnknown(awaitedType) && awaitedType.kind === 'Maybe') {
            this.result = awaitedType.type as Core.Type;
          } else if (!isUnknown(awaitedType) && awaitedType.kind === 'Result') {
            this.result = awaitedType.ok as Core.Type;
          } else {
            diagnostics.warning(ErrorCode.AWAIT_TYPE, originToSpan(expression.origin), { type: formatType(awaitedType) });
            this.result = unknownType();
          }
          this.handled = true;
          return;
        }

        if (expression.target.kind === 'Name') {
          // Decimal.* 精确舍入/除法返回 Decimal（ADR 0025 M2），使嵌套混算检查也能看到 Decimal。
          if (expression.target.name === 'Decimal.round' || expression.target.name === 'Decimal.divide') {
            this.result = { kind: 'TypeName', name: 'Decimal' } as Core.TypeName;
            this.handled = true;
            return;
          }
          const signature = module.funcSignatures.get(expression.target.name);
          if (signature) {
            this.result = signature.ret;
            this.handled = true;
            return;
          }
        }

        this.result = unknownType();
        this.handled = true;
        return;
      }
      default:
        break;
    }
  }
}

function inferDataDeclFromField(
  module: ModuleContext,
  baseName: string,
  fieldName: string
): Core.Data | null {
  const matches: Core.Data[] = [];
  for (const dataDecl of module.datas.values()) {
    if (dataDecl.fields.some(field => field.name === fieldName)) {
      matches.push(dataDecl);
    }
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;
  const loweredBase = baseName.toLowerCase().replace(/[_-]/g, '');
  const narrowed = matches.filter(item => item.name.toLowerCase().includes(loweredBase));
  if (narrowed.length === 1) return narrowed[0]!;
  return null;
}

export function typeOfExpr(
  ctx: ModuleContext,
  symbols: SymbolTable,
  expr: Core.Expression,
  diagnostics: DiagnosticBuilder
): Core.Type {
  const visitor = new TypeOfExprVisitor();
  visitor.visitExpression(expr, { module: ctx, symbols, diagnostics });
  return visitor.result;
}
