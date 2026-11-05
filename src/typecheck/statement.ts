import type { Core, Span } from '../types.js';
import { DefaultCoreVisitor } from '../core/visitor.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { ModuleContext, TypecheckWalkerContext } from './context.js';
import { assignSymbol, defineSymbol } from './context.js';
import { originToSpan } from './pure.js';
import { SymbolTable } from './symbol_table.js';
import type { DiagnosticBuilder } from './diagnostics.js';
import {
  argumentFits,
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
        // `Let y be amount`：按名字推断的标记随 Let 传播，y 同样不作为调用约束
        const inferred = statement.expr.kind === 'Name' && symbols.lookup(statement.expr.name)?.typeInferred === true;
        defineSymbol(context, statement.name, valueType, 'var', statement.span ?? originToSpan(statement.origin), inferred);
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
        checkReturnAgainstDeclared(this.result, statement.span ?? originToSpan(statement.origin), diagnostics);
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
            diagnostics.error(ErrorCode.IF_BRANCH_MISMATCH, statement.span ?? originToSpan(statement.origin), {
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
      const type = typeOfExpr(ctx, symbols, caseClause.body.expr, diagnostics);
      checkReturnAgainstDeclared(
        type,
        caseClause.body.span ?? originToSpan(caseClause.body.origin) ?? caseClause.span ?? originToSpan(caseClause.origin),
        diagnostics,
      );
      return type;
    }
    return typecheckBlock(ctx, symbols, caseClause.body, diagnostics);
  } finally {
    symbols.exitScope();
  }
}

/**
 * 当前正在检查的函数的声明返回类型（栈顶）。null 表示不检查：返回类型按名推断，或处于 lambda 体内
 * （lambda 的 Return 属于 lambda，由 lambda 自己的返回类型检查负责）。
 */
interface ReturnExpectation {
  declared: Core.Type;
  /** 是否已有某条 Return 报过 E003：函数级的兜底比较据此去重 */
  reported: boolean;
}
const returnExpectations: (ReturnExpectation | null)[] = [];

/**
 * 每条 Return 语句都与声明返回类型比较（aster-lang-ts#283）：任意嵌套 If、Match 分支、workflow step
 * 里的提前 Return 都是函数可能的返回路径，不能只看函数体块的最后一个结果类型。
 * 比较用可赋值规则（Unknown、按名推断、数值拓宽放行），E003 落在该 Return 的位置。
 */
function checkReturnAgainstDeclared(actual: Core.Type, span: Span | undefined, diagnostics: DiagnosticBuilder): void {
  const expectation = returnExpectations[returnExpectations.length - 1];
  if (!expectation || argumentFits(expectation.declared, actual)) return;
  expectation.reported = true;
  diagnostics.error(ErrorCode.RETURN_TYPE_MISMATCH, span, {
    expected: formatType(expectation.declared),
    actual: formatType(actual),
  });
}

/** 在不检查 Return 的上下文中执行（lambda 体）：其 Return 不与外层函数的声明类型比较。 */
export function withoutReturnExpectation<T>(run: () => T): T {
  returnExpectations.push(null);
  try {
    return run();
  } finally {
    returnExpectations.pop();
  }
}

/**
 * 检查函数体并比较返回类型：逐条 Return 比较（见 checkReturnAgainstDeclared）；
 * 若没有任何 Return 报错，仍对块的结果类型做一次兜底比较（如末尾不是 Return 的函数体），
 * span 取函数体最后一条语句，避免落到第 1 行。返回块结果类型，供泛型参数统一使用。
 */
export function typecheckFunctionBody(
  ctx: ModuleContext,
  symbols: SymbolTable,
  f: Core.Func,
  declaredReturn: Core.Type,
  retTypeInferred: boolean,
  diagnostics: DiagnosticBuilder,
): Core.Type {
  if (!f.body) return unknownType();
  const expectation: ReturnExpectation | null = retTypeInferred ? null : { declared: declaredReturn, reported: false };
  returnExpectations.push(expectation);
  let bodyReturn: Core.Type;
  try {
    bodyReturn = typecheckBlock(ctx, symbols, f.body, diagnostics);
  } finally {
    returnExpectations.pop();
  }
  // Return 与实参同一套可赋值规则：数值拓宽、T → T?、None → T? 放行，收窄仍报错（aster-lang-core#232）
  if (expectation && !expectation.reported && !argumentFits(declaredReturn, bodyReturn)) {
    const last = f.body.statements[f.body.statements.length - 1];
    const span = (last && (last.span ?? originToSpan(last.origin))) ?? f.body.span ?? f.ret?.span ?? f.span;
    diagnostics.error(ErrorCode.RETURN_TYPE_MISMATCH, span, {
      expected: formatType(declaredReturn),
      actual: formatType(bodyReturn),
    });
  }
  return bodyReturn;
}
