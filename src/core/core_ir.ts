// Core IR for Aster (distinct from CNL AST)

import { Effect } from '../types.js';
import type { Core as CoreTypes } from '../types.js';

export { Effect };

export const Core = {
  // Program structure
  Module: (name: string | null, decls: readonly CoreTypes.Declaration[]): CoreTypes.Module => ({
    kind: 'Module',
    name,
    decls,
  }),
  Import: (name: string, asName: string | null): CoreTypes.Import => ({
    kind: 'Import',
    name,
    asName,
  }),
  Data: (name: string, fields: readonly CoreTypes.Field[]): CoreTypes.Data => ({
    kind: 'Data',
    name,
    fields,
  }),
  Enum: (name: string, variants: readonly string[]): CoreTypes.Enum => ({
    kind: 'Enum',
    name,
    variants,
  }),
  Func: (
    name: string,
    typeParams: readonly string[] | undefined,
    params: readonly CoreTypes.Parameter[],
    ret: CoreTypes.Type,
    effects: readonly Effect[],
    body: CoreTypes.Block,
    effectCaps: readonly import('../types.js').CapabilityKind[] = [],
    effectCapsExplicit = false,
    effectParams?: readonly string[],
    declaredEffects?: readonly (Effect | CoreTypes.EffectVar)[]
  ): CoreTypes.Func => ({
    kind: 'Func',
    name,
    typeParams: (typeParams as readonly string[]) ?? [],
    params,
    ret,
    effects,
    effectCaps: [...effectCaps],
    effectCapsExplicit,
    body,
    ...(effectParams && effectParams.length > 0 ? { effectParams } : {}),
    ...(declaredEffects && declaredEffects.length > 0 ? { declaredEffects } : {}),
  }),
  Block: (statements: readonly CoreTypes.Statement[]): CoreTypes.Block => ({
    kind: 'Block',
    statements,
  }),
  Scope: (statements: readonly CoreTypes.Statement[]): CoreTypes.Scope => ({
    kind: 'Scope',
    statements,
  }),

  // Statements
  Let: (name: string, expr: CoreTypes.Expression): CoreTypes.Let => ({ kind: 'Let', name, expr }),
  Set: (name: string, expr: CoreTypes.Expression): CoreTypes.Set => ({ kind: 'Set', name, expr }),
  Return: (expr: CoreTypes.Expression): CoreTypes.Return => ({ kind: 'Return', expr }),
  If: (
    cond: CoreTypes.Expression,
    thenBlock: CoreTypes.Block,
    elseBlock: CoreTypes.Block | null
  ): CoreTypes.If => ({ kind: 'If', cond, thenBlock, elseBlock }),
  Match: (expr: CoreTypes.Expression, cases: readonly CoreTypes.Case[]): CoreTypes.Match => ({
    kind: 'Match',
    expr,
    cases,
  }),
  Case: (pattern: CoreTypes.Pattern, body: CoreTypes.Return | CoreTypes.Block): CoreTypes.Case => ({
    kind: 'Case',
    pattern,
    body,
  }),
  Start: (name: string, expr: CoreTypes.Expression): CoreTypes.Start => ({
    kind: 'Start',
    name,
    expr,
  }),
  Wait: (names: readonly string[]): CoreTypes.Wait => ({ kind: 'Wait', names }),
  Workflow: (
    steps: readonly CoreTypes.Step[],
    effectCaps: readonly import('../types.js').CapabilityKind[],
    retry?: CoreTypes.RetryPolicy,
    timeout?: CoreTypes.Timeout
  ): CoreTypes.Workflow => ({
    kind: 'workflow',
    steps,
    effectCaps: [...effectCaps],
    ...(retry ? { retry } : {}),
    ...(timeout ? { timeout } : {}),
  }),
  Step: (
    name: string,
    body: CoreTypes.Block,
    effectCaps: readonly import('../types.js').CapabilityKind[],
    compensate?: CoreTypes.Block,
    dependencies: readonly string[] = []
  ): CoreTypes.Step => ({
    kind: 'step',
    name,
    body,
    dependencies,
    effectCaps: [...effectCaps],
    ...(compensate ? { compensate } : {}),
  }),

  // Expressions
  Name: (name: string): CoreTypes.Name => ({ kind: 'Name', name }),
  Bool: (value: boolean): CoreTypes.Bool => ({ kind: 'Bool', value }),
  Int: (value: number): CoreTypes.Int => ({ kind: 'Int', value }),
  Long: (value: string): CoreTypes.Long => ({ kind: 'Long', value }),
  Double: (value: number): CoreTypes.Double => ({ kind: 'Double', value }),
  String: (value: string): CoreTypes.String => ({ kind: 'String', value }),
  Null: (): CoreTypes.Null => ({ kind: 'Null' }),
  Call: (target: CoreTypes.Expression, args: readonly CoreTypes.Expression[]): CoreTypes.Call => ({
    kind: 'Call',
    target,
    args,
  }),
  Construct: (
    typeName: string,
    fields: readonly CoreTypes.ConstructField[]
  ): CoreTypes.Construct => ({ kind: 'Construct', typeName, fields }),
  Ok: (expr: CoreTypes.Expression): CoreTypes.Ok => ({ kind: 'Ok', expr }),
  Err: (expr: CoreTypes.Expression): CoreTypes.Err => ({ kind: 'Err', expr }),
  Some: (expr: CoreTypes.Expression): CoreTypes.Some => ({ kind: 'Some', expr }),
  None: (): CoreTypes.None => ({ kind: 'None' }),

  // Types
  TypeName: (name: string): CoreTypes.TypeName => ({ kind: 'TypeName', name }),
  Maybe: (type: CoreTypes.Type): CoreTypes.Maybe => ({ kind: 'Maybe', type }),
  Option: (type: CoreTypes.Type): CoreTypes.Option => ({ kind: 'Option', type }),
  Result: (ok: CoreTypes.Type, err: CoreTypes.Type): CoreTypes.Result => ({
    kind: 'Result',
    ok,
    err,
  }),
  List: (type: CoreTypes.Type): CoreTypes.List => ({ kind: 'List', type }),
  Map: (key: CoreTypes.Type, val: CoreTypes.Type): CoreTypes.Map => ({ kind: 'Map', key, val }),
  TypeApp: (base: string, args: readonly CoreTypes.Type[]): CoreTypes.TypeApp => ({
    kind: 'TypeApp',
    base,
    args,
  }),
  TypeVar: (name: string): CoreTypes.TypeVar => ({ kind: 'TypeVar', name }),
  Pii: (
    baseType: CoreTypes.Type,
    sensitivity: 'L1' | 'L2' | 'L3',
    category: import('../types.js').PiiDataCategory
  ): CoreTypes.PiiType => ({
    kind: 'PiiType',
    baseType,
    sensitivity,
    category,
  }),

  // Patterns
  PatNull: (): CoreTypes.PatNull => ({ kind: 'PatNull' }),
  Await: (expr: CoreTypes.Expression): CoreTypes.Await => ({
    kind: 'Await',
    expr,
  }),
  PatCtor: (
    typeName: string,
    names: readonly string[] = [],
    args?: readonly CoreTypes.Pattern[]
  ): CoreTypes.PatCtor => ({
    kind: 'PatCtor',
    typeName,
    names,
    ...(args && args.length > 0 ? { args } : {}),
  }),
  PatName: (name: string): CoreTypes.PatName => ({ kind: 'PatName', name }),
  PatInt: (value: number): CoreTypes.PatInt => ({ kind: 'PatInt', value }),
};
