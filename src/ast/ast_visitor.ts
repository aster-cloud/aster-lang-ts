import type {
  Module,
  Declaration,
  Block,
  Statement,
  Expression,
  Pattern,
  Type,
  Core,
} from '../types.js';

/**
 * 统一的 AST 遍历器接口与默认实现（只读遍历）。
 *
 * - 入口：visitModule/visitDeclaration/visitBlock/visitStatement/visitExpression
 * - 默认实现执行深度优先递归；子类可覆写特定 visit 方法并调用 super 继续遍历
 */
export interface AstVisitor<Ctx, R = void> {
  visitModule(m: Module, ctx: Ctx): R;
  visitDeclaration(d: Declaration, ctx: Ctx): R;
  visitBlock(b: Block, ctx: Ctx): R;
  visitStatement(s: Statement, ctx: Ctx): R;
  visitExpression(e: Expression, ctx: Ctx): R;
  visitPattern?(p: Pattern, ctx: Ctx): R;
  visitType?(t: Type, ctx: Ctx): R;
}

/**
 * 统一的 Core.Type 遍历器接口。
 *
 * 用于遍历 Core.Type 树结构，支持自定义访问逻辑。
 * 子类可覆写特定 visit 方法并通过 visitType 继续遍历。
 */
export interface TypeVisitor<Ctx, R = void> {
  visitType(t: Core.Type, ctx: Ctx): R;
  visitTypeVar?(v: Core.TypeVar, ctx: Ctx): R;
  visitEffectVar?(v: Core.EffectVar, ctx: Ctx): R;
  visitTypeName?(n: Core.TypeName, ctx: Ctx): R;
  visitMaybe?(m: Core.Maybe, ctx: Ctx): R;
  visitOption?(o: Core.Option, ctx: Ctx): R;
  visitResult?(r: Core.Result, ctx: Ctx): R;
  visitList?(l: Core.List, ctx: Ctx): R;
  visitMap?(m: Core.Map, ctx: Ctx): R;
  visitTypeApp?(a: Core.TypeApp, ctx: Ctx): R;
  visitFuncType?(f: Core.FuncType, ctx: Ctx): R;
  visitPiiType?(p: Core.PiiType, ctx: Ctx): R;
}

/**
 * TypeVisitor 的默认实现，执行深度优先递归遍历。
 *
 * 子类可覆写特定的 visitXxx 方法来定制行为，
 * 并通过调用 this.visitType() 继续遍历子类型。
 */
export class DefaultTypeVisitor<Ctx> implements TypeVisitor<Ctx, void> {
  visitType(t: Core.Type, ctx: Ctx): void {
    switch (t.kind) {
      case 'TypeVar':
        return this.visitTypeVar?.(t as Core.TypeVar, ctx);
      case 'EffectVar':
        return this.visitEffectVar?.(t as Core.EffectVar, ctx);
      case 'TypeName':
        return this.visitTypeName?.(t as Core.TypeName, ctx);
      case 'Maybe':
        return this.visitMaybe?.(t as Core.Maybe, ctx);
      case 'Option':
        return this.visitOption?.(t as Core.Option, ctx);
      case 'Result':
        return this.visitResult?.(t as Core.Result, ctx);
      case 'List':
        return this.visitList?.(t as Core.List, ctx);
      case 'Map':
        return this.visitMap?.(t as Core.Map, ctx);
      case 'TypeApp':
        return this.visitTypeApp?.(t as Core.TypeApp, ctx);
      case 'FuncType':
        return this.visitFuncType?.(t as unknown as Core.FuncType, ctx);
      case 'PiiType':
        return this.visitPiiType?.(t as Core.PiiType, ctx);
    }
  }

  // 默认实现递归遍历子类型
  visitTypeVar?(_v: Core.TypeVar, _ctx: Ctx): void {
    // TypeVar 是叶节点，无子类型
  }

  visitEffectVar?(_v: Core.EffectVar, _ctx: Ctx): void {
    // EffectVar 是叶节点
  }

  visitTypeName?(_n: Core.TypeName, _ctx: Ctx): void {
    // TypeName 是叶节点，无子类型
  }

  visitMaybe?(m: Core.Maybe, ctx: Ctx): void {
    this.visitType(m.type, ctx);
  }

  visitOption?(o: Core.Option, ctx: Ctx): void {
    this.visitType(o.type, ctx);
  }

  visitResult?(r: Core.Result, ctx: Ctx): void {
    this.visitType(r.ok, ctx);
    this.visitType(r.err, ctx);
  }

  visitList?(l: Core.List, ctx: Ctx): void {
    this.visitType(l.type, ctx);
  }

  visitMap?(m: Core.Map, ctx: Ctx): void {
    this.visitType(m.key, ctx);
    this.visitType(m.val, ctx);
  }

  visitTypeApp?(a: Core.TypeApp, ctx: Ctx): void {
    for (const arg of a.args) {
      this.visitType(arg, ctx);
    }
  }

  visitFuncType?(f: Core.FuncType, ctx: Ctx): void {
    for (const param of f.params) {
      this.visitType(param, ctx);
    }
    this.visitType(f.ret, ctx);
  }

  visitPiiType?(p: Core.PiiType, ctx: Ctx): void {
    this.visitType(p.baseType, ctx);
  }
}

export class DefaultAstVisitor<Ctx> implements AstVisitor<Ctx, void> {
  // 可选钩子默认不实现，由子类按需覆写
  public visitType?(t: Type, ctx: Ctx): void;
  public visitPattern?(p: Pattern, ctx: Ctx): void;
  visitModule(m: Module, ctx: Ctx): void {
    for (const d of m.decls) this.visitDeclaration(d, ctx);
  }

  visitDeclaration(d: Declaration, ctx: Ctx): void {
    switch (d.kind) {
      case 'Import':
        return;
      case 'Data':
        for (const f of d.fields ?? []) this.visitType?.(f.type, ctx);
        return;
      case 'Enum':
        return;
      case 'Func':
        for (const p of d.params) this.visitType?.(p.type, ctx);
        this.visitType?.(d.retType, ctx);
        if (d.body) this.visitBlock(d.body, ctx);
        return;
    }
  }

  visitBlock(b: Block, ctx: Ctx): void {
    for (const s of b.statements) this.visitStatement(s, ctx);
  }

  visitStatement(s: Statement, ctx: Ctx): void {
    switch (s.kind) {
      case 'Let':
      case 'Set':
      case 'Return':
        this.visitExpression(s.expr, ctx);
        return;
      case 'If':
        this.visitExpression(s.cond, ctx);
        this.visitBlock(s.thenBlock, ctx);
        if (s.elseBlock) this.visitBlock(s.elseBlock, ctx);
        return;
      case 'Match':
        this.visitExpression(s.expr, ctx);
        for (const c of s.cases) {
          if (c.pattern) this.visitPattern?.(c.pattern, ctx);
          if (c.body.kind === 'Return') this.visitExpression(c.body.expr, ctx);
          else this.visitBlock(c.body, ctx);
        }
        return;
      case 'Start':
        this.visitExpression(s.expr, ctx);
        return;
      case 'Wait':
        return;
      case 'Block':
        this.visitBlock(s, ctx);
        return;
      default:
        // AST 的 Statement 联合包含 Expression，直接下派
        this.visitExpression(s as unknown as Expression, ctx);
        return;
    }
  }

  visitExpression(e: Expression, ctx: Ctx): void {
    switch (e.kind) {
      case 'Name':
      case 'Bool':
      case 'Int':
      case 'Long':
      case 'Double':
      case 'String':
      case 'Null':
      case 'None':
        return;
      case 'Call':
        this.visitExpression(e.target, ctx);
        for (const a of e.args) this.visitExpression(a, ctx);
        return;
      case 'Construct':
        for (const f of e.fields) this.visitExpression(f.expr, ctx);
        return;
      case 'Ok':
      case 'Err':
      case 'Some':
        this.visitExpression(e.expr, ctx);
        return;
      case 'Lambda':
        this.visitBlock(e.body, ctx);
        return;
      case 'Await':
        this.visitExpression(e.expr, ctx);
        return;
    }
  }
}
