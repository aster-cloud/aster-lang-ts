// Simple AST node constructors
import type * as AST from '../types.js';

function createEmptySpan(): AST.Span {
  return {
    start: { line: 0, col: 0 },
    end: { line: 0, col: 0 },
  };
}

export const Node = {
  Module: (name: string | null, decls: readonly AST.Declaration[]): AST.Module => ({
    kind: 'Module',
    name,
    decls,
    span: createEmptySpan(),
  }),
  Import: (name: string, asName: string | null): AST.Import => ({
    kind: 'Import',
    name,
    asName,
    span: createEmptySpan(),
  }),
  Data: (name: string, fields: readonly AST.Field[]): AST.Data => ({
    kind: 'Data',
    name,
    fields,
    span: createEmptySpan(),
  }),
  Enum: (name: string, variants: readonly string[]): AST.Enum => ({
    kind: 'Enum',
    name,
    variants,
    span: createEmptySpan(),
  }),
  Func: (
    name: string,
    typeParams: readonly string[],
    params: readonly AST.Parameter[],
    retType: AST.Type,
    effects: readonly string[],
    effectCaps: readonly AST.CapabilityKind[],
    effectCapsExplicit: boolean,
    body: AST.Block | null,
    effectParams?: readonly string[]
  ): AST.Func => ({
    kind: 'Func',
    name,
    typeParams,
    params,
    retType,
    effects,
    effectCaps,
    effectCapsExplicit,
    body,
    ...(effectParams && effectParams.length > 0 ? { effectParams } : {}),
    span: createEmptySpan(),
  }),
  Block: (statements: readonly AST.Statement[]): AST.Block => ({
    kind: 'Block',
    statements,
    span: createEmptySpan(),
  }),
  Let: (name: string, expr: AST.Expression): AST.Let => ({
    kind: 'Let',
    name,
    expr,
    span: createEmptySpan(),
  }),
  Set: (name: string, expr: AST.Expression): AST.Set => ({
    kind: 'Set',
    name,
    expr,
    span: createEmptySpan(),
  }),
  Return: (expr: AST.Expression): AST.Return => ({
    kind: 'Return',
    expr,
    span: createEmptySpan(),
  }),
  If: (cond: AST.Expression, thenBlock: AST.Block, elseBlock: AST.Block | null): AST.If => ({
    kind: 'If',
    cond,
    thenBlock,
    elseBlock,
    span: createEmptySpan(),
  }),
  Match: (expr: AST.Expression, cases: readonly AST.Case[]): AST.Match => ({
    kind: 'Match',
    expr,
    cases,
    span: createEmptySpan(),
  }),
  Case: (pattern: AST.Pattern, body: AST.Return | AST.Block): AST.Case => ({
    kind: 'Case',
    pattern,
    body,
    span: createEmptySpan(),
  }),
  Start: (name: string, expr: AST.Expression): AST.Start => ({
    kind: 'Start',
    name,
    expr,
    span: createEmptySpan(),
  }),
  Wait: (names: readonly string[]): AST.Wait => ({
    kind: 'Wait',
    names,
    span: createEmptySpan(),
  }),
  Workflow: (
    steps: readonly AST.StepStmt[],
    retry?: AST.RetryPolicy,
    timeout?: AST.Timeout
  ): AST.WorkflowStmt => ({
    kind: 'workflow',
    steps,
    ...(retry !== undefined ? { retry } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    span: createEmptySpan(),
  }),
  Step: (
    name: string,
    body: AST.Block,
    compensate?: AST.Block,
    dependencies: readonly string[] = []
  ): AST.StepStmt => ({
    kind: 'step',
    name,
    body,
    dependencies,
    ...(compensate !== undefined ? { compensate } : {}),
    span: createEmptySpan(),
  }),

  // Expressions
  Name: (name: string): AST.Name => ({ kind: 'Name', name, span: createEmptySpan() }),
  Bool: (value: boolean): AST.Bool => ({ kind: 'Bool', value, span: createEmptySpan() }),
  Null: (): AST.Null => ({ kind: 'Null', span: createEmptySpan() }),
  Int: (value: number): AST.Int => ({ kind: 'Int', value, span: createEmptySpan() }),
  Long: (value: string): AST.Long => ({ kind: 'Long', value, span: createEmptySpan() }),
  Double: (value: number): AST.Double => ({ kind: 'Double', value, span: createEmptySpan() }),
  String: (value: string): AST.String => ({ kind: 'String', value, span: createEmptySpan() }),
  Call: (target: AST.Expression, args: readonly AST.Expression[]): AST.Call => ({
    kind: 'Call',
    target,
    args,
    span: createEmptySpan(),
  }),
  Construct: (typeName: string, fields: readonly AST.ConstructField[]): AST.Construct => ({
    kind: 'Construct',
    typeName,
    fields,
    span: createEmptySpan(),
  }),
  Ok: (expr: AST.Expression): AST.Ok => ({ kind: 'Ok', expr, span: createEmptySpan() }),
  Err: (expr: AST.Expression): AST.Err => ({ kind: 'Err', expr, span: createEmptySpan() }),
  Some: (expr: AST.Expression): AST.Some => ({ kind: 'Some', expr, span: createEmptySpan() }),
  None: (): AST.None => ({ kind: 'None', span: createEmptySpan() }),
  Lambda: (params: readonly AST.Parameter[], retType: AST.Type, body: AST.Block): AST.Lambda => ({
    kind: 'Lambda',
    params,
    retType,
    body,
    span: createEmptySpan(),
  }),
  Await: (expr: AST.Expression): AST.Await => ({ kind: 'Await', expr, span: createEmptySpan() }),

  // Types
  TypeName: (name: string): AST.TypeName => ({ kind: 'TypeName', name, annotations: [], span: createEmptySpan() }),
  Maybe: (type: AST.Type): AST.Maybe => ({ kind: 'Maybe', type, span: createEmptySpan() }),
  Option: (type: AST.Type): AST.Option => ({ kind: 'Option', type, span: createEmptySpan() }),
  Result: (ok: AST.Type, err: AST.Type): AST.Result => ({
    kind: 'Result',
    ok,
    err,
    span: createEmptySpan(),
  }),
  List: (type: AST.Type): AST.List => ({ kind: 'List', type, span: createEmptySpan() }),
  Map: (key: AST.Type, val: AST.Type): AST.Map => ({
    kind: 'Map',
    key,
    val,
    span: createEmptySpan(),
  }),
  TypeApp: (base: string, args: readonly AST.Type[]): AST.TypeApp => ({
    kind: 'TypeApp',
    base,
    args,
    span: createEmptySpan(),
  }),
  TypeVar: (name: string): AST.TypeVar => ({ kind: 'TypeVar', name, span: createEmptySpan() }),
  EffectVar: (name: string): AST.EffectVar => ({ kind: 'EffectVar', name, span: createEmptySpan() }),
  TypePii: (
    baseType: AST.Type,
    sensitivity: AST.PiiSensitivityLevel,
    category: AST.PiiDataCategory
  ): AST.TypePii => ({
    kind: 'TypePii',
    baseType,
    sensitivity,
    category,
    span: createEmptySpan(),
  }),

  PatternNull: (): AST.PatternNull => ({ kind: 'PatternNull', span: createEmptySpan() }),
  PatternCtor: (
    typeName: string,
    names: readonly string[],
    args?: readonly AST.Pattern[]
  ): AST.PatternCtor => ({
    kind: 'PatternCtor',
    typeName,
    names,
    span: createEmptySpan(),
    ...(args && args.length > 0 ? { args } : {}),
  }),
  PatternName: (name: string): AST.PatternName => ({ kind: 'PatternName', name, span: createEmptySpan() }),
  PatternInt: (value: number): AST.PatternInt => ({
    kind: 'PatternInt',
    value,
    span: createEmptySpan(),
  }),
};
