/**
 * 规则输入引用分析（ADR 0046 §11 D2 传播规则表与 §11.6 实施澄清）：对返回 Verdict 的规则，静态收集它对
 * **第一个参数**读取的源码字段路径。纯函数，不读注册表；作用于名称解析 R2 之后的 Core（只含规范名）。
 * Java 镜像：aster-lang-core/.../typecheck/governance/InputRefsAnalyzer.java，两引擎对同一 Core 必须得到相同结果
 * （共享夹具 shared/governance_input_refs_parity.json）。
 *
 * 抽象值是「来源」：路径集合、聚合（记录构造）按字段的来源，以及顶元 `*`。表达式求值得到来源，
 * 「消费」处（运算符与内置函数的实参、条件、Match 主语、规则体内的 Return）把来源记入结果；
 * Let / Set 只绑定（同名多次赋值取并），字段访问与字面量 Map 键只扩展路径。同模块调用把形参绑定到实参来源后
 * 内联被调函数体，被调函数 Return 的来源作为调用结果。
 *
 * 产生 `*` 的构造（construct 闭集）见 InputRefsConstruct。`*` 独占：一旦产生，结果只含 `["*"]`；
 * E708 报告先序遍历中第一个产生 `*` 的节点（父节点先于子节点；同模块调用的被调函数体排在实参之后）。
 */
import type { Core } from '../types.js';
import { BUILTIN_AWAIT, BUILTIN_OPS, callTargetBuiltin } from '../config/semantic.js';
import { KEYWORD_CTORS } from '../frontend/resolution-choice.js';

/** 引擎路径最多段数（ADR 0046 §11.6 第 1 条）。 */
export const MAX_INPUT_REF_SEGMENTS = 8;
/** 同模块调用内联的最大嵌套层数（§11.2：恰好 8 层可定位，第 9 层为 `*`）。 */
export const MAX_INLINE_DEPTH = 8;
/** 单条规则分析中内联调用的总次数上限：防止分支调用链指数展开拖垮编译，超出按 inline-depth 处理。 */
export const MAX_INLINE_CALLS = 4096;
export const INPUT_REFS_STAR = '*';

export type InputRefsConstruct =
  | 'dynamic-map-key'
  | 'map-iteration'
  | 'whole-input-serialized'
  | 'cross-module-call'
  | 'function-value'
  | 'inline-depth'
  | 'recursion'
  | 'path-too-long'
  | 'unrepresentable-key';

/** inputRefs 为字典序去重的路径，无法静态确定时为 `["*"]`；construct 只在后者时给出。 */
export interface InputRefsResult {
  readonly inputRefs: readonly string[];
  readonly construct?: InputRefsConstruct;
}

/** 按字面量键选取 Map 值：第二个实参为字符串字面量时扩展路径，否则为动态键。 */
const MAP_KEY_ACCESS: ReadonlySet<string> = new Set(['Map.get', 'Map.contains', 'Map.containsKey']);
/** 迭代 Map 的键或值。 */
const MAP_ITERATION: ReadonlySet<string> = new Set(['Map.keys', 'Map.values']);
/** 把值整体转为文本或摘要。 */
const SERIALIZERS: ReadonlySet<string> = new Set(['Bool.toString', 'Crypto.hash', 'Int.toString']);

// ---- 抽象值 ----

/** 来源：star 为顶元；paths 为第一个参数下的路径（"" 为参数本身）；fields 为记录构造的按字段来源。不可变。 */
interface Src {
  readonly star: boolean;
  readonly paths: ReadonlySet<string>;
  readonly fields: ReadonlyMap<string, Src>;
}

const EMPTY: Src = { star: false, paths: new Set(), fields: new Map() };
const TOP: Src = { star: true, paths: new Set(), fields: new Map() };

function pathSrc(p: string): Src {
  return { star: false, paths: new Set([p]), fields: new Map() };
}

function isEmpty(v: Src): boolean {
  return !v.star && v.paths.size === 0 && [...v.fields.values()].every(isEmpty);
}

function union(a: Src, b: Src): Src {
  if (isEmpty(b)) return a;
  if (isEmpty(a)) return b;
  if (a.star || b.star) return TOP;
  const fields = new Map(a.fields);
  for (const [k, v] of b.fields) fields.set(k, fields.has(k) ? union(fields.get(k)!, v) : v);
  return { star: false, paths: new Set([...a.paths, ...b.paths]), fields };
}

function unionAll(vs: readonly Src[]): Src {
  return vs.reduce(union, EMPTY);
}

function allEmpty(vs: readonly Src[]): boolean {
  return vs.every(isEmpty);
}

function segments(path: string): number {
  return path.split('.').length;
}

type Mode = 'rule' | 'callee' | 'lambda';

/** 一次函数体遍历的上下文：变量环境、Return 的处理方式与被调函数 Return 的来源累积。 */
interface Frame {
  readonly env: Map<string, Src>;
  readonly mode: Mode;
  readonly depth: number;
  returns: Src;
}

function bind(f: Frame, name: string | null | undefined, v: Src): void {
  if (name === null || name === undefined) return;
  const prev = f.env.get(name);
  f.env.set(name, prev === undefined ? v : union(prev, v));
}

/** 是否为该函数写入 inputRefs 由调用方按「模块声明档案 且 函数返回 Verdict」判定（compile-pipeline）。 */
export function analyzeInputRefs(module: Pick<Core.Module, 'name' | 'decls'>, rule: Core.Func): InputRefsResult {
  const a = new Analyzer(module);
  a.run(rule);
  if (a.firstConstruct !== undefined) return { inputRefs: [INPUT_REFS_STAR], construct: a.firstConstruct };
  // 默认 sort 按 UTF-16 码元比较，与 Java String.compareTo 同序
  return { inputRefs: [...a.refs].sort() };
}

class Analyzer {
  private readonly funcs = new Map<string, Core.Func>();
  private readonly importAliases: string[] = [];
  private readonly importPaths: string[] = [];
  readonly refs = new Set<string>();
  private readonly stack: Core.Func[] = [];
  private inlineCalls = 0;
  /** 节点先序编号：进入节点时递增；记录编号最小的产生 * 的节点。 */
  private nodeCounter = 0;
  private firstIndex = Number.MAX_SAFE_INTEGER;
  firstConstruct: InputRefsConstruct | undefined;

  constructor(private readonly module: Pick<Core.Module, 'name' | 'decls'>) {
    for (const d of module.decls ?? []) {
      if (d.kind === 'Func' && typeof d.name === 'string' && !this.funcs.has(d.name)) this.funcs.set(d.name, d);
      if (d.kind === 'Import') {
        if (typeof d.asName === 'string') this.importAliases.push(d.asName);
        if (typeof d.name === 'string') this.importPaths.push(d.name);
      }
    }
  }

  run(rule: Core.Func): void {
    const env = new Map<string, Src>();
    // 只追踪第一个参数（§11.6 补充规则 (c)）；其余参数是不含输入来源的局部名
    (rule.params ?? []).forEach((p, i) => env.set(p.name, i === 0 ? pathSrc('') : EMPTY));
    this.stack.push(rule);
    this.walk(rule.body, { env, mode: 'rule', depth: 0, returns: EMPTY });
    this.stack.pop();
  }

  private produce(index: number, construct: InputRefsConstruct): Src {
    if (index < this.firstIndex) {
      this.firstIndex = index;
      this.firstConstruct = construct;
    }
    return TOP;
  }

  private consume(v: Src): void {
    if (v.star) return;
    for (const p of v.paths) this.refs.add(p);
    for (const f of v.fields.values()) this.consume(f);
  }

  // ---- 语句 ----

  private walk(stmt: Core.Statement | Core.Block | null | undefined, f: Frame): void {
    if (!stmt) return;
    switch (stmt.kind) {
      case 'Let':
      case 'Set':
      case 'Start':
        bind(f, stmt.name, this.eval(stmt.expr, f));
        return;
      case 'Return': {
        const v = this.eval(stmt.expr, f);
        if (f.mode === 'callee') f.returns = union(f.returns, v);
        else this.consume(v);
        return;
      }
      case 'If':
        this.consume(this.eval(stmt.cond, f));
        this.walk(stmt.thenBlock, f);
        this.walk(stmt.elseBlock, f);
        return;
      case 'Match': {
        const subject = this.eval(stmt.expr, f);
        this.consume(subject);
        for (const c of stmt.cases ?? []) {
          this.bindPattern(c.pattern, subject, f);
          this.walk(c.body, f);
        }
        return;
      }
      case 'Block':
      case 'Scope':
        for (const s of stmt.statements ?? []) this.walk(s, f);
        return;
      case 'workflow':
        for (const step of stmt.steps ?? []) {
          this.walk(step.body, f);
          this.walk(step.compensate, f);
        }
        return;
      default:
        return;
    }
  }

  /** 模式变量绑定到被匹配值的来源（PatCtor 的 names 与嵌套 args 都绑定，两引擎 IR 形状差异因此无影响）。 */
  private bindPattern(p: Core.Pattern | null | undefined, v: Src, f: Frame): void {
    if (!p) return;
    if (p.kind === 'PatName') bind(f, p.name, v);
    if (p.kind === 'PatCtor') {
      for (const n of p.names ?? []) bind(f, n, v);
      for (const a of p.args ?? []) this.bindPattern(a, v, f);
    }
  }

  // ---- 表达式 ----

  private eval(expr: Core.Expression | null | undefined, f: Frame): Src {
    if (!expr) return EMPTY;
    const index = ++this.nodeCounter;
    switch (expr.kind) {
      case 'Name':
        return this.name(expr.name, index, f);
      case 'Call':
        return this.call(expr, index, f);
      case 'Construct': {
        const fields = new Map<string, Src>();
        for (const fi of expr.fields ?? []) {
          const v = this.eval(fi.expr, f);
          fields.set(fi.name, fields.has(fi.name) ? union(fields.get(fi.name)!, v) : v);
        }
        return [...fields.values()].some((v) => v.star) ? TOP : { star: false, paths: new Set(), fields };
      }
      case 'ListLit':
        return unionAll(this.evalAll(expr.elements, f));
      case 'Ok':
      case 'Err':
      case 'Some':
      case 'Await':
        return this.eval(expr.expr, f);
      case 'IfExpr': {
        this.consume(this.eval(expr.cond, f));
        const t = this.eval(expr.thenE, f);
        return union(t, this.eval(expr.elseE, f));
      }
      case 'Lambda': {
        const env = new Map(f.env);
        for (const p of expr.params ?? []) env.set(p.name, EMPTY);
        this.walk(expr.body, { env, mode: 'lambda', depth: f.depth, returns: EMPTY });
        return EMPTY;
      }
      default:
        return EMPTY;
    }
  }

  private evalAll(exprs: readonly Core.Expression[] | null | undefined, f: Frame): Src[] {
    return (exprs ?? []).map((e) => this.eval(e, f));
  }

  /** 变量引用与点分字段访问：首段是局部名时逐段扩展路径；否则（函数名、枚举成员、限定名）不含输入来源。 */
  private name(name: string | null | undefined, index: number, f: Frame): Src {
    if (typeof name !== 'string') return EMPTY;
    const own = f.env.get(name);
    if (own !== undefined) return own;
    const dot = name.indexOf('.');
    if (dot < 0) return EMPTY;
    let v = f.env.get(name.slice(0, dot));
    if (v === undefined) return EMPTY;
    for (const seg of name.slice(dot + 1).split('.')) v = this.select(v, seg, index);
    return v;
  }

  private select(v: Src, seg: string, index: number): Src {
    if (v.star) return v;
    const paths = new Set<string>();
    for (const p of v.paths) {
      const q = p === '' ? seg : `${p}.${seg}`;
      if (segments(q) > MAX_INPUT_REF_SEGMENTS) return this.produce(index, 'path-too-long');
      paths.add(q);
    }
    const fromPaths: Src = paths.size === 0 ? EMPTY : { star: false, paths, fields: new Map() };
    return union(fromPaths, v.fields.get(seg) ?? EMPTY);
  }

  private call(c: Core.Call, index: number, f: Frame): Src {
    if (c.target?.kind !== 'Name' || typeof c.target.name !== 'string') {
      const target = this.eval(c.target, f);
      const args = this.evalAll(c.args, f);
      return isEmpty(target) && allEmpty(args) ? EMPTY : this.produce(index, 'function-value');
    }
    const t = c.target.name;
    if (BUILTIN_OPS.has(t)) return this.consumeAll(this.evalAll(c.args, f));
    if (t === BUILTIN_AWAIT || KEYWORD_CTORS.has(t)) return unionAll(this.evalAll(c.args, f));
    if (f.env.has(t) || this.isFieldOfLocal(t, f)) {
      const target = this.name(t, index, f);
      const args = this.evalAll(c.args, f);
      return isEmpty(target) && allEmpty(args) ? EMPTY : this.produce(index, 'function-value');
    }
    const local = this.localFunc(t);
    if (local) return this.inline(local, this.evalAll(c.args, f), index, f);
    if (callTargetBuiltin(t) !== null) return this.consumeAll(this.evalAll(c.args, f));
    if (MAP_KEY_ACCESS.has(t) && c.args?.length === 2) return this.mapKey(c, index, f);
    if (MAP_ITERATION.has(t)) return this.producesIfAny(this.evalAll(c.args, f), index, 'map-iteration');
    if (SERIALIZERS.has(t)) return this.producesIfAny(this.evalAll(c.args, f), index, 'whole-input-serialized');
    if (!t.includes('.') || this.isImported(t)) return this.producesIfAny(this.evalAll(c.args, f), index, 'cross-module-call');
    // 其余限定名是内置函数（Text.* / List.* / Verdict.* …）：实参被消费
    return this.consumeAll(this.evalAll(c.args, f));
  }

  private isFieldOfLocal(t: string, f: Frame): boolean {
    const dot = t.indexOf('.');
    return dot > 0 && f.env.has(t.slice(0, dot));
  }

  /** 同模块函数：未限定名，或 `<模块名>.<函数名>`（§11.6 第 2 条：按模块限定名分类）。 */
  private localFunc(t: string): Core.Func | undefined {
    if (!t.includes('.')) return this.funcs.get(t);
    const name = this.module.name;
    if (typeof name !== 'string' || !t.startsWith(`${name}.`)) return undefined;
    const rest = t.slice(name.length + 1);
    return rest.includes('.') ? undefined : this.funcs.get(rest);
  }

  private isImported(t: string): boolean {
    const head = t.slice(0, t.indexOf('.'));
    return this.importAliases.includes(head) || this.importPaths.some((p) => t.startsWith(`${p}.`));
  }

  private mapKey(c: Core.Call, index: number, f: Frame): Src {
    const map = this.eval(c.args[0], f);
    const keyExpr = c.args[1]!;
    const key = this.eval(keyExpr, f);
    if (keyExpr.kind === 'String' && typeof keyExpr.value === 'string') {
      if (isEmpty(map)) return EMPTY;
      if (keyExpr.value === '' || keyExpr.value.includes('.')) return this.produce(index, 'unrepresentable-key');
      return this.select(map, keyExpr.value, index);
    }
    this.consume(key);
    return isEmpty(map) ? EMPTY : this.produce(index, 'dynamic-map-key');
  }

  private inline(callee: Core.Func, args: readonly Src[], index: number, f: Frame): Src {
    if (allEmpty(args)) return EMPTY;
    if (this.stack.includes(callee)) return this.produce(index, 'recursion');
    if (f.depth + 1 > MAX_INLINE_DEPTH || ++this.inlineCalls > MAX_INLINE_CALLS) return this.produce(index, 'inline-depth');
    const frame: Frame = { env: new Map(), mode: 'callee', depth: f.depth + 1, returns: EMPTY };
    (callee.params ?? []).forEach((p, i) => bind(frame, p.name, args[i] ?? EMPTY));
    this.stack.push(callee);
    this.walk(callee.body, frame);
    this.stack.pop();
    return frame.returns;
  }

  private producesIfAny(args: readonly Src[], index: number, construct: InputRefsConstruct): Src {
    return allEmpty(args) ? EMPTY : this.produce(index, construct);
  }

  private consumeAll(args: readonly Src[]): Src {
    args.forEach((a) => this.consume(a));
    return unionAll(args);
  }
}
