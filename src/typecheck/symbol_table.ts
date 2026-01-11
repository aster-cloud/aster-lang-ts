import type { Core, Span } from '../types.js';

type Type = Core.Type;

export type SymbolKind = 'var' | 'func' | 'data' | 'enum' | 'type_alias' | 'param';
export type ScopeType = 'module' | 'function' | 'block' | 'lambda';

export interface SymbolInfo {
  name: string;
  type: Type;
  kind: SymbolKind;
  mutable: boolean;
  span?: Span;
  captured?: boolean;
  shadowedFrom?: SymbolInfo;
}

export type Symbol = SymbolInfo;

export interface DefineOptions {
  mutable?: boolean;
  span?: Span;
  captured?: boolean;
  onShadow?: (current: SymbolInfo, shadowed: SymbolInfo) => void;
}

export class DuplicateSymbolError extends Error {
  readonly symbol: SymbolInfo;

  constructor(symbol: SymbolInfo) {
    super(`Duplicate symbol '${symbol.name}' declared in the same scope`);
    this.symbol = symbol;
  }
}

class Scope {
  private readonly symbols = new Map<string, SymbolInfo>();
  private readonly children: Scope[] = [];

  constructor(private readonly parentScope: Scope | null, private readonly scopeType: ScopeType) {}

  define(symbol: SymbolInfo): void {
    if (this.symbols.has(symbol.name)) {
      throw new DuplicateSymbolError(symbol);
    }
    const shadowed = this.findShadowed(symbol.name);
    if (shadowed) {
      symbol.shadowedFrom = shadowed;
    }
    this.symbols.set(symbol.name, symbol);
  }

  lookup(name: string): SymbolInfo | undefined {
    const local = this.symbols.get(name);
    if (local) return local;
    return this.parentScope?.lookup(name);
  }

  lookupLocal(name: string): SymbolInfo | undefined {
    return this.symbols.get(name);
  }

  findShadowed(name: string): SymbolInfo | undefined {
    return this.parentScope?.lookup(name);
  }

  enterScope(type: ScopeType): Scope {
    const child = new Scope(this, type);
    this.children.push(child);
    return child;
  }

  exitScope(): Scope | null {
    return this.parentScope;
  }

  markCaptured(name: string): void {
    const symbol = this.lookup(name);
    if (symbol) symbol.captured = true;
  }

  getCapturedSymbols(): SymbolInfo[] {
    return [...this.symbols.values()].filter(sym => sym.captured);
  }

  getParent(): Scope | null {
    return this.parentScope;
  }

  getType(): ScopeType {
    return this.scopeType;
  }
}

interface TypeAliasEntry {
  readonly type: Type;
  readonly span?: Span;
}

export class SymbolTable {
  private readonly root: Scope;
  private current: Scope;
  private readonly typeAliases = new Map<string, TypeAliasEntry>();
  private readonly aliasCache = new Map<string, Type>();

  constructor() {
    this.root = new Scope(null, 'module');
    this.current = this.root;
  }

  enterScope(type: ScopeType): void {
    this.current = this.current.enterScope(type);
  }

  exitScope(): void {
    const parent = this.current.exitScope();
    if (!parent) {
      throw new Error('Cannot exit root scope');
    }
    this.current = parent;
  }

  getCurrentScope(): Scope {
    return this.current;
  }

  define(name: string, type: Type, kind: SymbolKind, options: DefineOptions = {}): void {
    const symbol: SymbolInfo = {
      name,
      type,
      kind,
      mutable: options.mutable ?? false,
      ...(options.span !== undefined && { span: options.span }),
      captured: options.captured ?? false,
    };

    try {
      this.current.define(symbol);
    } catch (error) {
      if (error instanceof DuplicateSymbolError) {
        throw error;
      }
      throw error;
    }

    if (symbol.shadowedFrom && options.onShadow) {
      options.onShadow(symbol, symbol.shadowedFrom);
    }
  }

  lookup(name: string): SymbolInfo | undefined {
    return this.current.lookup(name);
  }

  lookupInCurrentScope(name: string): SymbolInfo | undefined {
    return this.current.lookupLocal(name);
  }

  markCaptured(name: string): void {
    this.current.markCaptured(name);
  }

  getCapturedSymbols(): SymbolInfo[] {
    return this.current.getCapturedSymbols();
  }

  defineTypeAlias(name: string, type: Type, span?: Span): void {
    if (this.typeAliases.has(name)) {
      throw new Error(`Duplicate type alias '${name}'`);
    }
    const entry = span !== undefined ? { type, span } : { type };
    this.typeAliases.set(name, entry);
    this.aliasCache.delete(name);
  }

  resolveTypeAlias(name: string): Type | undefined {
    if (this.aliasCache.has(name)) {
      return this.aliasCache.get(name);
    }
    const resolved = this.resolveAliasRecursive(name, new Set());
    if (resolved) {
      this.aliasCache.set(name, resolved);
    }
    return resolved;
  }

  getTypeAliases(): Map<string, Type> {
    return new Map([...this.typeAliases.entries()].map(([alias, entry]) => [alias, entry.type]));
  }

  private resolveAliasRecursive(name: string, stack: Set<string>): Type | undefined {
    const entry = this.typeAliases.get(name);
    if (!entry) return undefined;
    if (stack.has(name)) return undefined;
    stack.add(name);
    const expanded = this.expandAliasType(entry.type, stack);
    stack.delete(name);
    return expanded;
  }

  private expandAliasType(type: Type, stack: Set<string>): Type {
    switch (type.kind) {
      case 'TypeName': {
        const aliasName = type.name;
        if (this.typeAliases.has(aliasName)) {
          const resolved = this.resolveAliasRecursive(aliasName, stack);
          return resolved ?? type;
        }
        return type;
      }
      case 'Maybe':
        return {
          ...type,
          type: this.expandAliasType(type.type as Type, stack),
        };
      case 'Option':
        return {
          ...type,
          type: this.expandAliasType(type.type as Type, stack),
        };
      case 'Result':
        return {
          ...type,
          ok: this.expandAliasType(type.ok as Type, stack),
          err: this.expandAliasType(type.err as Type, stack),
        };
      case 'List':
        return {
          ...type,
          type: this.expandAliasType(type.type as Type, stack),
        };
      case 'Map':
        return {
          ...type,
          key: this.expandAliasType(type.key as Type, stack),
          val: this.expandAliasType(type.val as Type, stack),
        };
      case 'TypeApp':
        return {
          ...type,
          args: type.args.map(arg => this.expandAliasType(arg as Type, stack)) as readonly Core.Type[],
        };
      case 'FuncType':
        return {
          ...type,
          params: type.params.map(param => this.expandAliasType(param as Type, stack)) as readonly Core.Type[],
          ret: this.expandAliasType(type.ret as Type, stack),
        };
      case 'PiiType':
        return {
          ...type,
          baseType: this.expandAliasType(type.baseType as Type, stack),
        };
      default:
        return type;
    }
  }
}
