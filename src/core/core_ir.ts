// Core IR for Aster (distinct from CNL AST)
//
// Core IR v2（ADR 0055）构造函数：每个构造函数都输出该节点的全部字段（#19 恒输出：标量与对象用
// null，列表用 []，布尔用 false）。带 kind 的节点必有 origin（#17）；构造时先填 NO_ORIGIN，
// lowering 的 withOrigin 再换成源码位置。NO_ORIGIN 的行号为 0（真实行号从 1 开始），
// 所以 lowering 漏挂 origin 能被测试发现（test/unit/lowering/core-ir-v2.test.ts 的 every_node_has_origin）。

import { Effect } from '../types.js';
import type { Core as CoreTypes } from '../types.js';

export { Effect };

/** 尚未挂上源码位置的占位 origin（行列号 0）。只用于构造阶段与类型检查合成的节点。 */
export const NO_ORIGIN: CoreTypes.Origin = Object.freeze({
  file: null,
  start: Object.freeze({ line: 0, col: 0 }),
  end: Object.freeze({ line: 0, col: 0 }),
  written: null,
  role: null,
});

/** 判断 origin 是否仍是占位值。 */
export function isNoOrigin(origin: CoreTypes.Origin): boolean {
  return origin.start.line === 0;
}

/** Core IR v2 的 schemaVersion（ADR 0055 #1）。 */
export const CORE_IR_SCHEMA_VERSION = 2 as const;

type Caps = readonly string[];

export const Core = {
  // Program structure
  Module: (name: string | null, decls: readonly CoreTypes.Declaration[], profile: string | null = null): CoreTypes.Module => ({
    kind: 'Module',
    schemaVersion: CORE_IR_SCHEMA_VERSION,
    name,
    profile,
    decls,
    origin: NO_ORIGIN,
  }),
  /** ADR 0055 #2：path 为点分模块路径，alias 为绑定名，version 为钉住的版本（均可空）。 */
  Import: (path: string, alias: string | null, version: number | null = null): CoreTypes.Import => ({
    kind: 'Import',
    path,
    alias,
    version,
    origin: NO_ORIGIN,
  }),
  Data: (name: string, fields: readonly CoreTypes.Field[]): CoreTypes.Data => ({
    kind: 'Data',
    name,
    fields,
    origin: NO_ORIGIN,
  }),
  Field: (
    name: string,
    type: CoreTypes.Type,
    constraints: readonly CoreTypes.Constraint[] = [],
    typeInferred = false
  ): CoreTypes.Field => ({ name, type, annotations: [], constraints, typeInferred }),
  Param: (
    name: string,
    type: CoreTypes.Type,
    constraints: readonly CoreTypes.Constraint[] = [],
    typeInferred = false
  ): CoreTypes.Parameter => ({ name, type, annotations: [], constraints, typeInferred }),
  Enum: (name: string, variants: readonly string[]): CoreTypes.Enum => ({
    kind: 'Enum',
    name,
    variants,
    origin: NO_ORIGIN,
  }),
  Func: (
    name: string,
    typeParams: readonly string[] | undefined,
    params: readonly CoreTypes.Parameter[],
    ret: CoreTypes.Type,
    effects: readonly string[],
    body: CoreTypes.Block,
    effectCaps: Caps = [],
    effectCapsExplicit = false,
    effectParams: readonly string[] = [],
    annotations: readonly CoreTypes.Annotation[] = []
  ): CoreTypes.Func => ({
    kind: 'Func',
    name,
    typeParams: typeParams ?? [],
    params,
    ret,
    retTypeInferred: false,
    annotations,
    retAnnotations: [],
    effects,
    effectParams,
    effectCaps: [...effectCaps],
    effectCapsExplicit,
    inputRefs: null,
    body,
    origin: NO_ORIGIN,
  }),
  Block: (statements: readonly CoreTypes.Statement[]): CoreTypes.Block => ({
    kind: 'Block',
    statements,
    origin: NO_ORIGIN,
  }),
  Scope: (statements: readonly CoreTypes.Statement[]): CoreTypes.Scope => ({
    kind: 'Scope',
    statements,
    origin: NO_ORIGIN,
  }),

  // Constraints（ADR 0055 #4：Range 两端为规范十进制串）
  Required: (): CoreTypes.ConstraintRequired => ({ kind: 'Required', origin: NO_ORIGIN }),
  Range: (min: string | null, max: string | null): CoreTypes.ConstraintRange => ({
    kind: 'Range',
    min,
    max,
    origin: NO_ORIGIN,
  }),
  Pattern: (regexp: string): CoreTypes.ConstraintPattern => ({ kind: 'Pattern', regexp, origin: NO_ORIGIN }),

  // Statements
  Let: (name: string, expr: CoreTypes.Expression): CoreTypes.Let => ({ kind: 'Let', name, expr, origin: NO_ORIGIN }),
  Set: (name: string, expr: CoreTypes.Expression): CoreTypes.Set => ({ kind: 'Set', name, expr, origin: NO_ORIGIN }),
  Return: (expr: CoreTypes.Expression): CoreTypes.Return => ({ kind: 'Return', expr, origin: NO_ORIGIN }),
  If: (
    cond: CoreTypes.Expression,
    thenBlock: CoreTypes.Block,
    elseBlock: CoreTypes.Block | null
  ): CoreTypes.If => ({ kind: 'If', cond, thenBlock, elseBlock, origin: NO_ORIGIN }),
  Match: (expr: CoreTypes.Expression, cases: readonly CoreTypes.Case[]): CoreTypes.Match => ({
    kind: 'Match',
    expr,
    cases,
    origin: NO_ORIGIN,
  }),
  Case: (pattern: CoreTypes.Pattern, body: CoreTypes.Return | CoreTypes.Block): CoreTypes.Case => ({
    kind: 'Case',
    pattern,
    body,
    origin: NO_ORIGIN,
  }),
  Start: (name: string, expr: CoreTypes.Expression): CoreTypes.Start => ({
    kind: 'Start',
    name,
    expr,
    origin: NO_ORIGIN,
  }),
  Wait: (names: readonly string[]): CoreTypes.Wait => ({ kind: 'Wait', names, origin: NO_ORIGIN }),
  Workflow: (
    steps: readonly CoreTypes.Step[],
    effectCaps: Caps,
    retry: CoreTypes.RetryPolicy | null = null,
    timeout: CoreTypes.Timeout | null = null
  ): CoreTypes.Workflow => ({
    kind: 'workflow',
    steps,
    effectCaps: [...effectCaps],
    retry,
    timeout,
    origin: NO_ORIGIN,
  }),
  Step: (
    name: string,
    body: CoreTypes.Block,
    effectCaps: Caps,
    compensate: CoreTypes.Block | null = null,
    dependencies: readonly string[] = []
  ): CoreTypes.Step => ({
    kind: 'step',
    name,
    body,
    compensate,
    dependencies,
    effectCaps: [...effectCaps],
    origin: NO_ORIGIN,
  }),

  // Expressions
  Name: (name: string): CoreTypes.Name => ({ kind: 'Name', name, origin: NO_ORIGIN }),
  Bool: (value: boolean): CoreTypes.Bool => ({ kind: 'Bool', value, origin: NO_ORIGIN }),
  Int: (value: number): CoreTypes.Int => ({ kind: 'Int', value, origin: NO_ORIGIN }),
  Long: (value: string): CoreTypes.Long => ({ kind: 'Long', value, origin: NO_ORIGIN }),
  /** ADR 0055 #18：value 是规范十进制串（由 lowering 从字面量原文求出）。 */
  Double: (value: string): CoreTypes.Double => ({ kind: 'Double', value, origin: NO_ORIGIN }),
  Decimal: (value: string): CoreTypes.Decimal => ({ kind: 'Decimal', value, origin: NO_ORIGIN }),
  String: (value: string): CoreTypes.String => ({ kind: 'String', value, origin: NO_ORIGIN }),
  Null: (): CoreTypes.Null => ({ kind: 'Null', origin: NO_ORIGIN }),
  Call: (target: CoreTypes.Expression, args: readonly CoreTypes.Expression[]): CoreTypes.Call => ({
    kind: 'Call',
    target,
    args,
    origin: NO_ORIGIN,
  }),
  Construct: (
    typeName: string,
    fields: readonly CoreTypes.ConstructField[]
  ): CoreTypes.Construct => ({ kind: 'Construct', typeName, fields, origin: NO_ORIGIN }),
  Ok: (expr: CoreTypes.Expression): CoreTypes.Ok => ({ kind: 'Ok', expr, origin: NO_ORIGIN }),
  Err: (expr: CoreTypes.Expression): CoreTypes.Err => ({ kind: 'Err', expr, origin: NO_ORIGIN }),
  Some: (expr: CoreTypes.Expression): CoreTypes.Some => ({ kind: 'Some', expr, origin: NO_ORIGIN }),
  None: (): CoreTypes.None => ({ kind: 'None', origin: NO_ORIGIN }),
  Lambda: (
    params: readonly CoreTypes.Parameter[],
    ret: CoreTypes.Type,
    body: CoreTypes.Block,
    captures: readonly string[] = []
  ): CoreTypes.Lambda => ({ kind: 'Lambda', params, ret, body, captures, origin: NO_ORIGIN }),
  Await: (expr: CoreTypes.Expression): CoreTypes.Await => ({
    kind: 'Await',
    expr,
    origin: NO_ORIGIN,
  }),
  // ADR 0019 G2b：表达式级 if（kind="IfExpr"，与 core/truffle 对齐）。
  IfExpr: (
    cond: CoreTypes.Expression,
    thenE: CoreTypes.Expression,
    elseE: CoreTypes.Expression,
  ): CoreTypes.IfExpr => ({
    kind: 'IfExpr',
    cond,
    thenE,
    elseE,
    origin: NO_ORIGIN,
  }),
  // ADR 0024 C0：列表字面量（kind="ListLit"，与 Java CoreModel.ListE 对齐）。
  ListLit: (elements: readonly CoreTypes.Expression[]): CoreTypes.ListLit => ({
    kind: 'ListLit',
    elements,
    origin: NO_ORIGIN,
  }),

  // Types
  TypeName: (name: string): CoreTypes.TypeName => ({ kind: 'TypeName', name, origin: NO_ORIGIN }),
  Maybe: (type: CoreTypes.Type): CoreTypes.Maybe => ({ kind: 'Maybe', type, origin: NO_ORIGIN }),
  Option: (type: CoreTypes.Type): CoreTypes.Option => ({ kind: 'Option', type, origin: NO_ORIGIN }),
  Result: (ok: CoreTypes.Type, err: CoreTypes.Type): CoreTypes.Result => ({
    kind: 'Result',
    ok,
    err,
    origin: NO_ORIGIN,
  }),
  List: (type: CoreTypes.Type): CoreTypes.List => ({ kind: 'List', type, origin: NO_ORIGIN }),
  Map: (key: CoreTypes.Type, val: CoreTypes.Type): CoreTypes.Map => ({ kind: 'Map', key, val, origin: NO_ORIGIN }),
  TypeApp: (base: string, args: readonly CoreTypes.Type[]): CoreTypes.TypeApp => ({
    kind: 'TypeApp',
    base,
    args,
    origin: NO_ORIGIN,
  }),
  /** 与 Java CoreModel.FuncType 一致：只有 params / ret，不带 effects */
  FuncType: (params: readonly CoreTypes.Type[], ret: CoreTypes.Type): CoreTypes.FuncType => ({
    kind: 'FuncType',
    params,
    ret,
    origin: NO_ORIGIN,
  }),
  TypeVar: (name: string): CoreTypes.TypeVar => ({ kind: 'TypeVar', name, origin: NO_ORIGIN }),
  Pii: (baseType: CoreTypes.Type, sensitivity: string, category: string): CoreTypes.PiiType => ({
    kind: 'PiiType',
    baseType,
    sensitivity,
    category,
    origin: NO_ORIGIN,
  }),

  // Patterns
  PatNull: (): CoreTypes.PatNull => ({ kind: 'PatNull', origin: NO_ORIGIN }),
  /** ADR 0055 #15、#16：构造器 / 枚举变体模式只用 args（嵌套模式），0 参变体为 args:[]。 */
  PatCtor: (typeName: string, args: readonly CoreTypes.Pattern[] = []): CoreTypes.PatCtor => ({
    kind: 'PatCtor',
    typeName,
    args,
    origin: NO_ORIGIN,
  }),
  PatName: (name: string): CoreTypes.PatName => ({ kind: 'PatName', name, origin: NO_ORIGIN }),
  PatInt: (value: number): CoreTypes.PatInt => ({ kind: 'PatInt', value, origin: NO_ORIGIN }),
};
