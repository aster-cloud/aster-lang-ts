import type { Core, TypecheckDiagnostic, Origin } from '../types.js';
import { Effect } from '../types.js';
import { getIOPrefixes, getCPUPrefixes } from '../config/effect_config.js';
import { DefaultCoreVisitor, createVisitorContext } from '../core/visitor.js';
import { resolveAlias } from '../typecheck.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { EffectSignature } from './effect_signature.js';
import { ModuleCache, cacheModuleEffectSignatures } from '../lsp/module_cache.js';

export interface EffectConstraint {
  caller: string;
  callee: string;
  location?: Origin;
}

interface FunctionAnalysis {
  constraints: EffectConstraint[];
  localEffects: Set<Effect>;
}

type EffectAtom = Effect | 'Workflow';
type EffectRef = EffectAtom | { kind: 'EffectVar'; name: string };
type EffectBinding = { value: EffectAtom; resolved: boolean };
type EffectBindingTable = Map<string, Map<string, EffectBinding>>;
type EffectSetMap = Map<string, Set<EffectRef>>;

function effectRank(atom: EffectAtom): number {
  switch (atom) {
    case Effect.PURE:
      return 0;
    case Effect.CPU:
      return 1;
    case Effect.IO:
      return 2;
    default:
      return 3;
  }
}

function strongerEffect(a: EffectAtom, b: EffectAtom): EffectAtom {
  return effectRank(a) >= effectRank(b) ? a : b;
}

export interface EffectInferenceOptions {
  moduleName?: string;
  moduleUri?: string | null;
  imports?: Map<string, string>;
  importedEffects?: Map<string, EffectSignature>;
  moduleCache?: ModuleCache;
}

export function inferEffects(core: Core.Module, options?: EffectInferenceOptions): TypecheckDiagnostic[] {
  const ioPrefixes = getIOPrefixes();
  const cpuPrefixes = getCPUPrefixes();
  const funcIndex = new Map<string, Core.Func>();
  for (const decl of core.decls) {
    if (decl.kind === 'Func') funcIndex.set(decl.name, decl);
  }

  const constraints: EffectConstraint[] = [];
  const declaredEffects: EffectSetMap = new Map();
  const inferredEffects: EffectSetMap = new Map();
  const requiredEffects: EffectSetMap = new Map();
  const effectParams = new Map<string, Set<string>>();
  const bindings: EffectBindingTable = new Map();

  // 第一遍：收集局部效果和约束
  for (const func of funcIndex.values()) {
    const analysis = analyzeFunction(
      func,
      funcIndex,
      ioPrefixes,
      cpuPrefixes,
      options?.imports,
      options?.importedEffects
    );
    constraints.push(...analysis.constraints);

    const paramSet = new Set<string>(func.effectParams ?? []);
    effectParams.set(func.name, paramSet);
    bindings.set(func.name, initBindings(paramSet));

    const declared = new Set<EffectRef>();
    const declaredSource =
      (func as unknown as { declaredEffects?: readonly (Effect | Core.EffectVar)[] }).declaredEffects ??
      func.effects;
    for (const eff of declaredSource) declared.add(normalizeEffectRef(eff));

    const inferred = new Set<EffectRef>(declared);
    const required = new Set<EffectRef>();
    for (const eff of analysis.localEffects) {
      const ref = normalizeEffectRef(eff);
      inferred.add(ref);
      required.add(ref);
    }

    declaredEffects.set(func.name, declared);
    inferredEffects.set(func.name, inferred);
    requiredEffects.set(func.name, required);
  }

  // 第二遍：将被调函数的声明效果添加到 requiredEffects
  for (const constraint of constraints) {
    const callerRequired = requiredEffects.get(constraint.caller);
    const calleeDeclared = declaredEffects.get(constraint.callee);
    if (callerRequired && calleeDeclared) {
      for (const eff of calleeDeclared) {
        callerRequired.add(eff);
      }
    }
  }

  propagateEffects(constraints, inferredEffects, bindings);
  propagateEffects(constraints, requiredEffects, bindings);

  const resolvedDeclared = resolveEffectMap(declaredEffects, bindings);
  const resolvedInferred = resolveEffectMap(inferredEffects, bindings);
  const resolvedRequired = resolveEffectMap(requiredEffects, bindings);

  const diagnostics = buildDiagnostics(
    funcIndex,
    resolvedDeclared,
    resolvedInferred,
    resolvedRequired,
    bindings,
    effectParams
  );

  if (options?.moduleName) {
    const signatures = buildEffectSignatureMap(
      options.moduleName,
      resolvedDeclared,
      resolvedInferred,
      resolvedRequired
    );
    const cacheOptions = {
      moduleName: options.moduleName,
      uri: options.moduleUri ?? null,
      signatures,
      imports: options.imports ? Array.from(new Set(options.imports.values())) : [],
    };
    if (options.moduleCache) {
      options.moduleCache.cacheModuleEffectSignatures(cacheOptions);
    } else {
      cacheModuleEffectSignatures(cacheOptions);
    }
  }

  return diagnostics;
}

function analyzeFunction(
  func: Core.Func,
  index: Map<string, Core.Func>,
  ioPrefixes: readonly string[],
  cpuPrefixes: readonly string[],
  imports?: Map<string, string>,
  importedEffects?: Map<string, EffectSignature>
): FunctionAnalysis {
  const constraints: EffectConstraint[] = [];
  const localEffects = new Set<Effect>();

  // 使用统一的 Core 访客遍历函数体，收集调用与内建效果
  class EffectCollector extends DefaultCoreVisitor {
    override visitStatement(
      statement: Core.Statement,
      context: import('../core/visitor.js').VisitorContext
    ): void {
      if (statement.kind === 'workflow') {
        this.visitWorkflow(statement, context);
        return;
      }
      super.visitStatement(statement, context);
    }

    visitWorkflow(workflow: Core.Workflow, context: import('../core/visitor.js').VisitorContext): void {
      // workflow 天然需要 IO 效果（调度/状态存储），即使步骤本身为纯操作也必须声明 @io
      localEffects.add(Effect.IO);
      for (const step of workflow.steps) {
        this.visitBlock(step.body, context);
        if (step.compensate) this.visitBlock(step.compensate, context);
      }
    }

    override visitExpression(e: Core.Expression, context: import('../core/visitor.js').VisitorContext): void {
      if (e.kind === 'Call') {
        const calleeName = extractFunctionName(e.target);
        if (calleeName) {
          const resolvedName = imports ? resolveAlias(calleeName, imports) : calleeName;
          const isLocal = index.has(resolvedName);
          const imported = importedEffects?.get(resolvedName);

          if (imported) {
            for (const effect of imported.required) {
              localEffects.add(effect);
            }
          } else if (!isLocal) {
            recordBuiltinEffect(resolvedName, localEffects, ioPrefixes, cpuPrefixes);
          }

          if (isLocal) {
            const constraint: EffectConstraint = { caller: func.name, callee: resolvedName };
            const call = e as Core.Call;
            if (call.origin) constraint.location = call.origin as Origin;
            constraints.push(constraint);
          }
        }
      } else if (e.kind === 'Lambda') {
        // Lambda表达式：递归收集Lambda body的效应
        const lambda = e as Core.Lambda;
        this.visitBlock(lambda.body, context);
        return; // Lambda body已处理，无需继续默认递归
      }
      // 继续默认递归
      super.visitExpression(e, context);
    }
  }

  if (func.body) new EffectCollector().visitBlock(func.body, createVisitorContext());

  return { constraints, localEffects };
}

function extractFunctionName(expr: Core.Expression): string | null {
  return expr.kind === 'Name' ? expr.name : null;
}

function recordBuiltinEffect(
  name: string,
  effects: Set<Effect>,
  ioPrefixes: readonly string[],
  cpuPrefixes: readonly string[]
): void {
  if (ioPrefixes.some(prefix => name.startsWith(prefix))) effects.add(Effect.IO);
  if (cpuPrefixes.some(prefix => name.startsWith(prefix))) effects.add(Effect.CPU);
}

function propagateEffects(
  constraints: EffectConstraint[],
  effectMap: EffectSetMap,
  bindings: EffectBindingTable
): void {
  if (effectMap.size === 0) return;

  const { nodes, adjacency } = buildEffectFlowGraph(constraints, effectMap);
  if (nodes.length === 0) return;

  seedBindingsWithEffects(effectMap, bindings);

  const { components, componentByNode } = runTarjan(nodes, adjacency);
  const { componentEdges, indegree } = buildComponentGraph(components, componentByNode, adjacency);
  const order = topologicalSort(componentEdges, indegree);

  for (const componentIndex of order) {
    const members = components[componentIndex];
    if (!members || members.length === 0) continue;

    const firstMember = members[0]!;
    if (members.length > 1 || hasSelfLoop(firstMember, adjacency)) {
      let localChanged = true;
      while (localChanged) {
        localChanged = false;
        for (const node of members) {
          const neighbors = adjacency.get(node);
          if (!neighbors) continue;
          for (const neighbor of neighbors) {
            if (componentByNode.get(neighbor) !== componentIndex) continue;
            const changed = mergeEffects(node, neighbor, effectMap, bindings);
            if (changed) localChanged = true;
          }
        }
      }
    }

    for (const node of members) {
      const neighbors = adjacency.get(node);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (componentByNode.get(neighbor) === componentIndex) continue;
        void mergeEffects(node, neighbor, effectMap, bindings);
      }
    }
  }
}

function effectRefKey(ref: EffectRef): string {
  if ((ref as { kind?: string }).kind === 'EffectVar') return `var:${(ref as { name: string }).name}`;
  return String(ref);
}

function normalizeEffectRef(effect: Effect | Core.EffectVar): EffectRef {
  if ((effect as { kind?: string }).kind === 'EffectVar') {
    return { kind: 'EffectVar', name: (effect as Core.EffectVar).name };
  }
  return effect as Effect;
}

function initBindings(params: Set<string>): Map<string, EffectBinding> {
  const binding = new Map<string, EffectBinding>();
  for (const name of params) {
    binding.set(name, { value: Effect.PURE, resolved: false });
  }
  return binding;
}

function resolveEffectRef(
  ref: EffectRef,
  binding: Map<string, EffectBinding> | undefined
): EffectAtom | null {
  if ((ref as { kind?: string }).kind === 'EffectVar') {
    const target = binding?.get((ref as { name: string }).name);
    return target ? target.value : null;
  }
  return ref as EffectAtom;
}

function addEffectAtom(target: Set<EffectRef>, effect: EffectAtom): boolean {
  for (const existing of target) {
    if (effectRefKey(existing) === effectRefKey(effect)) return false;
  }
  target.add(effect);
  return true;
}

function updateBindingsWithEffect(
  funcName: string,
  effect: EffectAtom,
  bindings: EffectBindingTable
): void {
  const binding = bindings.get(funcName);
  if (!binding) return;
  for (const [name, entry] of binding) {
    const merged = strongerEffect(entry.value, effect);
    const resolved = entry.resolved || effectRank(effect) > effectRank(Effect.PURE);
    if (merged !== entry.value || resolved !== entry.resolved) {
      binding.set(name, { value: merged, resolved });
    }
  }
}

function seedBindingsWithEffects(effectMap: EffectSetMap, bindings: EffectBindingTable): void {
  for (const [fn, effects] of effectMap) {
    const binding = bindings.get(fn);
    if (!binding) continue;
    for (const ref of effects) {
      const atom = resolveEffectRef(ref, binding);
      if (atom) updateBindingsWithEffect(fn, atom, bindings);
    }
  }
}

function mergeEffects(
  source: string,
  target: string,
  effectMap: EffectSetMap,
  bindings: EffectBindingTable
): boolean {
  const sourceEffects = effectMap.get(source);
  const targetEffects = effectMap.get(target);
  if (!sourceEffects || !targetEffects) return false;
  const binding = bindings.get(source);
  let changed = false;
  for (const ref of sourceEffects) {
    const atom = resolveEffectRef(ref, binding);
    if (!atom) continue;
    if (addEffectAtom(targetEffects, atom)) {
      changed = true;
      updateBindingsWithEffect(target, atom, bindings);
    }
  }
  return changed;
}

function resolveEffectMap(
  effectMap: EffectSetMap,
  bindings: EffectBindingTable
): Map<string, Set<EffectAtom>> {
  const resolved = new Map<string, Set<EffectAtom>>();
  for (const [fn, effects] of effectMap) {
    const binding = bindings.get(fn);
    const set = new Set<EffectAtom>();
    for (const ref of effects) {
      const atom = resolveEffectRef(ref, binding);
      if (atom) set.add(atom);
    }
    resolved.set(fn, set);
  }
  return resolved;
}

function buildEffectFlowGraph(
  constraints: EffectConstraint[],
  effectMap: EffectSetMap
): { nodes: string[]; adjacency: Map<string, Set<string>> } {
  const adjacency = new Map<string, Set<string>>();
  const nodes: string[] = [];

  for (const node of effectMap.keys()) {
    nodes.push(node);
    adjacency.set(node, new Set());
  }

  for (const constraint of constraints) {
    if (!effectMap.has(constraint.caller) || !effectMap.has(constraint.callee)) continue;
    let followers = adjacency.get(constraint.callee);
    if (!followers) {
      followers = new Set();
      adjacency.set(constraint.callee, followers);
    }
    followers.add(constraint.caller);
  }

  return { nodes, adjacency };
}

function runTarjan(
  nodes: string[],
  adjacency: Map<string, Set<string>>
): { components: string[][]; componentByNode: Map<string, number> } {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const componentByNode = new Map<string, number>();

  function strongConnect(node: string): void {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    const neighbors = adjacency.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!indices.has(neighbor)) {
          strongConnect(neighbor);
          const currentLow = lowLinks.get(node)!;
          const neighborLow = lowLinks.get(neighbor)!;
          if (neighborLow < currentLow) lowLinks.set(node, neighborLow);
        } else if (onStack.has(neighbor)) {
          const currentLow = lowLinks.get(node)!;
          const neighborIndex = indices.get(neighbor)!;
          if (neighborIndex < currentLow) lowLinks.set(node, neighborIndex);
        }
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      while (true) {
        const member = stack.pop();
        if (!member) break;
        onStack.delete(member);
        component.push(member);
        componentByNode.set(member, components.length);
        if (member === node) break;
      }
      components.push(component);
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) strongConnect(node);
  }

  return { components, componentByNode };
}

function buildComponentGraph(
  components: string[][],
  componentByNode: Map<string, number>,
  adjacency: Map<string, Set<string>>
): { componentEdges: Map<number, Set<number>>; indegree: number[] } {
  const componentEdges = new Map<number, Set<number>>();
  const indegree = Array.from({ length: components.length }, () => 0);

  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const componentMembers = components[componentIndex];
    if (!componentMembers) continue;
    for (const node of componentMembers) {
      const neighbors = adjacency.get(node);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        const neighborComponent = componentByNode.get(neighbor);
        if (neighborComponent === undefined || neighborComponent === componentIndex) continue;
        let edges = componentEdges.get(componentIndex);
        if (!edges) {
          edges = new Set();
          componentEdges.set(componentIndex, edges);
        }
        if (!edges.has(neighborComponent)) {
          edges.add(neighborComponent);
          indegree[neighborComponent] = (indegree[neighborComponent] ?? 0) + 1;
        }
      }
    }
  }

  return { componentEdges, indegree };
}

function topologicalSort(
  componentEdges: Map<number, Set<number>>,
  indegree: number[]
): number[] {
  const order: number[] = [];
  const queue: number[] = [];
  const visited = Array.from({ length: indegree.length }, () => false);

  for (let i = 0; i < indegree.length; i += 1) {
    if (indegree[i] === 0) {
      queue.push(i);
    }
  }

  while (queue.length > 0) {
    const index = queue.shift()!;
    if (visited[index]) continue;
    visited[index] = true;
    order.push(index);
    const edges = componentEdges.get(index);
    if (!edges) continue;
    for (const next of edges) {
      if (next < 0 || next >= indegree.length) continue;
      const current = indegree[next];
      if (current === undefined) continue;
      const updated = current - 1;
      indegree[next] = updated;
      if (updated === 0 && !visited[next]) {
        queue.push(next);
      }
    }
  }

  if (order.length !== indegree.length) {
    // 理论上组件图无环，此处仅保证顺序覆盖全部节点
    for (let i = 0; i < indegree.length; i += 1) {
      if (!visited[i]) order.push(i);
    }
  }

  return order;
}

function hasSelfLoop(
  node: string,
  adjacency: Map<string, Set<string>>
): boolean {
  const neighbors = adjacency.get(node);
  return neighbors ? neighbors.has(node) : false;
}

function buildDiagnostics(
  funcIndex: Map<string, Core.Func>,
  declared: Map<string, Set<EffectAtom>>,
  inferred: Map<string, Set<EffectAtom>>,
  required: Map<string, Set<EffectAtom>>,
  bindings: EffectBindingTable,
  effectParams: Map<string, Set<string>>
): TypecheckDiagnostic[] {
  const diagnostics: TypecheckDiagnostic[] = [];

  for (const [name, func] of funcIndex) {
    const declaredSet = declared.get(name) ?? new Set<EffectAtom>();
    const inferredSet = inferred.get(name) ?? new Set<EffectAtom>();
    const requiredSet = required.get(name) ?? new Set<EffectAtom>();

    const inferredHasIO = inferredSet.has(Effect.IO);
    const inferredHasCPU = inferredSet.has(Effect.CPU);
    const declaredHasIO = declaredSet.has(Effect.IO);
    const declaredHasCPU = declaredSet.has(Effect.CPU);

    if (inferredHasIO && !declaredHasIO) {
      const diag: TypecheckDiagnostic = {
        severity: 'error',
        message: `函数 '${name}' 缺少 @io 效果声明，推断要求 IO。`,
        code: ErrorCode.EFF_INFER_MISSING_IO,
        help: '根据推断结果为函数添加 @io 效果。',
        ...(func.span ? { span: func.span } : {}),
        data: { func: name, effect: 'io' },
      };
      diagnostics.push(diag);
    }

    if (inferredHasCPU && !(declaredHasCPU || declaredHasIO)) {
      const diag: TypecheckDiagnostic = {
        severity: 'error',
        message: `函数 '${name}' 缺少 @cpu 效果声明，推断要求 CPU（或 @io）。`,
        code: ErrorCode.EFF_INFER_MISSING_CPU,
        help: '根据推断结果补齐 @cpu 或 @io 效果。',
        ...(func.span ? { span: func.span } : {}),
        data: { func: name, effect: 'cpu' },
      };
      diagnostics.push(diag);
    }

    const requiredHasIO = requiredSet.has(Effect.IO);
    const requiredHasCPU = requiredSet.has(Effect.CPU);

    if (declaredHasIO && !requiredHasIO) {
      const diag: TypecheckDiagnostic = {
        severity: 'warning',
        message: `函数 '${name}' 声明了 @io，但推断未发现 IO 副作用。`,
        code: ErrorCode.EFF_INFER_REDUNDANT_IO,
        help: '确认是否需要保留 @io 声明。',
        ...(func.span ? { span: func.span } : {}),
        data: { func: name, effect: 'io' },
      };
      diagnostics.push(diag);
    }

    if (declaredHasCPU) {
      if (!requiredHasCPU && !requiredHasIO) {
        const diag: TypecheckDiagnostic = {
          severity: 'warning',
          message: `函数 '${name}' 声明了 @cpu，但推断未发现 CPU 副作用。`,
          code: ErrorCode.EFF_INFER_REDUNDANT_CPU,
          help: '若无 CPU 副作用，可删除 @cpu 声明。',
          ...(func.span ? { span: func.span } : {}),
          data: { func: name, effect: 'cpu' },
        };
        diagnostics.push(diag);
      } else if (!requiredHasCPU && requiredHasIO) {
        const diag: TypecheckDiagnostic = {
          severity: 'warning',
          message: `函数 '${name}' 同时声明 @cpu 和 @io；由于需要 @io，@cpu 可移除。`,
          code: ErrorCode.EFF_INFER_REDUNDANT_CPU_WITH_IO,
          help: '保留 @io 即可满足需求，移除多余的 @cpu。',
          ...(func.span ? { span: func.span } : {}),
          data: { func: name, effect: 'cpu' },
        };
        diagnostics.push(diag);
      }
    }

    const binding = bindings.get(name);
    const params = effectParams.get(name) ?? new Set<string>();
    if (binding && params.size > 0) {
      const unresolved: string[] = [];
      for (const param of params) {
        const status = binding.get(param);
        if (!status || !status.resolved) unresolved.push(param);
      }
      if (unresolved.length > 0) {
        const diag: TypecheckDiagnostic = {
          severity: 'error',
          code: ErrorCode.EFFECT_VAR_UNRESOLVED,
          message: `效应变量 ${unresolved.join(', ')} 无法推断出具体效果`,
          help: '参考调用或声明补充明确的效果（pure/cpu/io/workflow），或移除未使用的效应变量。',
          ...(func.span ? { span: func.span } : {}),
          data: { func: name, vars: unresolved },
        };
        diagnostics.push(diag);
      }
    }
  }

  return diagnostics;
}

function buildEffectSignatureMap(
  moduleName: string,
  declared: Map<string, Set<EffectAtom>>,
  inferred: Map<string, Set<EffectAtom>>,
  required: Map<string, Set<EffectAtom>>
): Map<string, EffectSignature> {
  const map = new Map<string, EffectSignature>();
  for (const [fn, requiredSet] of required) {
    const qualifiedName = moduleName ? `${moduleName}.${fn}` : fn;
    map.set(qualifiedName, {
      module: moduleName,
      function: fn,
      qualifiedName,
      declared: toEffectSet(declared.get(fn)),
      inferred: toEffectSet(inferred.get(fn)),
      required: toEffectSet(requiredSet),
    });
  }
  return map;
}

function toEffectSet(source: Set<EffectAtom> | undefined): ReadonlySet<Effect> {
  const result = new Set<Effect>();
  if (!source) return result;
  for (const atom of source) {
    if (atom === Effect.IO || atom === Effect.CPU || atom === Effect.PURE) {
      result.add(atom);
    }
  }
  return result;
}
