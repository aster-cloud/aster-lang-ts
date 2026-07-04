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
import Decimal from 'decimal.js';

// Decimal 精确十进制配置（ADR 0025）：锁死 precision/rounding，**不依赖默认**，避免环境差异
// 与双引擎不一致。precision 设高（80）让 plus/minus/times 不被有效数字上下文截断（v1 输入
// 上限 38 位/scale 18，结果上限 76 < 80）；ROUND_HALF_EVEN 默认（除法/舍入走显式 builtin
// 才指定 mode，此默认仅兜底）。toExpNeg/toExpPos 设极值禁科学计数法（toPlainString 风格）。
Decimal.set({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -1e9, toExpPos: 1e9 });

/** Decimal 运行时值=decimal.js 实例。值语义（new Decimal("1.00") 与 "1" comparedTo=0），
 * toFixed() 输出无指数的 canonical 串，与 truffle BigDecimal.toPlainString 对齐。 */
function isDecimalValue(v: unknown): v is Decimal {
  return v instanceof Decimal;
}

/**
 * 舍入模式字符串 → decimal.js rounding 常量（ADR 0025 M2）。三引擎统一这三种：
 * HALF_UP（四舍五入，远离零）/ HALF_EVEN（银行家舍入，向偶数）/ DOWN（截断，朝零）。
 * 与 Java BigDecimal.RoundingMode 同名同义——舍入结果逐位一致（已实测含 2.5→2/3.5→4 边界）。
 */
function decimalRoundingMode(mode: unknown): Decimal.Rounding {
  switch (mode) {
    case 'HALF_UP': return Decimal.ROUND_HALF_UP;
    case 'HALF_EVEN': return Decimal.ROUND_HALF_EVEN;
    case 'DOWN': return Decimal.ROUND_DOWN;
    default:
      throw new InterpreterError(
        `Decimal: unknown rounding mode ${JSON.stringify(mode)}; use "HALF_UP", "HALF_EVEN" or "DOWN".`);
  }
}

/** scale 参数校验：必须是 0..18 的整数（v1 上限 scale 18，与 ADR 0025 一致）。 */
function decimalScale(scale: unknown): number {
  const n = typeof scale === 'number' ? scale : Number(scale);
  if (!Number.isInteger(n) || n < 0 || n > 18) {
    throw new InterpreterError(`Decimal: scale must be an integer in [0, 18], got ${JSON.stringify(scale)}.`);
  }
  return n;
}

/** 把任意操作数转成 Decimal（Int/Long 精确提升；Double 禁；已是 Decimal 原样）。 */
function toDecimalArg(v: unknown, ctx: string): Decimal {
  if (v instanceof Decimal) return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) {
      throw new InterpreterError(`Cannot combine Decimal and Double (${ctx}). Use a Decimal literal such as 1.08m.`);
    }
    return new Decimal(v);
  }
  throw new InterpreterError(`Decimal: expected Decimal/Int operand (${ctx}), got ${typeof v}.`);
}

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
  options?: { maxSteps?: number },
): EvalResult {
  const start = performance.now();
  try {
    const interp = new Interpreter(core, options?.maxSteps ?? MAX_STEPS);
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

/**
 * Guest Map 运行时值。以真正的 `Map` 作后端，杜绝原型污染 / 原型链泄漏
 * （`Map.get(m,"constructor")` 不再泄漏 `Object`；`Map.put(m,"__proto__",x)`
 * 只会写入一个普通条目，不污染任何原型），并保留插入序（含数字样式键，
 * 与 JVM `LinkedHashMap` 契约一致）。`toJSON` 让 `JSON.stringify`（dual-engine
 * runner / 浏览器输出）仍产出有序的普通对象。
 */
class GuestMap extends Map<string, unknown> {
  toJSON(): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const [k, v] of this) o[k] = v;
    return o;
  }
}

/**
 * 把任意运行时值规约为 GuestMap（只读视图，不复制已是 GuestMap 的输入）。
 * 防御性地兼容历史普通对象 / 原生 Map 形态；对 null / 非对象返回空 map。
 * 仅遍历自有可枚举键（不触碰原型链）。
 */
function asGuestMap(v: unknown): GuestMap {
  if (v instanceof GuestMap) return v;
  const m = new GuestMap();
  if (v && typeof v === 'object') {
    if (v instanceof Map) {
      for (const [k, val] of v) m.set(String(k), val);
    } else {
      for (const k of Object.keys(v as object)) {
        m.set(k, (v as Record<string, unknown>)[k]);
      }
    }
  }
  return m;
}

/**
 * 值相等（value equality），与 JVM `equals` 契约对齐——**不是** JS 引用相等。
 * - Decimal↔Decimal 用 `.equals`（`1.5m === 1.5m` 引用不等但值相等）。
 * - 数组 / 普通对象（构造体）做结构比较。
 * 供 List.distinct / List.contains 使用，修复 Decimal / 结构体去重的 parity 破缺。
 */
function valueEquals(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  const xd = x instanceof Decimal;
  const yd = y instanceof Decimal;
  if (xd || yd) return xd && yd && (x as Decimal).equals(y as Decimal);
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!valueEquals(x[i], y[i])) return false;
    return true;
  }
  if (
    x && y && typeof x === 'object' && typeof y === 'object'
    && !Array.isArray(x) && !Array.isArray(y)
    && !(x instanceof Map) && !(y instanceof Map)
  ) {
    const kx = Object.keys(x as object);
    const ky = Object.keys(y as object);
    if (kx.length !== ky.length) return false;
    for (const k of kx) {
      if (!Object.prototype.hasOwnProperty.call(y, k)) return false;
      if (!valueEquals((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

/** 安全限制常量 */
// 默认步数上限（防无限循环/DoS——未知/不可信调用方的安全闸门）。可经 evaluate 的
// maxSteps 选项为受信、计算量已知有界的场景上调（如 poker best-5-of-7：21 组合×classify
// ~数万步但 <6ms，是有界计算非死循环）。上调不改默认，untrusted 调用仍受 10000 保护。
const MAX_STEPS = 10_000;
const MAX_CALL_DEPTH = 50;

// 红队 P0-B：List.range 生成列表长度上限（防「小标量→巨列表」内存耗尽 DoS）。
// statementLimit/MAX_STEPS 只数解释器步进不数 native range 循环 → range(0, 2e9) 会
// 撑爆内存。与 aster-lang-truffle Builtins.MAX_RANGE_SIZE 保持一致，维持双引擎 parity。
const MAX_RANGE_SIZE = 1_000_000;

/** evalStdlibCall 的哨兵返回值：表示"不是已知 stdlib 调用"。用 Symbol 避免与任何合法返回值冲突。 */
const NOT_STDLIB = Symbol('not-stdlib');

// ── Date.* 合规原语支撑：纯整数 proleptic Gregorian 历法（与 truffle 逐位一致）。 ──
// 铁律：内部日期 = epoch-day Int（自 1970-01-01 的天数）。**不用 JS Date**（避时区/DST/
// year 0..99 陷阱）。年份范围 0001-9999。禁 today()（确定性——"今天"必须作输入字段）。
const DATE_MIN_EPOCH = -719162; // 0001-01-01
const DATE_MAX_EPOCH = 2932896; // 9999-12-31
function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
/** 严格 YYYY-MM-DD 解析 + 闰年/月日校验 → epoch-day。非法抛 Date.InvalidISODate。 */
function dateFromISO(textValue: unknown): number {
  const s = typeof textValue === 'string' ? textValue : String(textValue);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new InterpreterError(`Date.InvalidISODate: ${JSON.stringify(s)}`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1) {
    throw new InterpreterError(`Date.InvalidISODate: ${JSON.stringify(s)}`);
  }
  const dim = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > dim[mo - 1]!) throw new InterpreterError(`Date.InvalidISODate: ${JSON.stringify(s)}`);
  // Howard Hinnant days-from-civil（纯整数，proleptic Gregorian）。
  const yy = mo <= 2 ? y - 1 : y;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
/** epoch-day → {year, month, day}（civil-from-days，纯整数）。范围外抛 Date.OutOfRange。 */
function dateToCivil(epochDay: unknown): { y: number; m: number; d: number } {
  const z0 = Number(epochDay);
  if (!Number.isInteger(z0) || z0 < DATE_MIN_EPOCH || z0 > DATE_MAX_EPOCH) {
    throw new InterpreterError(`Date.OutOfRange: epoch-day ${String(epochDay)}`);
  }
  const z = z0 + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: m <= 2 ? y + 1 : y, m, d };
}

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
  /** 步数上限（默认 MAX_STEPS，可由受信调用方上调） */
  private readonly maxSteps: number;
  /** 调用深度计数器（防无限递归） */
  private callDepth = 0;

  constructor(private readonly module: CoreTypes.Module, maxSteps: number = MAX_STEPS) {
    this.maxSteps = maxSteps > 0 ? maxSteps : MAX_STEPS;
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
      case 'Decimal':
        // value 是 canonical 十进制字符串（ADR 0025），运行时=decimal.js 实例（精确）。
        return new Decimal(expr.value);
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
      case 'IfExpr':
        // ADR 0019 G2b：表达式级 if —— 求 cond，按真值选分支求值产出值（与 Truffle
        // IfExprNode 同语义）。else 必有（Core IR IfExpr 保证）。
        return this.isTruthy(this.evalExpr(expr.cond, env))
          ? this.evalExpr(expr.thenE, env)
          : this.evalExpr(expr.elseE, env);
      case 'ListLit':
        // ADR 0024 C0：列表字面量 —— 逐元素求值成 JS 数组（List.* builtin 消费 Array）。
        return expr.elements.map((el) => this.evalExpr(el, env));
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
    // 通用集合 stdlib 辅助（与 truffle requireList/requireNonEmpty 镜像）。
    const reqList = (op: string, v: unknown): unknown[] => {
      if (!Array.isArray(v)) throw new InterpreterError(`${op}: expected List, got ${typeof v}`);
      return v;
    };
    const reqNonEmpty = (op: string, v: unknown): unknown[] => {
      const l = reqList(op, v);
      if (l.length === 0) throw new InterpreterError(`${op}: expected non-empty List`);
      return l;
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
      case 'List.contains': { const [l, x] = a(); return Array.isArray(l) ? (l as unknown[]).some((y) => valueEquals(y, x)) : false; }
      case 'List.append': { const [l, x] = a(); return Array.isArray(l) ? [...(l as unknown[]), x] : [x]; }
      case 'List.concat': { const [l1, l2] = a(); return [...(Array.isArray(l1) ? l1 : []), ...(Array.isArray(l2) ? l2 : [])]; }
      // Map.* — guest map 以真正的 Map（GuestMap）作后端：防原型污染 / 链泄漏，
      // 且保留插入序（含数字样式键，对齐 JVM LinkedHashMap）。绝不用 key in obj / obj[key]。
      case 'Map.empty': return new GuestMap();
      case 'Map.get': { const [m, k] = a(); const g = asGuestMap(m); const key = String(k); return g.has(key) ? g.get(key) : null; }
      case 'Map.contains': { const [m, k] = a(); return asGuestMap(m).has(String(k)); }
      case 'Map.size': { const [m] = a(); return asGuestMap(m).size; }
      // 补齐与 truffle Builtins 对等的 Map.* （put/remove/keys/values）——TS 之前缺这 4 个，
      // List.groupBy(...) 的 Map.values 链需要。put/remove 不可变（返回新 GuestMap）。
      case 'Map.put': { const [m, k, v] = a(); const g = new GuestMap(asGuestMap(m)); g.set(String(k), v); return g; }
      case 'Map.remove': { const [m, k] = a(); const g = new GuestMap(asGuestMap(m)); g.delete(String(k)); return g; }
      // Date.* 合规原语（Stable v1）：epoch-day Int 内部表示，纯整数 proleptic Gregorian
      // （与 truffle 逐位一致，不用 JS Date）。禁 today()——"今天"作输入字段 evaluation_date。
      case 'Date.fromISO': return dateFromISO(a()[0]);
      case 'Date.daysBetween': { const [d1, d2] = a(); return Number(d2) - Number(d1); }
      case 'Date.addDays': {
        const [d, n] = a();
        const r = Number(d) + Number(n);
        if (r < DATE_MIN_EPOCH || r > DATE_MAX_EPOCH) throw new InterpreterError(`Date.OutOfRange: epoch-day ${r}`);
        return r;
      }
      case 'Date.year': return dateToCivil(a()[0]).y;
      case 'Date.month': return dateToCivil(a()[0]).m;
      case 'Date.day': return dateToCivil(a()[0]).d;
      // Decimal.* 精确舍入/除法（ADR 0025 M2）。mode 字符串 HALF_UP/HALF_EVEN/DOWN，scale 0..18。
      // 与 truffle BigDecimal.setScale/divide(RoundingMode) 逐位一致（含 2.5→2 银行家舍入）。
      // 结果是 decimal.js Decimal，序列化走 canonical（去尾零）路径。
      case 'Decimal.round': {
        const [x, scale, mode] = a();
        return toDecimalArg(x, 'Decimal.round').toDecimalPlaces(decimalScale(scale), decimalRoundingMode(mode));
      }
      case 'Decimal.divide': {
        const [x, y, scale, mode] = a();
        const divisor = toDecimalArg(y, 'Decimal.divide divisor');
        if (divisor.isZero()) throw new InterpreterError('Decimal.divide: division by zero.');
        return toDecimalArg(x, 'Decimal.divide dividend')
          .dividedBy(divisor)
          .toDecimalPlaces(decimalScale(scale), decimalRoundingMode(mode));
      }
      case 'Map.keys': { const [m] = a(); return [...asGuestMap(m).keys()]; }
      case 'Map.values': { const [m] = a(); return [...asGuestMap(m).values()]; }
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

      // === 通用集合 stdlib（ADR 0024 受控扩展，与 truffle Builtins 镜像，逐位 parity）===
      // 数值序用 Number() 比较；排序稳定、升序。
      case 'List.sum': {
        const l = reqList('List.sum', a()[0]);
        let s = 0; for (const x of l) s += Number(x); return s;
      }
      case 'List.min': {
        const l = reqNonEmpty('List.min', a()[0]);
        let best = l[0]; for (const x of l) if (Number(x) < Number(best)) best = x; return best;
      }
      case 'List.max': {
        const l = reqNonEmpty('List.max', a()[0]);
        let best = l[0]; for (const x of l) if (Number(x) > Number(best)) best = x; return best;
      }
      case 'List.distinct': {
        const l = reqList('List.distinct', a()[0]);
        const out: unknown[] = [];
        // 每元素 tick()：让 MAX_STEPS 约束原生 O(n²) 循环（range→distinct DoS 防护）。
        // 值相等（valueEquals）：Decimal / 结构体按值去重，非 JS 引用相等。
        for (const x of l) { this.tick(); if (!out.some((y) => valueEquals(y, x))) out.push(x); }
        return out;
      }
      case 'List.range': {
        const [s, e] = a();
        const start = Number(s);
        const end = Number(e);
        // 红队 P0-B：先按长度判上限，超限即抛（不先生成，防 DoS）。
        const size = end - start;
        if (size > MAX_RANGE_SIZE) {
          throw new InterpreterError(`List.range: 长度过大（${size} > ${MAX_RANGE_SIZE}），拒绝以防内存耗尽 DoS`);
        }
        const out: number[] = [];
        for (let i = start; i < end; i++) out.push(i);
        return out;
      }
      // List.combinations(list, k) — list 的所有 k 元素子集，确定性递增索引字典序。
      // 与 truffle 逐位一致：纯整数索引推进算法（不依赖语言细节）。DoS 防护：n≤64 +
      // 结果数 C(n,k)≤上限（先算组合数，超限即抛，不先生成）——多租户沙箱铁律。
      // 边界：k<0 抛错；k>n 返回 []；k=0 返回 [[]]。保留元素原值与相对顺序。
      case 'List.combinations': {
        const l = reqList('List.combinations', a()[0]);
        const k = Number(a()[1]);
        if (!Number.isInteger(k) || k < 0) throw new InterpreterError(`List.combinations: k 须为非负整数，got ${a()[1]}`);
        const n = l.length;
        const MAX_N = 64, MAX_RESULT = 5000;
        if (n > MAX_N) throw new InterpreterError(`List.combinations: 列表过长（${n} > ${MAX_N}），拒绝以防组合爆炸`);
        if (k > n) return [];
        // 先算 C(n,k)，超限即抛（不先生成，防 DoS）。
        let count = 1;
        for (let i = 0; i < k; i++) {
          count = (count * (n - i)) / (i + 1);
          if (count > MAX_RESULT) throw new InterpreterError(`List.combinations: 组合数过多（C(${n},${k}) > ${MAX_RESULT}）`);
        }
        if (k === 0) return [[]];
        const out: unknown[][] = [];
        const idx: number[] = [];
        for (let i = 0; i < k; i++) idx.push(i);
        for (;;) {
          out.push(idx.map((i) => l[i]));
          // 从右向左找还能自增的位置
          let i = k - 1;
          while (i >= 0 && idx[i]! === n - k + i) i--;
          if (i < 0) break;
          idx[i]!++;
          for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
        }
        return out;
      }
      case 'List.sort': {
        const l = reqList('List.sort', a()[0]);
        return [...l].sort((x, y) => Number(x) - Number(y));
      }
      case 'List.count': {
        const l = reqList('List.count', this.evalExpr(argExprs[0]!, env));
        const pred = callableArg(1);
        let n = 0; for (const item of l) if (this.applyCallable(pred, [item]) === true) n++;
        return n;
      }
      case 'List.sortBy': {
        const l = reqList('List.sortBy', this.evalExpr(argExprs[0]!, env));
        const keyFn = callableArg(1);
        return [...l].sort((x, y) => Number(this.applyCallable(keyFn, [x])) - Number(this.applyCallable(keyFn, [y])));
      }
      case 'List.minBy': {
        const l = reqNonEmpty('List.minBy', this.evalExpr(argExprs[0]!, env));
        const keyFn = callableArg(1);
        let best = l[0]; let bestK = Number(this.applyCallable(keyFn, [best]));
        for (const x of l) { const k = Number(this.applyCallable(keyFn, [x])); if (k < bestK) { best = x; bestK = k; } }
        return best;
      }
      case 'List.maxBy': {
        const l = reqNonEmpty('List.maxBy', this.evalExpr(argExprs[0]!, env));
        const keyFn = callableArg(1);
        let best = l[0]; let bestK = Number(this.applyCallable(keyFn, [best]));
        for (const x of l) { const k = Number(this.applyCallable(keyFn, [x])); if (k > bestK) { best = x; bestK = k; } }
        return best;
      }
      case 'List.groupBy': {
        const l = reqList('List.groupBy', this.evalExpr(argExprs[0]!, env));
        const keyFn = callableArg(1);
        // GuestMap 后端：防原型污染、保留插入序、供 Map.values 链消费。
        // 每元素 tick()：让 MAX_STEPS 约束原生循环（range→groupBy DoS 防护）。
        const groups = new GuestMap();
        for (const item of l) {
          this.tick();
          const key = text(this.applyCallable(keyFn, [item]));
          const arr = groups.get(key) as unknown[] | undefined;
          if (arr) arr.push(item);
          else groups.set(key, [item]);
        }
        return groups;
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

    // Decimal 运算（ADR 0025）：任一操作数是 Decimal 时走精确十进制。Int/Long(number)→
    // Decimal 精确提升；**Double↔Decimal 禁止**（double 已不精确，提升=假精确）；plus/minus/
    // times 精确，**除法/取模禁**（走显式 Decimal.divide builtin）；比较用 compareTo。
    if (isDecimalValue(left) || isDecimalValue(right)) {
      const toDec = (v: unknown, side: string): Decimal => {
        if (isDecimalValue(v)) return v;
        if (typeof v === 'number') {
          if (!Number.isInteger(v)) {
            throw new InterpreterError(
              `Cannot combine Decimal and Double (${side}). Use a Decimal literal such as 1.08m.`);
          }
          return new Decimal(v); // Int/Long 整数精确提升
        }
        throw new InterpreterError(`Decimal ${op}: expected Decimal/Int operand, got ${typeof v}`);
      };
      const l = toDec(left, 'left'), r = toDec(right, 'right');
      switch (op) {
        case '+': return l.plus(r);
        case '-': return l.minus(r);
        case '*': return l.times(r);
        case '/': case '//': case '%':
          throw new InterpreterError(
            `Decimal '${op}' not supported — use Decimal.divide(x, y, scale, mode) for exact division.`);
        case '==': return l.comparedTo(r) === 0;
        case '!=': return l.comparedTo(r) !== 0;
        case '<': return l.comparedTo(r) < 0;
        case '<=': return l.comparedTo(r) <= 0;
        case '>': return l.comparedTo(r) > 0;
        case '>=': return l.comparedTo(r) >= 0;
        default:
          throw new InterpreterError(`Decimal: unsupported operator '${op}'`);
      }
    }

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
    if (this.steps > this.maxSteps) {
      throw new InterpreterError(
        `Maximum execution steps (${this.maxSteps}) exceeded — possible infinite loop`,
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
