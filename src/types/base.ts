/**
 * @module types/base
 *
 * AST 和 Core IR 的共享基础类型定义。
 *
 * **设计原则**：
 * - 使用泛型参数处理 AST 和 Core IR 的类型差异
 * - 所有共享字段定义在基础接口中
 * - AST 和 Core 通过继承基础类型并特化泛型参数来实现
 *
 * **类型参数约定**：
 * - `SpanType`: AST 使用 Span（行列位置），Core 使用 Origin（文件+位置）
 * - `EffectType`: AST 使用 string[]，Core 使用 Effect[]
 * - `ExprType`: AST 和 Core 的表达式类型不同（Core 无 Await）
 * - `TypeType`: AST 和 Core 的类型节点不同（Core 有 PiiType）
 */

import type { Span, Origin } from '../types.js';
import type { Effect, CapabilityKind } from '../config/semantic.js';

// ============================================================
// 基础节点接口
// ============================================================

/**
 * 类型帮助器：检查类型 T 是否有 'file' 属性。
 *
 * @typeParam T - 要检查的类型
 * @internal
 */
export type HasFileProp<T> = 'file' extends keyof T ? true : false;

/**
 * 所有 AST 和 Core IR 节点的根接口。
 *
 * @typeParam S - Span 类型（AST: Span, Core: Origin）
 */

export interface BaseNode<S = Span | Origin> {
  readonly kind: string;
  readonly span?: HasFileProp<S> extends true ? never : Span;
  readonly origin?: HasFileProp<S> extends true ? Origin : never;
  readonly file?: string | null;
}

// ============================================================
// 共享声明节点
// ============================================================

/**
 * Import 声明基础接口。
 */
export interface BaseImport<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Import';
  readonly name: string;
  readonly asName: string | null;
}

/**
 * Data 类型声明基础接口。
 */
export interface BaseData<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'Data';
  readonly name: string;
  readonly fields: readonly BaseField<T>[];
}

/**
 * 字段基础接口。
 *
 * @typeParam T - 类型节点类型（AST: Type, Core: Core.Type）
 */
export interface BaseField<T = unknown> {
  readonly name: string;
  readonly type: T;
}

/**
 * Enum 声明基础接口。
 */
export interface BaseEnum<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Enum';
  readonly name: string;
  readonly variants: readonly string[];
}

/**
 * Module 模块基础接口。
 */
export interface BaseModule<S = Span | Origin, D = unknown> extends BaseNode<S> {
  readonly kind: 'Module';
  readonly name: string | null;
  readonly decls: readonly D[];
}

/**
 * 函数声明基础接口。
 *
 * @typeParam S - Span 类型
 * @typeParam E - Effect 类型（AST: string[], Core: Effect[]）
 * @typeParam T - Type 节点类型
*/
export interface BaseFunc<S = Span | Origin, E = string[] | readonly Effect[], T = unknown> extends BaseNode<S> {
  readonly kind: 'Func';
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly params: readonly BaseParameter<T>[];
  readonly effects: E;
  readonly effectCaps: readonly CapabilityKind[];
  readonly effectCapsExplicit: boolean;
}

/**
 * 参数基础接口。
 */
export interface BaseParameter<T = unknown> {
  readonly name: string;
  readonly type: T;
}

// ============================================================
// 共享语句节点
// ============================================================

/**
 * Let 绑定基础接口。
 */
export interface BaseLet<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Let';
  readonly name: string;
  readonly expr: Expr;
}

/**
 * Set 赋值基础接口。
 */
export interface BaseSet<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Set';
  readonly name: string;
  readonly expr: Expr;
}

/**
 * Return 语句基础接口。
 */
export interface BaseReturn<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Return';
  readonly expr: Expr;
}

/**
 * Block 基础接口。
 */
export interface BaseBlock<S = Span | Origin, Stmt = unknown> extends BaseNode<S> {
  readonly kind: 'Block';
  readonly statements: readonly Stmt[];
}

/**
 * Scope 作用域基础接口。
 */
export interface BaseScope<S = Span | Origin, Stmt = unknown> extends BaseNode<S> {
  readonly kind: 'Scope';
  readonly statements: readonly Stmt[];
}

/**
 * If 语句基础接口。
 */
export interface BaseIf<S = Span | Origin, Expr = unknown, Block = unknown> extends BaseNode<S> {
  readonly kind: 'If';
  readonly cond: Expr;
  readonly thenBlock: Block;
  readonly elseBlock: Block | null;
}

/**
 * Match 语句基础接口。
 */
export interface BaseMatch<S = Span | Origin, Expr = unknown, Case = unknown> extends BaseNode<S> {
  readonly kind: 'Match';
  readonly expr: Expr;
  readonly cases: readonly Case[];
}

/**
 * Case 分支基础接口。
 */
export interface BaseCase<S = Span | Origin, Pat = unknown, Body = unknown> extends BaseNode<S> {
  readonly kind: 'Case';
  readonly pattern: Pat;
  readonly body: Body;
}

/**
 * Start 异步任务基础接口。
 */
export interface BaseStart<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Start';
  readonly name: string;
  readonly expr: Expr;
}

/**
 * Wait 等待基础接口。
 */
export interface BaseWait<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Wait';
  readonly names: readonly string[];
}

/**
 * Workflow 语句基础接口。
 */
export interface BaseWorkflow<
  S = Span | Origin,
  StepStmt = unknown,
  Retry = unknown,
  Timeout = unknown
> extends BaseNode<S> {
  readonly kind: 'workflow';
  readonly steps: readonly StepStmt[];
  readonly retry?: Retry;
  readonly timeout?: Timeout;
}

/**
 * Step 语句基础接口。
 */
export interface BaseStep<S = Span | Origin, Block = unknown> extends BaseNode<S> {
  readonly kind: 'step';
  readonly name: string;
  readonly body: Block;
  readonly dependencies: readonly string[];
  readonly compensate?: Block;
}

/**
 * RetryPolicy 基础接口。
 */
export interface BaseRetryPolicy {
  readonly maxAttempts: number;
  readonly backoff: 'exponential' | 'linear';
}

/**
 * Timeout 基础接口。
 */
export interface BaseTimeout {
  readonly milliseconds: number;
}

// ============================================================
// 共享 Pattern 节点
// ============================================================

/**
 * Null 模式基础接口。
 */
export interface BasePatternNull<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'PatternNull' | 'PatNull';
}

/**
 * 构造器模式基础接口。
 */
export interface BasePatternCtor<S = Span | Origin, Pat = unknown> extends BaseNode<S> {
  readonly kind: 'PatternCtor' | 'PatCtor';
  readonly typeName: string;
  readonly names: readonly string[];
  readonly args?: readonly Pat[];
}

/**
 * 名称模式基础接口。
 */
export interface BasePatternName<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'PatternName' | 'PatName';
  readonly name: string;
}

/**
 * 整数模式基础接口。
 */
export interface BasePatternInt<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'PatternInt' | 'PatInt';
  readonly value: number;
}

// ============================================================
// 共享表达式节点
// ============================================================

/**
 * 名称表达式基础接口。
 */
export interface BaseName<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Name';
  readonly name: string;
}

/**
 * 布尔字面量基础接口。
 */
export interface BaseBool<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Bool';
  readonly value: boolean;
}

/**
 * 整数字面量基础接口。
 */
export interface BaseInt<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Int';
  readonly value: number;
}

/**
 * Long 字面量基础接口。
 *
 * **注意**: value 使用 string 类型存储以避免 JavaScript number 的精度损失。
 * Long 字面量可能超过 Number.MAX_SAFE_INTEGER (2^53-1)，例如 Long.MAX_VALUE (2^63-1)。
 */
export interface BaseLong<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Long';
  readonly value: string;
}

/**
 * 浮点数字面量基础接口。
 */
export interface BaseDouble<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Double';
  readonly value: number;
}

/**
 * 字符串字面量基础接口。
 */
export interface BaseString<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'String';
  readonly value: string;
}

/**
 * Null 字面量基础接口。
 */
export interface BaseNull<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'Null';
}

/**
 * 函数调用基础接口。
 */
export interface BaseCall<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Call';
  readonly target: Expr;
  readonly args: readonly Expr[];
}

/**
 * Lambda 表达式基础接口。
 */
export interface BaseLambda<S = Span | Origin, T = unknown, Block = unknown> extends BaseNode<S> {
  readonly kind: 'Lambda';
  readonly params: readonly BaseParameter<T>[];
  readonly retType: T;
  readonly body: Block;
}

/**
 * 构造器表达式基础接口。
 */
export interface BaseConstruct<S = Span | Origin, Field = unknown> extends BaseNode<S> {
  readonly kind: 'Construct';
  readonly typeName: string;
  readonly fields: readonly Field[];
}

/**
 * 构造器字段基础接口。
 */
export interface BaseConstructField<Expr = unknown> {
  readonly name: string;
  readonly expr: Expr;
}

/**
 * Ok 表达式基础接口。
 */
export interface BaseOk<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Ok';
  readonly expr: Expr;
}

/**
 * Err 表达式基础接口。
 */
export interface BaseErr<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Err';
  readonly expr: Expr;
}

/**
 * Some 表达式基础接口。
 */
export interface BaseSome<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Some';
  readonly expr: Expr;
}

/**
 * None 表达式基础接口。
 */
export interface BaseNone<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'None';
}

/**
 * Await 表达式基础接口。
 */
export interface BaseAwait<S = Span | Origin, Expr = unknown> extends BaseNode<S> {
  readonly kind: 'Await';
  readonly expr: Expr;
}

// ============================================================
// 共享类型节点
// ============================================================

/**
 * 类型名称基础接口。
 */
export interface BaseTypeName<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'TypeName';
  readonly name: string;
}

/**
 * 类型变量基础接口。
 */
export interface BaseTypeVar<S = Span | Origin> extends BaseNode<S> {
  readonly kind: 'TypeVar';
  readonly name: string;
}

/**
 * 类型应用基础接口。
 */
export interface BaseTypeApp<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'TypeApp';
  readonly base: string;
  readonly args: readonly T[];
}

/**
 * Maybe 类型基础接口。
 */
export interface BaseMaybe<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'Maybe';
  readonly type: T;
}

/**
 * Option 类型基础接口。
 */
export interface BaseOption<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'Option';
  readonly type: T;
}

/**
 * Result 类型基础接口。
 */
export interface BaseResult<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'Result';
  readonly ok: T;
  readonly err: T;
}

/**
 * List 类型基础接口。
 */
export interface BaseList<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'List';
  readonly type: T;
}

/**
 * Map 类型基础接口。
 */
export interface BaseMap<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'Map';
  readonly key: T;
  readonly val: T;
}

/**
 * 函数类型基础接口。
 */
export interface BaseFuncType<S = Span | Origin, T = unknown> extends BaseNode<S> {
  readonly kind: 'FuncType';
  readonly params: readonly T[];
  readonly ret: T;
}
