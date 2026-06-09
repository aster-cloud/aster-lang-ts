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

/**
 * 闭包运行时值：求值 Lambda 表达式的结果。捕获 lambda 的参数、函数体以及
 * 定义处的词法环境（lexical capture），从而支持引用外层变量的高阶函数
 * （如 List.map / Maybe.map 的回调）。与 aster-lang-truffle 的 LambdaValue
 * 语义对齐：调用时把实参绑定到参数名，叠加捕获的环境后执行函数体。
 */
class Closure {
  readonly __closure = true;
  constructor(
    public readonly params: readonly CoreTypes.Parameter[],
    public readonly body: CoreTypes.Block,
    public readonly capturedEnv: Map<string, unknown>,
  ) {}
}

/** 安全限制常量 */
const MAX_STEPS = 10_000;
const MAX_CALL_DEPTH = 50;

/** evalStdlibCall 的哨兵返回值：表示"不是已知 stdlib 调用"。用 Symbol 避免与任何合法返回值冲突。 */
const NOT_STDLIB = Symbol('not-stdlib');

/** 内置运算符集合 */
const BUILTIN_OPS = new Set([
  '+', '-', '*', '/', '//', '%',
  // 比较运算符必须与 evalBinaryOp 的 switch 分支一一对应。遗漏 '!='
  // 会让 `not equal to`（降低为 Call(Name('!='), …)）越过内置分发、
  // 落入用户函数查找，从而抛出 "Undefined function '!='"。
  '>', '<', '>=', '<=', '==', '!=',
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
      case 'PatName': {
        // PatName 双语义，与 Java MatchNode.PatNameNode 对齐：
        // - 大写开头（枚举变体/类型名，如 NotFound）→ 按名称相等匹配，不绑定。
        //   否则第一个 PatName 臂会吞掉所有输入（match_enum/enum_wildcard bug）。
        // - 小写开头（绑定变量，如 x/value）→ catch-all，匹配任意非 null 值并绑定。
        const isVariant = /^[A-Z]/.test(pattern.name);
        if (isVariant) {
          if (value === null || value === undefined) return false;
          if (typeof value === 'string') return value === pattern.name;
          if (typeof value === 'object') {
            const o = value as Record<string, unknown>;
            // 枚举值 { value: "Invalid" } 或构造体 { __type: "Color" }
            return o.value === pattern.name || o.__type === pattern.name;
          }
          return false;
        }
        // 小写：catch-all 绑定（Java 端非 null 才匹配）。
        if (value === null || value === undefined) return false;
        env.set(pattern.name, value);
        return true;
      }
      case 'PatInt':
        return value === pattern.value;
      case 'PatCtor': {
        // 构造器模式匹配（如 Ok(value)、Err(err)、Some(x)、User(id, name)）。
        // 与 aster-lang-truffle MatchNode.PatCtorNode 对齐：按位置（非按名）把
        // 构造体的非 __type 字段值依序绑定到模式的 bind 名——因为 Ok(value)/
        // Err(err) 的载荷统一存于 `value` 字段，绑定名却各异，按名绑定会落空。
        if (value === null || value === undefined || typeof value !== 'object') {
          return false;
        }
        const obj = value as Record<string, unknown>;
        if (obj.__type !== pattern.typeName) {
          return false;
        }
        const fieldValues = Object.keys(obj)
          .filter((k) => k !== '__type')
          .map((k) => obj[k]);
        if (pattern.names) {
          for (let i = 0; i < pattern.names.length; i++) {
            const bn = pattern.names[i]!;
            if (bn && bn !== '_') env.set(bn, fieldValues[i]);
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
        // 词法捕获当前环境的快照，避免后续 Set 改写影响已创建的闭包。
        return new Closure(expr.params, expr.body, new Map(env));
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

    // Ok/Err/Some 的调用形式（如 `Ok(x)`）——TS 前端把它降为 Call{Name 'Ok'}
    // 而非 Expr.Ok（关键字形式 `ok of x` 才降为 Expr.Ok）。与 Java AstBuilder
    // 对 Ok/Err/Some/None 调用形式的特判对齐，统一构造判定结果。
    if (call.target.kind === 'Name') {
      const ctor = call.target.name;
      if ((ctor === 'Ok' || ctor === 'Err' || ctor === 'Some') && call.args.length === 1) {
        return { __type: ctor, value: this.evalExpr(call.args[0]!, env) };
      }
      if (ctor === 'None' && call.args.length === 0) {
        return null;
      }
    }

    // stdlib namespaced builtin（Text.* 等），与 Java Builtins 对齐。
    // 必须在用户函数查找之前，否则 Text.concat 落入未定义函数分支。
    if (call.target.kind === 'Name' && call.target.name.includes('.')) {
      const stdlib = this.evalStdlibCall(call.target.name, call.args, env);
      if (stdlib !== NOT_STDLIB) return stdlib;
    }

    // 函数调用：可能是用户定义的模块函数，或绑定在环境里的闭包变量
    // （Let f be function with …）。先求值参数，再分派。
    if (call.target.kind === 'Name') {
      const funcName = call.target.name;
      const argValues = call.args.map(arg => this.evalExpr(arg, env));

      // 闭包变量优先（局部绑定遮蔽同名模块函数）。
      if (env.has(funcName)) {
        const bound = env.get(funcName);
        if (bound instanceof Closure) {
          return this.applyClosure(bound, argValues);
        }
      }

      const func = this.funcs.get(funcName);
      if (!func) {
        throw new InterpreterError(`Undefined function '${funcName}'`);
      }

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

  /**
   * 调用一个可调用值（闭包或具名模块函数），把实参按位置绑定到形参后执行。
   * 供高阶 stdlib（List.map / List.filter / List.reduce / Maybe.map /
   * Result.mapOk 等）统一复用——回调既可以是 \`Let f be function …\` 产生的
   * 闭包，也可以是直接传入的模块函数名（如 \`List.map(xs, id)\`）。
   */
  private applyCallable(callable: unknown, args: readonly unknown[]): unknown {
    if (callable instanceof Closure) {
      return this.applyClosure(callable, args);
    }
    if (typeof callable === 'string') {
      // 具名模块函数（作为一等函数传入）。
      const func = this.funcs.get(callable);
      if (!func) {
        throw new InterpreterError(`Undefined function '${callable}' used as callback`);
      }
      const funcEnv = new Map<string, unknown>();
      for (let i = 0; i < func.params.length; i++) {
        funcEnv.set(func.params[i]!.name, i < args.length ? args[i] : null);
      }
      return this.invokeFunc(func, funcEnv);
    }
    throw new InterpreterError('Expected a function (lambda or function name) as callback');
  }

  /** 以捕获环境为基底，绑定实参后执行闭包体。 */
  private applyClosure(closure: Closure, args: readonly unknown[]): unknown {
    const callEnv = new Map(closure.capturedEnv);
    for (let i = 0; i < closure.params.length; i++) {
      callEnv.set(closure.params[i]!.name, i < args.length ? args[i] : null);
    }
    this.callDepth++;
    if (this.callDepth > MAX_CALL_DEPTH) {
      throw new InterpreterError(`Maximum call depth (${MAX_CALL_DEPTH}) exceeded`);
    }
    try {
      this.execBlock(closure.body, callEnv);
      return null;
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      throw signal;
    } finally {
      this.callDepth--;
    }
  }

  /**
   * stdlib 命名空间 builtin（Text.* 等），语义与 aster-lang-truffle Builtins
   * 对齐。返回 NOT_STDLIB 表示不是已知 stdlib 调用（交回用户函数查找）。
   * 目前覆盖语料库用到的 Text.* 子集；未来 List/Map/Result 可同法扩展。
   */
  private evalStdlibCall(
    name: string,
    argExprs: readonly CoreTypes.Expression[],
    env: Map<string, unknown>,
  ): unknown {
    const text = (v: unknown): string => String(v);
    const a = (): unknown[] => argExprs.map((e) => this.evalExpr(e, env));
    // 解析"可调用"参数：若是引用模块函数的裸 Name（非局部变量），返回函数名字符串
    // 供 applyCallable 按名调用（如 List.map(xs, id)）；否则正常求值（→ Closure）。
    const callableArg = (idx: number): unknown => {
      const e = argExprs[idx];
      if (e && e.kind === 'Name' && !env.has(e.name) && this.funcs.has(e.name)) {
        return e.name;
      }
      return e ? this.evalExpr(e, env) : null;
    };
    switch (name) {
      case 'Text.concat': { const [x, y] = a(); return text(x) + text(y); }
      case 'Text.toUpper': return text(a()[0]).toUpperCase();
      case 'Text.toLower': return text(a()[0]).toLowerCase();
      case 'Text.length': return text(a()[0]).length;
      case 'Text.startsWith': { const [x, y] = a(); return text(x).startsWith(text(y)); }
      case 'Text.contains': { const [x, y] = a(); return text(x).includes(text(y)); }
      case 'Text.indexOf': { const [x, y] = a(); return text(x).indexOf(text(y)); }
      case 'Text.equals': { const [x, y] = a(); return text(x) === text(y); }
      case 'Text.split': { const [x, y] = a(); return text(x).split(text(y)); }
      case 'Text.trim': return text(a()[0]).trim();
      // List.* (非 lambda 部分；List.map/filter/reduce 依赖 lambda，TS 暂不支持)
      case 'List.empty': return [];
      case 'List.length': { const [l] = a(); return Array.isArray(l) ? l.length : 0; }
      case 'List.isEmpty': { const [l] = a(); return Array.isArray(l) ? l.length === 0 : true; }
      case 'List.get': { const [l, i] = a(); return Array.isArray(l) ? (l as unknown[])[Number(i)] : null; }
      case 'List.contains': { const [l, x] = a(); return Array.isArray(l) ? (l as unknown[]).includes(x) : false; }
      case 'List.append': { const [l, x] = a(); return Array.isArray(l) ? [...(l as unknown[]), x] : [x]; }
      case 'List.concat': { const [l1, l2] = a(); return [...(Array.isArray(l1) ? l1 : []), ...(Array.isArray(l2) ? l2 : [])]; }
      // Map.* — guest map 是普通对象 { key: value }
      case 'Map.empty': return {};
      case 'Map.get': { const [m, k] = a(); return m && typeof m === 'object' ? (m as Record<string, unknown>)[String(k)] ?? null : null; }
      case 'Map.contains': { const [m, k] = a(); return m && typeof m === 'object' ? String(k) in (m as object) : false; }
      case 'Map.size': { const [m] = a(); return m && typeof m === 'object' ? Object.keys(m as object).length : 0; }
      // Maybe/Option/Result（非 lambda 部分）。Some/Ok/Err/None 形如 { __type, value }。
      case 'Maybe.withDefault': case 'Option.unwrapOr': case 'Maybe.unwrapOr': {
        const [x, d] = a();
        const o = x as { __type?: string; value?: unknown } | null;
        return o && o.__type === 'Some' ? o.value : d;
      }
      case 'Maybe.isSome': case 'Option.isSome': { const [x] = a(); return (x as { __type?: string } | null)?.__type === 'Some'; }
      case 'Maybe.isNone': case 'Option.isNone': { const [x] = a(); return (x as { __type?: string } | null)?.__type !== 'Some'; }
      case 'Result.isOk': { const [r] = a(); return (r as { __type?: string } | null)?.__type === 'Ok'; }
      case 'Result.isErr': { const [r] = a(); return (r as { __type?: string } | null)?.__type === 'Err'; }
      // === 高阶（lambda）List 操作 ===
      // List.map(list, fn) — fn 接收 (item)，返回新列表。
      case 'List.map': {
        const list = this.evalExpr(argExprs[0]!, env);
        const fn = callableArg(1);
        if (!Array.isArray(list)) throw new InterpreterError(`List.map: expected List, got ${typeof list}`);
        return list.map((item) => this.applyCallable(fn, [item]));
      }
      // List.filter(list, pred) — pred 接收 (item)，返回布尔。
      case 'List.filter': {
        const list = this.evalExpr(argExprs[0]!, env);
        const fn = callableArg(1);
        if (!Array.isArray(list)) throw new InterpreterError(`List.filter: expected List, got ${typeof list}`);
        return list.filter((item) => this.applyCallable(fn, [item]) === true);
      }
      // List.reduce(list, init, fn) — fn 接收 (accumulator, item)，返回新累加值。
      case 'List.reduce': {
        const list = this.evalExpr(argExprs[0]!, env);
        const init = this.evalExpr(argExprs[1]!, env);
        const fn = callableArg(2);
        if (!Array.isArray(list)) throw new InterpreterError(`List.reduce: expected List, got ${typeof list}`);
        let acc: unknown = init;
        for (const item of list) acc = this.applyCallable(fn, [acc, item]);
        return acc;
      }
      // === 高阶 Maybe / Result 操作 ===
      // Maybe.map(opt, fn)：Some(v)→Some(fn(v))，None 原样返回。
      case 'Maybe.map': case 'Option.map': {
        const o = this.evalExpr(argExprs[0]!, env) as { __type?: string; value?: unknown } | null;
        if (o && o.__type === 'Some') {
          const fn = callableArg(1);
          return { __type: 'Some', value: this.applyCallable(fn, [o.value]) };
        }
        return { __type: 'None' };
      }
      // Result.mapOk(res, fn)：Ok(v)→Ok(fn(v))，Err 原样返回。
      case 'Result.mapOk': {
        const r = this.evalExpr(argExprs[0]!, env) as { __type?: string; value?: unknown } | null;
        if (r && r.__type === 'Err') return r;
        if (r && r.__type === 'Ok') {
          const fn = callableArg(1);
          return { __type: 'Ok', value: this.applyCallable(fn, [r.value]) };
        }
        throw new InterpreterError('Result.mapOk: expected Result (Ok or Err)');
      }
      // Result.mapErr(res, fn)：Err(v)→Err(fn(v))，Ok 原样返回。
      case 'Result.mapErr': {
        const r = this.evalExpr(argExprs[0]!, env) as { __type?: string; value?: unknown } | null;
        if (r && r.__type === 'Ok') return r;
        if (r && r.__type === 'Err') {
          const fn = callableArg(1);
          return { __type: 'Err', value: this.applyCallable(fn, [r.value]) };
        }
        throw new InterpreterError('Result.mapErr: expected Result (Ok or Err)');
      }
      // Result.tapError(res, fn)：对 Err 调用 fn 产生副作用后原样返回 Err；Ok 原样返回。
      case 'Result.tapError': {
        const r = this.evalExpr(argExprs[0]!, env) as { __type?: string; value?: unknown } | null;
        if (r && r.__type === 'Ok') return r;
        if (r && r.__type === 'Err') {
          const fn = callableArg(1);
          this.applyCallable(fn, [r.value]); // 副作用，丢弃返回值
          return r;
        }
        throw new InterpreterError('Result.tapError: expected Result (Ok or Err)');
      }
      default:
        return NOT_STDLIB;
    }
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
      case '//': {
        // 整除：向零截断（Math.trunc），与 Java intdiv builtin 一致。
        this.assertNumbers(op, left, right);
        if ((right as number) === 0) {
          throw new InterpreterError('Division by zero');
        }
        return Math.trunc((left as number) / (right as number));
      }
      case '%': {
        // 取模：JS `%` 已是向零截断语义，与 Java mod builtin 一致。
        this.assertNumbers(op, left, right);
        if ((right as number) === 0) {
          throw new InterpreterError('Division by zero');
        }
        return (left as number) % (right as number);
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
      case '!=':
        return left !== right;

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
