import type { Core, Span } from '../types.js';

export type Type = Core.Type;

const UNKNOWN_TYPENAME: Core.TypeName = { kind: 'TypeName', name: 'Unknown' };

function cloneType(type: Type): Type {
  switch (type.kind) {
    case 'TypeName':
    case 'TypeVar':
    case 'EffectVar':
      return { ...type };
    case 'Maybe':
    case 'Option':
    case 'List':
      return { ...type, type: cloneType(type.type as Type) };
    case 'Result':
      return {
        ...type,
        ok: cloneType(type.ok as Type),
        err: cloneType(type.err as Type),
      };
    case 'Map':
      return {
        ...type,
        key: cloneType(type.key as Type),
        val: cloneType(type.val as Type),
      };
    case 'TypeApp':
      return {
        ...type,
        args: type.args.map(arg => cloneType(arg as Type)) as readonly Core.Type[],
      };
    case 'FuncType':
      return {
        ...type,
        params: type.params.map(param => cloneType(param as Type)) as readonly Core.Type[],
        ret: cloneType(type.ret as Type),
        ...(type.effectParams ? { effectParams: [...type.effectParams] as readonly string[] } : {}),
        ...(type.declaredEffects
          ? { declaredEffects: [...type.declaredEffects] as readonly EffectDeclaration[] }
          : {}),
      };
    case 'PiiType':
      return {
        ...type,
        baseType: cloneType(type.baseType as Type),
      };
    default:
      // Exhaustiveness check: all Core.Type kinds should be handled above
      return type as Type;
  }
}

function isUnknown(type: Type | undefined | null): boolean {
  if (!type) return true;
  if (type.kind === 'TypeName' && type.name === 'Unknown') return true;
  return false;
}

type EffectDeclaration = NonNullable<Core.FuncType['declaredEffects']>[number];

function normalizeEffectList(list: readonly EffectDeclaration[] | undefined): readonly string[] {
  if (!list || list.length === 0) return [];
  return list.map(effect => String(effect));
}

function effectListsEqual(
  a: readonly EffectDeclaration[] | undefined,
  b: readonly EffectDeclaration[] | undefined
): boolean {
  const left = normalizeEffectList(a);
  const right = normalizeEffectList(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function stringListsEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = (a ?? []) as readonly string[];
  const right = (b ?? []) as readonly string[];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export class TypeSystem {
  static unknown(): Core.Type {
    return UNKNOWN_TYPENAME;
  }

  private static effectRank(type: Type): number | null {
    if (type.kind === 'EffectVar') return null;
    if (type.kind === 'TypeName') {
      switch (type.name) {
        case 'PURE':
          return 0;
        case 'CPU':
          return 1;
        case 'IO':
          return 2;
        case 'Workflow':
          return 3;
        default:
          return null;
      }
    }
    if (type.kind === 'TypeApp' && type.base === 'Workflow') return 3;
    return null;
  }

  static equals(t1: Type, t2: Type, strict = false): boolean {
    if (!strict && (isUnknown(t1) || isUnknown(t2))) return true;
    if (
      !strict &&
      t1.kind === 'TypeName' &&
      t2.kind === 'TypeName' &&
      ((t1.name === 'DateTime' && t2.name === 'Text') || (t1.name === 'Text' && t2.name === 'DateTime'))
    ) {
      return true;
    }
    if (t1.kind !== t2.kind) return false;
    switch (t1.kind) {
      case 'TypeName':
        return (t1 as Core.TypeName).name === (t2 as Core.TypeName).name;
      case 'TypeVar':
        return (t1 as Core.TypeVar).name === (t2 as Core.TypeVar).name;
      case 'EffectVar':
        return (t1 as Core.EffectVar).name === (t2 as Core.EffectVar).name;
      case 'TypeApp': {
        const a = t1 as Core.TypeApp;
        const b = t2 as Core.TypeApp;
        if (a.base !== b.base) return false;
        if (a.args.length !== b.args.length) return false;
        for (let i = 0; i < a.args.length; i++) {
          if (!TypeSystem.equals(a.args[i] as Type, b.args[i] as Type, strict)) return false;
        }
        return true;
      }
      case 'Maybe':
      case 'Option':
        return TypeSystem.equals(
          (t1 as Core.Maybe | Core.Option).type as Type,
          (t2 as Core.Maybe | Core.Option).type as Type,
          strict
        );
      case 'Result': {
        const a = t1 as Core.Result;
        const b = t2 as Core.Result;
        return (
          TypeSystem.equals(a.ok as Type, b.ok as Type, strict) &&
          TypeSystem.equals(a.err as Type, b.err as Type, strict)
        );
      }
      case 'List':
        return TypeSystem.equals(
          (t1 as Core.List).type as Type,
          (t2 as Core.List).type as Type,
          strict
        );
      case 'Map': {
        const a = t1 as Core.Map;
        const b = t2 as Core.Map;
        return (
          TypeSystem.equals(a.key as Type, b.key as Type, strict) &&
          TypeSystem.equals(a.val as Type, b.val as Type, strict)
        );
      }
      case 'FuncType': {
        const a = t1 as Core.FuncType;
        const b = t2 as Core.FuncType;
        if (a.params.length !== b.params.length) return false;
        for (let i = 0; i < a.params.length; i++) {
          if (!TypeSystem.equals(a.params[i] as Type, b.params[i] as Type, strict)) return false;
        }
        if (!stringListsEqual(a.effectParams, b.effectParams)) return false;
        if (!effectListsEqual(a.declaredEffects, b.declaredEffects)) return false;
        return TypeSystem.equals(a.ret as Type, b.ret as Type, strict);
      }
      case 'PiiType': {
        const a = t1 as Core.PiiType;
        const b = t2 as Core.PiiType;
        return (
          a.sensitivity === b.sensitivity &&
          a.category === b.category &&
          TypeSystem.equals(a.baseType as Type, b.baseType as Type, strict)
        );
      }
      default:
        return false;
    }
  }

  static unify(t1: Type, t2: Type, bindings: Map<string, Type> = new Map()): boolean {
    if (isUnknown(t1) || isUnknown(t2)) return true;

    if (t1.kind === 'TypeVar') {
      return TypeSystem.bindTypeVar(t1 as Core.TypeVar, t2, bindings);
    }
    if (t2.kind === 'TypeVar') {
      return TypeSystem.bindTypeVar(t2 as Core.TypeVar, t1, bindings);
    }
    if (t1.kind === 'EffectVar') {
      return TypeSystem.bindEffectVar(t1 as Core.EffectVar, t2, bindings);
    }
    if (t2.kind === 'EffectVar') {
      return TypeSystem.bindEffectVar(t2 as Core.EffectVar, t1, bindings);
    }
    if (t1.kind !== t2.kind) return false;

    switch (t1.kind) {
      case 'Maybe':
      case 'Option':
        return TypeSystem.unify(
          (t1 as Core.Maybe | Core.Option).type as Type,
          (t2 as Core.Maybe | Core.Option).type as Type,
          bindings
        );
      case 'Result': {
        const a = t1 as Core.Result;
        const b = t2 as Core.Result;
        return (
          TypeSystem.unify(a.ok as Type, b.ok as Type, bindings) &&
          TypeSystem.unify(a.err as Type, b.err as Type, bindings)
        );
      }
      case 'List':
        return TypeSystem.unify(
          (t1 as Core.List).type as Type,
          (t2 as Core.List).type as Type,
          bindings
        );
      case 'Map': {
        const a = t1 as Core.Map;
        const b = t2 as Core.Map;
        return (
          TypeSystem.unify(a.key as Type, b.key as Type, bindings) &&
          TypeSystem.unify(a.val as Type, b.val as Type, bindings)
        );
      }
      case 'TypeApp': {
        const a = t1 as Core.TypeApp;
        const b = t2 as Core.TypeApp;
        if (a.base !== b.base) return false;
        if (a.args.length !== b.args.length) return false;
        for (let i = 0; i < a.args.length; i++) {
          if (!TypeSystem.unify(a.args[i] as Type, b.args[i] as Type, bindings)) return false;
        }
        return true;
      }
      case 'FuncType': {
        const a = t1 as Core.FuncType;
        const b = t2 as Core.FuncType;
        if (a.params.length !== b.params.length) return false;
        for (let i = 0; i < a.params.length; i++) {
          if (!TypeSystem.unify(a.params[i] as Type, b.params[i] as Type, bindings)) return false;
        }
        if (!stringListsEqual(a.effectParams, b.effectParams)) return false;
        if (!effectListsEqual(a.declaredEffects, b.declaredEffects)) return false;
        return TypeSystem.unify(a.ret as Type, b.ret as Type, bindings);
      }
      case 'PiiType': {
        const a = t1 as Core.PiiType;
        const b = t2 as Core.PiiType;
        if (a.sensitivity !== b.sensitivity || a.category !== b.category) return false;
        return TypeSystem.unify(a.baseType as Type, b.baseType as Type, bindings);
      }
      default:
        return TypeSystem.equals(t1, t2, true);
    }
  }

  private static bindTypeVar(tv: Core.TypeVar, type: Type, bindings: Map<string, Type>): boolean {
    const name = tv.name;
    const current = bindings.get(name);
    if (!current) {
      bindings.set(name, type);
      return true;
    }
    return TypeSystem.equals(current, type);
  }

  private static bindEffectVar(ev: Core.EffectVar, type: Type, bindings: Map<string, Type>): boolean {
    const key = `$effect:${ev.name}`;
    const current = bindings.get(key);
    if (!current) {
      bindings.set(key, type);
      return true;
    }
    const rankA = TypeSystem.effectRank(current);
    const rankB = TypeSystem.effectRank(type);
    if (rankA !== null && rankB !== null) {
      return rankA === rankB;
    }
    return TypeSystem.equals(current, type, true);
  }

  static isSubtype(sub: Type, sup: Type): boolean {
    if (TypeSystem.equals(sub, sup)) return true;
    if (isUnknown(sup)) return true;
    if (isUnknown(sub)) return false;

    const leftEffect = TypeSystem.effectRank(sub);
    const rightEffect = TypeSystem.effectRank(sup);
    if (leftEffect !== null && rightEffect !== null) {
      return leftEffect <= rightEffect;
    }

    // Option<T> and Maybe<T> are considered subtypes when inner types match.
    if (sup.kind === 'Option' && sub.kind === 'Maybe') {
      return TypeSystem.isSubtype((sub as Core.Maybe).type as Type, (sup as Core.Option).type as Type);
    }
    if (sup.kind === 'Maybe' && sub.kind === 'Option') {
      return TypeSystem.isSubtype((sub as Core.Option).type as Type, (sup as Core.Maybe).type as Type);
    }

    // Result<T, E> subtyping checks both components.
    if (sub.kind === 'Result' && sup.kind === 'Result') {
      const s = sub as Core.Result;
      const t = sup as Core.Result;
      return (
        TypeSystem.isSubtype(s.ok as Type, t.ok as Type) &&
        TypeSystem.isSubtype(s.err as Type, t.err as Type)
      );
    }

    if (sub.kind === 'TypeApp' && sup.kind === 'TypeApp') {
      const s = sub as Core.TypeApp;
      const t = sup as Core.TypeApp;
      if (s.base === 'Workflow' && t.base === 'Workflow' && s.args.length >= 2 && t.args.length >= 2) {
        const [sRes, sEff] = s.args;
        const [tRes, tEff] = t.args;
        return TypeSystem.isSubtype(sRes as Type, tRes as Type) && TypeSystem.isSubtype(sEff as Type, tEff as Type);
      }
    }

    return false;
  }

  static expand(type: Type, aliases: Map<string, Type>): Type {
    const visited = new Set<string>();
    return TypeSystem.expandRecursive(type, aliases, visited);
  }

  private static expandRecursive(type: Type, aliases: Map<string, Type>, visited: Set<string>): Type {
    if (type.kind === 'TypeName') {
      const alias = aliases.get(type.name);
      if (!alias) return type;
      if (visited.has(type.name)) return type;
      visited.add(type.name);
      const expanded = TypeSystem.expandRecursive(alias, aliases, visited);
      visited.delete(type.name);
      return expanded;
    }
    if (type.kind === 'Maybe' || type.kind === 'Option' || type.kind === 'List') {
      return {
        ...type,
        type: TypeSystem.expandRecursive(type.type as Type, aliases, visited),
      };
    }
    if (type.kind === 'Result') {
      return {
        ...type,
        ok: TypeSystem.expandRecursive(type.ok as Type, aliases, visited),
        err: TypeSystem.expandRecursive(type.err as Type, aliases, visited),
      };
    }
    if (type.kind === 'Map') {
      return {
        ...type,
        key: TypeSystem.expandRecursive(type.key as Type, aliases, visited),
        val: TypeSystem.expandRecursive(type.val as Type, aliases, visited),
      };
    }
    if (type.kind === 'TypeApp') {
      return {
        ...type,
        args: type.args.map(arg => TypeSystem.expandRecursive(arg as Type, aliases, visited)) as readonly Core.Type[],
      };
    }
    if (type.kind === 'FuncType') {
      return {
        ...type,
        params: type.params.map(param => TypeSystem.expandRecursive(param as Type, aliases, visited)) as readonly Core.Type[],
        ret: TypeSystem.expandRecursive(type.ret as Type, aliases, visited),
      };
    }
    if (type.kind === 'PiiType') {
      return {
        ...type,
        baseType: TypeSystem.expandRecursive(type.baseType as Type, aliases, visited),
      };
    }
    return type;
  }

  static inferListElementType(elements: readonly Core.Expression[]): Type {
    const elementTypes: Type[] = [];
    for (const element of elements) {
      const inferred = TypeSystem.inferStaticType(element);
      if (inferred) elementTypes.push(inferred);
    }
    if (elementTypes.length === 0) return TypeSystem.unknown();
    const current = cloneType(elementTypes[0]!);
    for (let i = 1; i < elementTypes.length; i++) {
      if (!TypeSystem.equals(current, elementTypes[i]!)) {
        return TypeSystem.unknown();
      }
    }
    return current;
  }

  static inferFunctionType(params: readonly Core.Parameter[], body: readonly Core.Statement[]): Core.FuncType {
    const paramTypes = params.map(p => cloneType(p.type as Type)) as readonly Core.Type[];
    const ret = TypeSystem.inferReturnType(body);
    return {
      kind: 'FuncType',
      params: paramTypes,
      ret,
    };
  }

  static format(type: Type | undefined | null): string {
    if (!type) return 'Unknown';
    switch (type.kind) {
      case 'TypeName':
        return type.name;
      case 'TypeVar':
        return type.name;
      case 'TypeApp':
        if (type.base === 'Workflow' && type.args.length === 2) {
          const [resultType, effectRow] = type.args;
          return `Workflow<${TypeSystem.format(resultType as Type)}, ${TypeSystem.format(effectRow as Type)}>`;
        }
        return `${type.base}<${type.args.map(arg => TypeSystem.format(arg as Type)).join(', ')}>`;
      case 'Maybe':
        return `${TypeSystem.format(type.type as Type)}?`;
      case 'Option':
        return `Option<${TypeSystem.format(type.type as Type)}>`;
      case 'Result':
        return `Result<${TypeSystem.format(type.ok as Type)}, ${TypeSystem.format(type.err as Type)}>`;
      case 'List':
        return `List<${TypeSystem.format(type.type as Type)}>`;
      case 'Map':
        return `Map<${TypeSystem.format(type.key as Type)}, ${TypeSystem.format(type.val as Type)}>`;
      case 'FuncType':
        return `(${type.params.map(param => TypeSystem.format(param as Type)).join(', ')}) -> ${TypeSystem.format(type.ret as Type)}`;
      case 'PiiType':
        return `@pii(${type.sensitivity}, ${type.category}) ${TypeSystem.format(type.baseType as Type)}`;
      default:
        return 'Unknown';
    }
  }

  private static inferReturnType(body: readonly Core.Statement[]): Type {
    for (let i = body.length - 1; i >= 0; i--) {
      const stmt = body[i]!;
      if (stmt.kind === 'Return') {
        const ret = TypeSystem.inferStaticType(stmt.expr);
        return ret ?? TypeSystem.unknown();
      }
    }
    return TypeSystem.unknown();
  }

  private static inferStaticType(expr: Core.Expression | undefined | null): Type | null {
    if (!expr) return null;
    switch (expr.kind) {
      case 'Bool':
        return { kind: 'TypeName', name: 'Bool' };
      case 'Int':
        return { kind: 'TypeName', name: 'Int' };
      case 'Long':
        return { kind: 'TypeName', name: 'Long' };
      case 'Double':
        return { kind: 'TypeName', name: 'Double' };
      case 'String':
        return { kind: 'TypeName', name: 'Text' };
      case 'Null':
        return { kind: 'Maybe', type: TypeSystem.unknown() };
      case 'Ok': {
        const inner = TypeSystem.inferStaticType(expr.expr) ?? TypeSystem.unknown();
        return { kind: 'Result', ok: inner, err: TypeSystem.unknown() };
      }
      case 'Err': {
        const inner = TypeSystem.inferStaticType(expr.expr) ?? TypeSystem.unknown();
        return { kind: 'Result', ok: TypeSystem.unknown(), err: inner };
      }
      case 'Some': {
        const inner = TypeSystem.inferStaticType(expr.expr) ?? TypeSystem.unknown();
        return { kind: 'Option', type: inner };
      }
      case 'None':
        return { kind: 'Option', type: TypeSystem.unknown() };
      case 'Lambda': {
        const params = expr.params.map(p => cloneType(p.type as Type)) as readonly Core.Type[];
        const ret = cloneType(expr.ret as Type);
        return {
          kind: 'FuncType',
          params,
          ret,
        };
      }
      case 'Construct':
        return { kind: 'TypeName', name: expr.typeName };
      case 'Call': {
        if (expr.target.kind === 'Name') {
          switch (expr.target.name) {
            case 'Text.concat':
            case 'Crypto.hash':
            case 'Int.toString':
            case 'Bool.toString':
              return { kind: 'TypeName', name: 'Text' };
            case 'Text.length':
              return { kind: 'TypeName', name: 'Int' };
          }
        }
        return null;
      }
      default: {
        const annotated = (expr as { inferredType?: Type }).inferredType;
        if (annotated) return annotated;
        return null;
      }
    }
  }
}

export interface TypeConstraint {
  kind: 'equals' | 'subtype';
  left: Type;
  right: Type;
  span?: Span;
}

export class ConstraintSolver {
  private readonly constraints: TypeConstraint[] = [];

  addConstraint(constraint: TypeConstraint): void {
    this.constraints.push(constraint);
  }

  solve(): Map<string, Type> | null {
    const bindings = new Map<string, Type>();
    for (const constraint of this.constraints) {
      switch (constraint.kind) {
        case 'equals': {
          if (!TypeSystem.unify(constraint.left, constraint.right, bindings)) return null;
          break;
        }
        case 'subtype': {
          if (!TypeSystem.isSubtype(constraint.left, constraint.right)) return null;
          break;
        }
      }
    }
    return bindings;
  }
}
