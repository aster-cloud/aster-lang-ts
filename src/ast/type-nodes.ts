/**
 * AST 类型树遍历（名称解析与格式化器共用）。
 *
 * 判断函数的类型参数是显式 `of T` 还是解析器推断的隐式参数，两处都要看签名里的
 * 类型写法；共用同一遍历，避免两套递归各自漏掉新类型节点（如 FuncType）。
 */
import type { Func, Span, Type } from '../types.js';

/** 直接子类型（不含自身） */
function childTypes(t: Type): readonly Type[] {
  switch (t.kind) {
    case 'TypeApp':
      return t.args;
    case 'Maybe':
    case 'Option':
    case 'List':
      return [t.type];
    case 'Result':
      return [t.ok, t.err];
    case 'Map':
      return [t.key, t.val];
    case 'FuncType':
      return [...t.params, t.ret];
    case 'TypePii':
      return [t.baseType];
    case 'TypeName':
    case 'TypeVar':
    case 'EffectVar':
      return [];
    default: {
      const never: never = t;
      throw new Error(`未处理的类型节点：${JSON.stringify(never)}`);
    }
  }
}

/** 先序遍历类型树的全部节点（含自身） */
export function* typeNodes(t: Type): Generator<Type> {
  yield t;
  for (const child of childTypes(t)) yield* typeNodes(child);
}

/** 函数签名中类型参数相关的写法 */
export interface SignatureTypeNames {
  /** 以 TypeVar 出现的名字：只有显式 `of T` 的使用才会解析成 TypeVar */
  readonly typeVars: ReadonlySet<string>;
  /** 以 TypeName 出现的名字及其第一处位置：隐式类型参数全部来自这里 */
  readonly firstTypeNameUse: ReadonlyMap<string, Span>;
}

/** 收集签名（参数类型 + 返回类型）中的 TypeVar 与 TypeName 写法 */
export function signatureTypeNames(f: Pick<Func, 'params' | 'retType'>): SignatureTypeNames {
  const typeVars = new Set<string>();
  const firstTypeNameUse = new Map<string, Span>();
  for (const root of [...f.params.map((p) => p.type), f.retType]) {
    for (const t of typeNodes(root)) {
      if (t.kind === 'TypeVar') typeVars.add(t.name);
      else if (t.kind === 'TypeName' && !firstTypeNameUse.has(t.name)) firstTypeNameUse.set(t.name, t.span);
    }
  }
  return { typeVars, firstTypeNameUse };
}

/**
 * 类型参数是否显式声明（`of T`）。隐式参数由解析器从签名里的 TypeName 推断，
 * 所以：签名里以 TypeVar 出现，或签名里根本没有它的 TypeName 写法（只在函数体内使用、
 * 或未使用）的，都只能来自显式 `of`。
 */
export function isExplicitTypeParam(names: SignatureTypeNames, name: string): boolean {
  return names.typeVars.has(name) || !names.firstTypeNameUse.has(name);
}
