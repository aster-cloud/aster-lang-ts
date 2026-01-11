import type { Core } from '../types.js';

/**
 * 统一的 Core IR 遍历器接口与默认实现。
 *
 * 设计目标：
 * - 提供统一的入口 `visitModule/visitDecl/visitBlock/visitStmt/visitExpr`
 * - 默认实现执行深度优先的递归遍历；具体阶段按需覆写感兴趣的节点方法
 * - 仅依赖 Core IR 类型，不引入额外运行时依赖
 */

/**
 * Visitor 遍历的上下文对象
 */
export interface VisitorContext {
  /** 当前模块名称 */
  moduleName?: string;
  /** 当前函数名称（如果在函数内） */
  functionName?: string;
  /** 父节点栈 */
  parentStack?: any[];
  /** 自定义数据 */
  data?: Map<string, any>;
}

/**
 * 创建空的 Visitor 上下文
 */
export function createVisitorContext(): VisitorContext {
  return {
    data: new Map(),
  };
}

export interface CoreVisitor<Ctx, R = void> {
  // 顶层
  visitModule(m: Core.Module, ctx: Ctx): R;
  visitDeclaration(d: Core.Declaration, ctx: Ctx): R;

  // 语句级
  visitBlock(b: Core.Block, ctx: Ctx): R;
  visitStatement(s: Core.Statement, ctx: Ctx): R;

  // 表达式级
  visitExpression(e: Core.Expression, ctx: Ctx): R;
  visitPattern?(p: Core.Pattern, ctx: Ctx): R;
  visitType?(t: Core.Type, ctx: Ctx): R;
}

/**
 * 默认的 Core IR 递归遍历器。
 *
 * - 覆写某个 `visitXxx` 方法即可插入自定义逻辑；调用 `super.visitXxx` 继续默认递归。
 * - 所有 `switch` 语句保持与 `src/types.ts` 中 Core 节点 kind 对齐。
 */
export class DefaultCoreVisitor<Ctx = VisitorContext> implements CoreVisitor<Ctx, void> {
  // 可选钩子默认不实现，由子类按需覆写
  public visitType?(t: Core.Type, ctx: Ctx): void;
  public visitPattern?(p: Core.Pattern, ctx: Ctx): void;
  visitModule(m: Core.Module, ctx: Ctx): void {
    for (const d of m.decls) this.visitDeclaration(d, ctx);
  }

  visitDeclaration(d: Core.Declaration, ctx: Ctx): void {
    switch (d.kind) {
      case 'Import':
        return;
      case 'Data':
        // data 构造器类型字段（若存在）
        for (const f of d.fields ?? []) this.visitType?.(f.type, ctx);
        return;
      case 'Enum':
        return;
      case 'Func':
        for (const p of d.params) this.visitType?.(p.type, ctx);
        this.visitType?.(d.ret, ctx);
        if (d.body) this.visitBlock(d.body, ctx);
        return;
    }
  }

  visitBlock(b: Core.Block, ctx: Ctx): void {
    for (const s of b.statements) this.visitStatement(s, ctx);
  }

  visitStatement(s: Core.Statement, ctx: Ctx): void {
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
        for (const kase of s.cases) {
          if (kase.pattern) this.visitPattern?.(kase.pattern, ctx);
          if (kase.body.kind === 'Return') this.visitExpression(kase.body.expr, ctx);
          else this.visitBlock(kase.body, ctx);
        }
        return;
      case 'Scope':
        // Scope 语义为嵌套 Block
        this.visitBlock({ kind: 'Block', statements: s.statements }, ctx);
        return;
      case 'Start':
        this.visitExpression(s.expr, ctx);
        return;
      case 'Wait':
        return;
      case 'workflow':
        for (const step of s.steps) {
          this.visitBlock(step.body, ctx);
          if (step.compensate) this.visitBlock(step.compensate, ctx);
        }
        return;
    }
  }

  visitExpression(e: Core.Expression, ctx: Ctx): void {
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
    }
  }
}
