/**
 * @module core/interpreter
 *
 * Core IR tree-walk 解释器。
 *
 * 对编译后的 Core IR 进行求值，支持：
 * - 算术运算（+, -, *, /）
 * - 比较运算（>, <, >=, <=, ==）
 * - 逻辑运算（and, or, not）
 * - 条件分支（If/Match）
 * - 变量绑定（Let/Set）
 * - 函数调用（递归）
 * - 结构体构造（Construct）
 * - 字段访问（dot notation via Name）
 */

import type { Core as CoreTypes } from '../types.js';

// ============================================================================
// 公共接口
// ============================================================================

/** 求值结果 */
export interface EvalResult {
  /** 是否执行成功 */
  success: boolean;
  /** 返回值（成功时） */
  value?: unknown;
  /** 错误信息（失败时） */
  error?: string;
  /** 执行耗时（毫秒） */
  executionTimeMs?: number;
}

/**
 * 对已编译的 Core IR 模块执行指定函数。
 *
 * @param core - 编译后的 Core IR 模块
 * @param functionName - 要执行的函数名
 * @param context - 传入函数的参数值（键为参数名，值为参数值）
 * @returns 求值结果
 */
export function evaluate(
  core: CoreTypes.Module,
  functionName: string,
  context: Record<string, unknown>,
): EvalResult {
  const start = performance.now();
  try {
    const interp = new Interpreter(core);
    const value = interp.callFunction(functionName, context);
    return {
      success: true,
      value,
      executionTimeMs: Math.round((performance.now() - start) * 100) / 100,
    };
  } catch (err) {
    if (err instanceof InterpreterError) {
      return {
        success: false,
        error: err.message,
        executionTimeMs: Math.round((performance.now() - start) * 100) / 100,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      executionTimeMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }
}

// ============================================================================
// 内部实现
// ============================================================================

/** 解释器错误 */
class InterpreterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterpreterError';
  }
}

/** Return 语句信号（非错误，用于控制流） */
class ReturnSignal {
  constructor(public readonly value: unknown) {}
}

/** 安全限制常量 */
const MAX_STEPS = 10_000;
const MAX_CALL_DEPTH = 50;

/** 内置运算符集合 */
const BUILTIN_OPS = new Set([
  '+', '-', '*', '/',
  '>', '<', '>=', '<=', '==',
  'and', 'or', 'not',
]);

/**
 * Core IR tree-walk 解释器
 */
class Interpreter {
  /** 模块中所有函数声明（按名称索引） */
  private readonly funcs: Map<string, CoreTypes.Func>;
  /** 模块中所有数据声明（按名称索引） */
  private readonly dataDecls: Map<string, CoreTypes.Data>;
  /** 执行步数计数器（防无限循环） */
  private steps = 0;
  /** 调用深度计数器（防无限递归） */
  private callDepth = 0;

  constructor(private readonly module: CoreTypes.Module) {
    this.funcs = new Map();
    this.dataDecls = new Map();

    for (const decl of module.decls) {
      switch (decl.kind) {
        case 'Func':
          this.funcs.set(decl.name, decl);
          break;
        case 'Data':
          this.dataDecls.set(decl.name, decl);
          break;
      }
    }
  }

  /** 调用模块中的指定函数 */
  callFunction(name: string, context: Record<string, unknown>): unknown {
    const func = this.funcs.get(name);
    if (!func) {
      const available = [...this.funcs.keys()].join(', ');
      throw new InterpreterError(
        `Function '${name}' not found in module. Available: ${available || 'none'}`,
      );
    }

    // 构建初始环境：将 context 中的值按参数名映射
    const env = new Map<string, unknown>();
    for (const param of func.params) {
      if (param.name in context) {
        env.set(param.name, context[param.name]);
      } else {
        throw new InterpreterError(
          `Missing required parameter '${param.name}' for function '${name}'`,
        );
      }
    }

    return this.invokeFunc(func, env);
  }

  /** 执行函数体 */
  private invokeFunc(func: CoreTypes.Func, env: Map<string, unknown>): unknown {
    this.callDepth++;
    if (this.callDepth > MAX_CALL_DEPTH) {
      throw new InterpreterError(
        `Maximum call depth (${MAX_CALL_DEPTH}) exceeded`,
      );
    }

    try {
      this.execBlock(func.body, env);
      // 函数体执行完毕但没有 Return → 返回 null
      return null;
    } catch (signal) {
      if (signal instanceof ReturnSignal) {
        return signal.value;
      }
      throw signal;
    } finally {
      this.callDepth--;
    }
  }

  // ------------------------------------------------------------------
  // 语句执行
  // ------------------------------------------------------------------

  private execBlock(block: CoreTypes.Block | CoreTypes.Scope, env: Map<string, unknown>): void {
    for (const stmt of block.statements) {
      this.execStmt(stmt, env);
    }
  }

  private execStmt(stmt: CoreTypes.Statement, env: Map<string, unknown>): void {
    this.tick();

    switch (stmt.kind) {
      case 'Let': {
        const value = this.evalExpr(stmt.expr, env);
        env.set(stmt.name, value);
        break;
      }
      case 'Set': {
        const value = this.evalExpr(stmt.expr, env);
        env.set(stmt.name, value);
        break;
      }
      case 'Return': {
        const value = this.evalExpr(stmt.expr, env);
        throw new ReturnSignal(value);
      }
      case 'If': {
        const cond = this.evalExpr(stmt.cond, env);
        if (this.isTruthy(cond)) {
          this.execBlock(stmt.thenBlock, env);
        } else if (stmt.elseBlock) {
          this.execBlock(stmt.elseBlock, env);
        }
        break;
      }
      case 'Match': {
        const value = this.evalExpr(stmt.expr, env);
        this.execMatch(value, stmt.cases, env);
        break;
      }
      case 'Scope': {
        // Scope 创建新的作用域（子环境）
        const childEnv = new Map(env);
        this.execBlock(stmt, childEnv);
        break;
      }
      case 'Start':
      case 'Wait':
      case 'workflow':
        throw new InterpreterError(
          `Async operations (${stmt.kind}) are not supported in the interpreter`,
        );
      default:
        throw new InterpreterError(`Unknown statement kind: ${(stmt as any).kind}`);
    }
  }

  private execMatch(
    value: unknown,
    cases: readonly CoreTypes.Case[],
    env: Map<string, unknown>,
  ): void {
    for (const c of cases) {
      const childEnv = new Map(env);
      if (this.matchPattern(value, c.pattern, childEnv)) {
        if (c.body.kind === 'Return') {
          const result = this.evalExpr(c.body.expr, childEnv);
          throw new ReturnSignal(result);
        }
        // Block body
        this.execBlock(c.body as CoreTypes.Block, childEnv);
        return;
      }
    }
  }

  private matchPattern(
    value: unknown,
    pattern: CoreTypes.Pattern,
    env: Map<string, unknown>,
  ): boolean {
    switch (pattern.kind) {
      case 'PatNull':
        return value === null || value === undefined;
      case 'PatName':
        // 通配符绑定：匹配任何值并绑定到变量
        env.set(pattern.name, value);
        return true;
      case 'PatInt':
        return value === pattern.value;
      case 'PatCtor': {
        // 构造器模式匹配（如 Ok(x)、Some(x)）
        if (value === null || value === undefined || typeof value !== 'object') {
          return false;
        }
        const obj = value as Record<string, unknown>;
        if (obj.__type !== pattern.typeName) {
          return false;
        }
        // 绑定字段到 names
        if (pattern.names) {
          for (const name of pattern.names) {
            env.set(name, obj[name]);
          }
        }
        return true;
      }
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------
  // 表达式求值
  // ------------------------------------------------------------------

  private evalExpr(expr: CoreTypes.Expression, env: Map<string, unknown>): unknown {
    this.tick();

    switch (expr.kind) {
      case 'Int':
        return expr.value;
      case 'Double':
        return expr.value;
      case 'Bool':
        return expr.value;
      case 'String':
        return expr.value;
      case 'Long':
        // Long 值存储为 string，尝试转为 number
        return Number(expr.value);
      case 'Null':
        return null;
      case 'None':
        return null;
      case 'Name':
        return this.resolveName(expr.name, env);
      case 'Call':
        return this.evalCall(expr, env);
      case 'Construct':
        return this.evalConstruct(expr, env);
      case 'Ok':
        return { __type: 'Ok', value: this.evalExpr(expr.expr, env) };
      case 'Err':
        return { __type: 'Err', value: this.evalExpr(expr.expr, env) };
      case 'Some':
        return { __type: 'Some', value: this.evalExpr(expr.expr, env) };
      case 'Lambda':
        throw new InterpreterError('Lambda expressions are not supported in the interpreter');
      case 'Await':
        throw new InterpreterError('Await expressions are not supported in the interpreter');
      default:
        throw new InterpreterError(`Unknown expression kind: ${(expr as any).kind}`);
    }
  }

  /** 解析 Name 节点：支持 dot notation 字段访问 */
  private resolveName(name: string, env: Map<string, unknown>): unknown {
    if (name.includes('.')) {
      const parts = name.split('.');
      const root = parts[0]!;
      let current: unknown = env.get(root);
      if (current === undefined && !env.has(root)) {
        throw new InterpreterError(`Undefined variable '${root}'`);
      }
      for (let i = 1; i < parts.length; i++) {
        const field = parts[i]!;
        if (current === null || current === undefined) {
          throw new InterpreterError(
            `Cannot access field '${field}' on null/undefined (accessing '${parts.slice(0, i + 1).join('.')}')`
          );
        }
        if (typeof current !== 'object') {
          throw new InterpreterError(
            `Cannot access field '${field}' on non-object value (accessing '${parts.slice(0, i + 1).join('.')}')`
          );
        }
        current = (current as Record<string, unknown>)[field];
      }
      return current;
    }

    // 简单变量查找
    if (env.has(name)) {
      return env.get(name);
    }

    // 布尔字面量（lowering 可能生成 Name('true')/Name('false')）
    if (name === 'true') return true;
    if (name === 'false') return false;
    if (name === 'null') return null;

    throw new InterpreterError(`Undefined variable '${name}'`);
  }

  /** 求值函数调用或运算符 */
  private evalCall(call: CoreTypes.Call, env: Map<string, unknown>): unknown {
    // 检查是否为内置运算符
    if (call.target.kind === 'Name' && BUILTIN_OPS.has(call.target.name)) {
      return this.evalBuiltinOp(call.target.name, call.args, env);
    }

    // 用户定义函数调用
    if (call.target.kind === 'Name') {
      const funcName = call.target.name;
      const func = this.funcs.get(funcName);
      if (!func) {
        throw new InterpreterError(`Undefined function '${funcName}'`);
      }

      // 求值参数
      const argValues = call.args.map(arg => this.evalExpr(arg, env));

      // 构建函数环境
      const funcEnv = new Map<string, unknown>();
      for (let i = 0; i < func.params.length; i++) {
        const param = func.params[i]!;
        funcEnv.set(param.name, i < argValues.length ? argValues[i] : null);
      }

      return this.invokeFunc(func, funcEnv);
    }

    throw new InterpreterError(
      `Cannot call expression of kind '${call.target.kind}'`,
    );
  }

  /** 求值内置运算符 */
  private evalBuiltinOp(
    op: string,
    args: readonly CoreTypes.Expression[],
    env: Map<string, unknown>,
  ): unknown {
    // 单目运算符
    if (op === 'not') {
      if (args.length !== 1) {
        throw new InterpreterError(`'not' operator expects 1 argument, got ${args.length}`);
      }
      const val = this.evalExpr(args[0]!, env);
      return !this.isTruthy(val);
    }

    // 双目运算符
    if (args.length !== 2) {
      throw new InterpreterError(`'${op}' operator expects 2 arguments, got ${args.length}`);
    }

    const arg0 = args[0]!;
    const arg1 = args[1]!;

    // 短路求值：and/or
    if (op === 'and') {
      const left = this.evalExpr(arg0, env);
      if (!this.isTruthy(left)) return false;
      return this.isTruthy(this.evalExpr(arg1, env));
    }
    if (op === 'or') {
      const left = this.evalExpr(arg0, env);
      if (this.isTruthy(left)) return true;
      return this.isTruthy(this.evalExpr(arg1, env));
    }

    const left = this.evalExpr(arg0, env);
    const right = this.evalExpr(arg1, env);

    // 算术运算
    switch (op) {
      case '+': {
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right);
        }
        this.assertNumbers(op, left, right);
        return (left as number) + (right as number);
      }
      case '-': {
        this.assertNumbers(op, left, right);
        return (left as number) - (right as number);
      }
      case '*': {
        this.assertNumbers(op, left, right);
        return (left as number) * (right as number);
      }
      case '/': {
        this.assertNumbers(op, left, right);
        if ((right as number) === 0) {
          throw new InterpreterError('Division by zero');
        }
        return (left as number) / (right as number);
      }

      // 比较运算
      case '>':
        this.assertNumbers(op, left, right);
        return (left as number) > (right as number);
      case '<':
        this.assertNumbers(op, left, right);
        return (left as number) < (right as number);
      case '>=':
        this.assertNumbers(op, left, right);
        return (left as number) >= (right as number);
      case '<=':
        this.assertNumbers(op, left, right);
        return (left as number) <= (right as number);
      case '==':
        return left === right;

      default:
        throw new InterpreterError(`Unknown operator '${op}'`);
    }
  }

  /** 求值 Construct 表达式 */
  private evalConstruct(
    expr: CoreTypes.Construct,
    env: Map<string, unknown>,
  ): unknown {
    const obj: Record<string, unknown> = { __type: expr.typeName };
    for (const field of expr.fields) {
      obj[field.name] = this.evalExpr(field.expr, env);
    }
    return obj;
  }

  // ------------------------------------------------------------------
  // 辅助方法
  // ------------------------------------------------------------------

  /** 步数计数器，防止无限循环 */
  private tick(): void {
    this.steps++;
    if (this.steps > MAX_STEPS) {
      throw new InterpreterError(
        `Maximum execution steps (${MAX_STEPS}) exceeded — possible infinite loop`,
      );
    }
  }

  /** 判断值是否为 truthy */
  private isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.length > 0;
    return true;
  }

  /** 断言两个值都是数值类型 */
  private assertNumbers(op: string, left: unknown, right: unknown): void {
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new InterpreterError(
        `Type mismatch: '${op}' operator expects numbers, got ${typeof left} and ${typeof right}`,
      );
    }
  }
}
