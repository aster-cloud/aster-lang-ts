import type { Core } from '../types.js';
import { DefaultCoreVisitor } from '../core/visitor.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { ModuleContext, TypecheckWalkerContext } from './context.js';
import { assignSymbol, defineSymbol } from './context.js';
import { originToSpan } from './pure.js';
import { SymbolTable } from './symbol_table.js';
import type { DiagnosticBuilder } from './diagnostics.js';
import {
  formatType,
  isUnknown,
  typesEqual,
  unknownType,
} from './pure.js';
import { rejectVerdictInBoolContext, typeOfExpr } from './expression.js';
import { bindPattern } from './pattern.js';
import { typecheckWorkflow } from './workflow.js';

export class TypecheckVisitor extends DefaultCoreVisitor<TypecheckWalkerContext> {
  public result: Core.Type = unknownType();

  override visitBlock(block: Core.Block, context: TypecheckWalkerContext): void {
    let last: Core.Type = unknownType();
    for (const statement of block.statements) {
      this.visitStatement(statement, context);
      last = this.result;
    }
    this.result = last;
  }

  override visitStatement(statement: Core.Statement, context: TypecheckWalkerContext): void {
    const { module, symbols, diagnostics } = context;
    switch (statement.kind) {
      case 'Let': {
        const valueType = typeOfExpr(module, symbols, statement.expr, diagnostics);
        // 降级后的 Let 节点只带 origin（无 span）：用 origin 定位，否则 E104 诊断没有行列，编辑器无法标红。
        defineSymbol(context, statement.name, valueType, 'var', statement.span ?? originToSpan(statement.origin));
        this.result = valueType;
        return;
      }
      case 'Set': {
        const valueType = typeOfExpr(module, symbols, statement.expr, diagnostics);
        assignSymbol(context, statement.name, valueType, statement.span ?? originToSpan(statement.origin));
        this.result = valueType;
        return;
      }
      case 'Return': {
        this.result = typeOfExpr(module, symbols, statement.expr, diagnostics);
        return;
      }
      case 'If': {
        rejectVerdictInBoolContext(
          typeOfExpr(module, symbols, statement.cond, diagnostics),
          statement.span,
          diagnostics,
        );
        const thenType = typecheckBlock(module, symbols, statement.thenBlock, diagnostics);
        const elseType = statement.elseBlock
          ? typecheckBlock(module, symbols, statement.elseBlock, diagnostics)
          : unknownType();
        if (isUnknown(thenType)) {
          this.result = elseType;
        } else if (isUnknown(elseType)) {
          this.result = thenType;
        } else {
          if (!typesEqual(thenType, elseType)) {
            diagnostics.error(ErrorCode.IF_BRANCH_MISMATCH, statement.span, {
              thenType: formatType(thenType),
              elseType: formatType(elseType),
            });
          }
          this.result = thenType;
        }
        return;
      }
      case 'Match': {
        const scrutineeType = typeOfExpr(module, symbols, statement.expr, diagnostics);
        let aggregated: Core.Type | null = null;
        let hasNullCase = false;
        let hasNonNullCase = false;
        const enumDecl =
          !isUnknown(scrutineeType) && scrutineeType.kind === 'TypeName'
            ? module.enums.get(scrutineeType.name)
            : undefined;
        const seenEnum = new Set<string>();
        let hasWildcard = false;
        for (const caseClause of statement.cases) {
          const caseType = typecheckCase(module, symbols, caseClause, scrutineeType, diagnostics);
          if (!aggregated) {
            aggregated = caseType;
          } else if (!typesEqual(aggregated, caseType)) {
            diagnostics.error(
              ErrorCode.MATCH_BRANCH_MISMATCH,
              caseClause.body.span ?? statement.span,
              {
                expected: formatType(aggregated),
                actual: formatType(caseType),
              }
            );
          }
          if (caseClause.pattern.kind === 'PatNull') hasNullCase = true;
          else hasNonNullCase = true;
          if (enumDecl) {
            if (caseClause.pattern.kind === 'PatName') {
              if (enumDecl.variants.includes(caseClause.pattern.name)) {
                if (seenEnum.has(caseClause.pattern.name)) {
                  diagnostics.warning(
                    ErrorCode.DUPLICATE_ENUM_CASE,
                    caseClause.pattern.span ?? statement.span,
                    { case: caseClause.pattern.name, type: enumDecl.name }
                  );
                }
                seenEnum.add(caseClause.pattern.name);
              } else {
                hasWildcard = true;
              }
            } else if (caseClause.pattern.kind === 'PatCtor') {
              if (enumDecl.variants.includes(caseClause.pattern.typeName)) {
                if (seenEnum.has(caseClause.pattern.typeName)) {
                  diagnostics.warning(
                    ErrorCode.DUPLICATE_ENUM_CASE,
                    caseClause.pattern.span ?? statement.span,
                    { case: caseClause.pattern.typeName, type: enumDecl.name }
                  );
                }
                seenEnum.add(caseClause.pattern.typeName);
              }
            } else {
              hasWildcard = true;
            }
          }
        }
        if (!isUnknown(scrutineeType) && scrutineeType.kind === 'Maybe') {
          if (!(hasNullCase && hasNonNullCase)) {
            const missing = hasNullCase ? 'non-null value' : hasNonNullCase ? 'null' : 'null and non-null';
            diagnostics.warning(ErrorCode.NON_EXHAUSTIVE_MAYBE, statement.span, { missing });
          }
        } else if (enumDecl && !hasWildcard) {
          const missing = enumDecl.variants.filter(variant => !seenEnum.has(variant));
          if (missing.length > 0) {
            diagnostics.warning(ErrorCode.NON_EXHAUSTIVE_ENUM, statement.span, {
              type: enumDecl.name,
              missing: missing.join(', '),
            });
          }
        }
        this.result = aggregated ?? unknownType();
        return;
      }
      case 'Scope': {
        const nested: Core.Block = {
          kind: 'Block',
          statements: statement.statements,
          span: statement.span,
        } as Core.Block;
        this.result = typecheckScopedBlock(module, symbols, nested, diagnostics);
        return;
      }
      case 'Start': {
        void typeOfExpr(module, symbols, statement.expr, diagnostics);
        this.result = unknownType();
        return;
      }
      case 'Wait': {
        this.result = unknownType();
        return;
      }
      case 'workflow': {
        this.result = typecheckWorkflow(context, statement as Core.Workflow);
        return;
      }
    }
  }
}

/**
 * 在**当前**作用域检查语句块，不另开作用域。
 *
 * 与 Java 端 BaseTypeChecker.checkBlock 对齐：If 分支、函数体、workflow step 都与外层共享作用域，
 * 因此在分支里 `Let` 一个外层已有的名字、或 `Let` 一个与形参同名的变量，都报 E104 DUPLICATE_SYMBOL。
 * 只有 Scope 语句、match 分支与 lambda 才开新作用域（见 typecheckScopedBlock / typecheckCase）。
 * 两端规则不一致时，编辑器会对服务端保存门禁拒绝的源码显示「可编译」（aster-lang-ts#231）。
 */
export function typecheckBlock(
  ctx: ModuleContext,
  symbols: SymbolTable,
  block: Core.Block,
  diagnostics: DiagnosticBuilder
): Core.Type {
  const visitor = new TypecheckVisitor();
  visitor.visitBlock(block, { module: ctx, symbols, diagnostics });
  return visitor.result;
}

/** 在新的块作用域里检查语句块：用于显式的 Scope 语句（对应 Java 端 CoreModel.Scope 分支）。 */
export function typecheckScopedBlock(
  ctx: ModuleContext,
  symbols: SymbolTable,
  block: Core.Block,
  diagnostics: DiagnosticBuilder
): Core.Type {
  symbols.enterScope('block');
  try {
    return typecheckBlock(ctx, symbols, block, diagnostics);
  } finally {
    symbols.exitScope();
  }
}

export function typecheckCase(
  ctx: ModuleContext,
  symbols: SymbolTable,
  caseClause: Core.Case,
  scrutineeType: Core.Type,
  diagnostics: DiagnosticBuilder
): Core.Type {
  symbols.enterScope('block');
  try {
    bindPattern(ctx, symbols, caseClause.pattern, scrutineeType, diagnostics);
    if (caseClause.body.kind === 'Return') {
      return typeOfExpr(ctx, symbols, caseClause.body.expr, diagnostics);
    }
    return typecheckBlock(ctx, symbols, caseClause.body, diagnostics);
  } finally {
    symbols.exitScope();
  }
}
