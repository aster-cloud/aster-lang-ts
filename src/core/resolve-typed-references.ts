/**
 * @module core/resolve-typed-references
 *
 * 名称解析阶段 R2（ADR 0051 §4、§6.2）：在 Core 上解析依赖类型的位置——
 * (a) 点分路径 `x.f.g` 的字段段与 `Set` 目标（FIELD_REF）；
 * (b) 期望类型为枚举时的裸单段名（含期望枚举下用作成员的模式名）；
 * (c) 主语类型在 R1 未知的 PatternCtor。
 * 另对 R1 未命中的无期望类型裸名报 E802。
 *
 * 只处理 lower 登记了 ResolutionMark 的位置。类型只来自 §4 的显式声明规则（参数 / lambda 参数、
 * 构造 `X with …`、对源码函数的直接调用、已知类型的点分路径），其余一律未知；不调用类型检查器。
 * 输入 Core 不被修改（标记只读），返回新的 Core 与诊断；同一输入重复运行结果相同。
 */
import { foldKey, nfc } from '../config/lexicons/identifiers/casefold.js';
import type { Candidate, VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { BUILTIN_AWAIT, BUILTIN_OPS } from '../config/semantic.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import type { ResolutionContext } from '../frontend/resolution-context.js';
import { KEYWORD_CTORS, choose, chooseDecl, chooseVocab, formatCandidates } from '../frontend/resolution-choice.js';
import type { Choice, Entry, VocabMap } from '../frontend/resolution-choice.js';
import { DiagnosticBuilder } from '../typecheck/diagnostics.js';
import { BUILTIN_TYPE_NAMES } from '../typecheck/generics.js';
import { originToSpan } from '../typecheck/pure.js';
import { VERDICT_FIELDS, VERDICT_TYPE_NAME } from '../typecheck/verdict_signatures.js';
import type { Core, ResolvedRole, Span, TypecheckDiagnostic } from '../types.js';
import { isFieldTypeInferred } from './inferred_fields.js';
import { resolutionMarkOf, withResolvedOrigin } from './resolution-mark.js';
import type { MarkableNode, ResolutionMark } from './resolution-mark.js';

/** 内置运算符、await 与关键词构造器的调用形式：不是待解析的名字。 */
function isBuiltinValue(name: string): boolean {
  return BUILTIN_OPS.has(name) || name === BUILTIN_AWAIT || KEYWORD_CTORS.has(name);
}

/**
 * 动态值：未声明类型的字段（ADR 0040，如 Guard 的 context 映射）。其后的点分段是动态键，
 * 原样保留、不解析。与“未知”（undefined，按全局候选回退）区分。
 */
const DYNAMIC = 'dynamic' as const;

/** R2 静态类型：声明类型、动态值或未知。 */
type Static = Core.Type | typeof DYNAMIC | undefined;

function asType(t: Static): Core.Type | undefined {
  return t === DYNAMIC ? undefined : t;
}

// ---- 模块表 ----

/** 本模块（Core，已为规范名）与导入模块的声明。 */
interface Tables {
  /** Data 规范名 → 字段规范名 → 字段声明（导入的 Data 无字段类型） */
  readonly datas: Map<string, Map<string, Core.Field | undefined>>;
  /** 枚举规范名 → 成员规范名 */
  readonly enums: Map<string, readonly string[]>;
  /** 本模块函数（规范名） */
  readonly funcs: Map<string, Core.Func>;
  /** 值位置第 2 步：函数与类型声明（原写法取自 origin.written） */
  readonly valueDecls: Entry[];
  /** PatternCtor 的 Data 构造器（本模块 Data 与导入类型） */
  readonly ctorDecls: Entry[];
}

interface Resolver {
  readonly scopes: VocabularyScopes | undefined;
  readonly t: Tables;
  readonly diags: DiagnosticBuilder;
  readonly observer: TypedReferenceObserver | undefined;
}

/** 一个按父作用域解析的写法：字段段（父为接收者 Data）或期望枚举下的成员（父为枚举）。 */
export interface ScopedResolutionSite {
  /** 所在节点的位置（点分路径为整条路径） */
  readonly span: Span | undefined;
  /** 点分路径位置：整条原写法与段序号（首段为 0）；非路径位置缺省 */
  readonly segment?: { readonly path: string; readonly index: number };
  readonly written: string;
  readonly canonical: string;
  readonly role: ResolvedRole;
  /** 所属规范父名；接收者类型未知时缺省 */
  readonly parent?: string;
}

/**
 * R2 只读观察者（供 LSP 悬停与补全）：报告解析结果与 §4 静态类型，不影响输出与诊断。
 */
export interface TypedReferenceObserver {
  /** 字段段与成员位置的解析结果 */
  readonly onScopedSite?: (site: ScopedResolutionSite) => void;
  /** 值位置名字（含点分路径）解析后的静态类型；未知、动态或不透明时为 undefined */
  readonly onTypedName?: (name: Core.Name, type: Core.Type | undefined) => void;
}

function declEntry(d: Core.Data | Core.Enum | Core.Func, role: ResolvedRole): Entry {
  return { written: nfc(d.origin?.written ?? d.name), canonical: d.name, role };
}

function buildTables(m: Core.Module, ctx: ResolutionContext): Tables {
  const t: Tables = { datas: new Map(), enums: new Map(), funcs: new Map(), valueDecls: [], ctorDecls: [] };
  for (const d of m.decls) registerDecl(t, d);
  const own = (name: string, role: ResolvedRole): Entry => ({ written: name, canonical: name, role });
  t.valueDecls.push(...ctx.imports.functions.map((f) => own(f, 'FUNC_REF')), ...ctx.imports.types.map((x) => own(x, 'TYPE')));
  t.ctorDecls.push(...ctx.imports.types.filter((x) => !ctx.imports.enumMembers.has(x)).map((x) => own(x, 'TYPE')));
  for (const [e, ms] of ctx.imports.enumMembers) t.enums.set(e, ms);
  for (const [s, fs] of ctx.imports.fields) t.datas.set(s, new Map(fs.map((f) => [f, undefined])));
  t.datas.set(VERDICT_TYPE_NAME, new Map([...VERDICT_FIELDS].map((f) => [f, undefined])));
  return t;
}

function registerDecl(t: Tables, d: Core.Declaration): void {
  switch (d.kind) {
    case 'Data':
      t.datas.set(d.name, new Map(d.fields.map((f) => [f.name, f])));
      t.valueDecls.push(declEntry(d, 'TYPE'));
      t.ctorDecls.push(declEntry(d, 'TYPE'));
      return;
    case 'Enum':
      t.enums.set(d.name, d.variants);
      t.valueDecls.push(declEntry(d, 'TYPE'));
      return;
    case 'Func':
      t.funcs.set(d.name, d);
      t.valueDecls.push(declEntry(d, 'FUNC_REF'));
      return;
    case 'Import':
      return;
    default: {
      const never: never = d;
      throw new Error(`未处理的声明：${JSON.stringify(never)}`);
    }
  }
}

// ---- 词汇视图 ----

function vocabTypes(r: Resolver): VocabMap[] {
  return r.scopes ? [{ map: r.scopes.types, role: 'TYPE' }] : [];
}

function vocabTypesAndFunctions(r: Resolver): VocabMap[] {
  if (!r.scopes) return [];
  return [
    { map: r.scopes.functions, role: 'FUNC_REF' },
    { map: r.scopes.types, role: 'TYPE' },
  ];
}

function scoped(
  r: Resolver,
  pick: (s: VocabularyScopes) => ReadonlyMap<string, ReadonlyMap<string, Candidate[]>>,
  parent: string | undefined,
  role: ResolvedRole
): VocabMap[] {
  if (!r.scopes) return [];
  const all = [...pick(r.scopes)].filter(([p]) => parent === undefined || p === parent);
  return all.map(([, map]) => ({ map, role }));
}

/** 源码声明优先；未命中再查词汇（含规范名直写）。 */
function declThenVocab(decls: readonly Entry[], maps: readonly VocabMap[], written: string): Choice {
  const fromDecl = chooseDecl(decls, written);
  return fromDecl.kind === 'miss' ? chooseVocab(maps, written) : fromDecl;
}

function entriesOf(names: readonly string[], role: ResolvedRole): Entry[] {
  return names.map((n) => ({ written: n, canonical: n, role }));
}

/** 枚举 e 的成员；e 缺省时为全部枚举的成员（主语类型未知的模式）。 */
function chooseMember(r: Resolver, e: string | undefined, written: string): Choice {
  const enums = [...r.t.enums].filter(([name]) => e === undefined || name === e);
  const decls = enums.flatMap(([, ms]) => entriesOf(ms, 'MEMBER_REF'));
  return declThenVocab(decls, scoped(r, (s) => s.enumMembers, e, 'MEMBER_REF'), written);
}

/** Data S 的字段；S 缺省时为全部 Data 的字段（接收者类型未知）。 */
function chooseField(r: Resolver, s: string | undefined, written: string): Choice {
  const datas = [...r.t.datas].filter(([name]) => s === undefined || name === s);
  const decls = datas.flatMap(([, fs]) => entriesOf([...fs.keys()], 'FIELD_REF'));
  return declThenVocab(decls, scoped(r, (x) => x.fields, s, 'FIELD_REF'), written);
}

function isEnum(r: Resolver, name: string): boolean {
  return r.t.enums.has(name) || (r.scopes?.enumMembers.has(name) ?? false);
}

/** 已知类型名（TypeName）；类型变量、容器与推断类型均视为未知。 */
function typeNameOf(t: Static): string | undefined {
  return typeof t === 'object' && t.kind === 'TypeName' ? t.name : undefined;
}

function enumOf(r: Resolver, t: Static): string | undefined {
  const name = typeNameOf(t);
  return name !== undefined && isEnum(r, name) ? name : undefined;
}

function dataOf(r: Resolver, t: Static): string | undefined {
  const name = typeNameOf(t);
  return name !== undefined && r.t.datas.has(name) ? name : undefined;
}

/** 字段的静态类型：声明类型；未声明类型的字段为动态值；导入 Data 的字段未知。 */
function fieldType(r: Resolver, s: string, field: string): Static {
  const f = r.t.datas.get(s)?.get(field);
  if (!f) return undefined;
  return isFieldTypeInferred(f) ? DYNAMIC : f.type;
}

/** 内置容器类型名：其元素类型才决定字段，自身不是可透传的不透明类型。 */
const CONTAINER_TYPE_NAMES: ReadonlySet<string> = new Set(['Result', 'Option', 'List', 'Set', 'Workflow']);

/** 无字段结构、点分段只能是动态键的类型名：内置标量与 Map / Json / Any。 */
const OPAQUE_TYPE_NAMES: ReadonlySet<string> = new Set([
  ...[...BUILTIN_TYPE_NAMES].filter((n) => !CONTAINER_TYPE_NAMES.has(n)),
  'Map',
  'Json',
  'Any',
]);

/**
 * 不透明类型（白名单）：动态值、类型变量、Map 及上述类型名。其后的点分段原样保留、不解析。
 * 类型别名、Option / Maybe / List / TypeApp 等包装与未声明的类型名均不在其中，按未知处理。
 */
function isOpaque(r: Resolver, t: Static): boolean {
  if (t === DYNAMIC) return true;
  if (t === undefined || dataOf(r, t) !== undefined) return false;
  if (t.kind === 'TypeVar' || t.kind === 'Map') return true;
  return t.kind === 'TypeName' && OPAQUE_TYPE_NAMES.has(t.name);
}

// ---- 作用域 ----

interface Local {
  readonly name: string;
  readonly type?: Static;
}

interface Scope {
  readonly parent: Scope | undefined;
  readonly locals: Local[];
}

/** 遍历上下文：作用域、所在函数 / lambda 的声明返回类型、各层 lambda 的捕获改写表。 */
interface Frame {
  readonly scope: Scope;
  readonly ret: Core.Type | undefined;
  readonly captures: readonly Map<string, Set<string>>[];
}

function child(f: Frame): Frame {
  return { ...f, scope: { parent: f.scope, locals: [] } };
}

function declare(f: Frame, name: string, type?: Static): void {
  f.scope.locals.push(type === undefined ? { name } : { name, type });
}

function visibleLocals(scope: Scope | undefined): Local[] {
  const out: Local[] = [];
  for (let s = scope; s; s = s.parent) out.push(...[...s.locals].reverse());
  return out;
}

/** LOCAL（§6.2 第 1 步）：精确命中最近声明，否则折叠唯一。 */
function findLocal(scope: Scope, written: string): { choice: Choice; local?: Local } {
  const locals = visibleLocals(scope);
  const w = nfc(written);
  const exact = locals.find((l) => l.name === w);
  const asEntry = (l: Local): Entry => ({ written: l.name, canonical: l.name, role: 'LOCAL' });
  if (exact) return { choice: { kind: 'hit', entry: asEntry(exact) }, local: exact };
  const folded = locals.filter((l) => foldKey(l.name) === foldKey(w));
  const choice = choose([], folded.map(asEntry));
  return choice.kind === 'hit' ? { choice, local: folded.find((l) => l.name === choice.entry.canonical)! } : { choice };
}

// ---- 静态类型（§4 类型来源表） ----

/** 规范名路径的类型：首段局部名的声明类型，逐段取字段声明类型；不产生诊断。 */
function pathType(r: Resolver, scope: Scope, name: string): Static {
  const [head, ...tail] = name.split('.');
  let type = visibleLocals(scope).find((l) => l.name === head)?.type;
  for (const seg of tail) {
    if (isOpaque(r, type)) return DYNAMIC;
    const s = dataOf(r, type);
    type = s === undefined ? undefined : fieldType(r, s, seg);
  }
  return type;
}

/** 被调源码函数；同名局部名（如 lambda 绑定）遮蔽模块函数。 */
function calleeOf(r: Resolver, scope: Scope, target: Core.Expression): Core.Func | undefined {
  if (target.kind !== 'Name' || visibleLocals(scope).some((l) => l.name === target.name)) return undefined;
  return r.t.funcs.get(target.name);
}

function declaredRet(f: Core.Func | undefined): Core.Type | undefined {
  return f && !f.retTypeInferred ? f.ret : undefined;
}

/** 已解析表达式的 R2 静态类型；表外的一切为未知。 */
function typeOf(r: Resolver, scope: Scope, e: Core.Expression): Static {
  switch (e.kind) {
    case 'Name':
      return pathType(r, scope, e.name);
    case 'Construct':
      return { kind: 'TypeName', name: e.typeName };
    case 'Call':
      return declaredRet(calleeOf(r, scope, e.target));
    default:
      return undefined;
  }
}

// ---- 诊断与改写 ----

function spanOf(node: { origin?: Core.CoreNode['origin'] }): Span | undefined {
  return originToSpan(node.origin);
}

function report(r: Resolver, code: ErrorCode, at: Span | undefined, written: string, role: ResolvedRole, cands: readonly Entry[] = []): void {
  r.diags.error(code, at, { written, role, candidates: formatCandidates(cands) });
}

function warn(r: Resolver, code: ErrorCode, at: Span | undefined, written: string, role: ResolvedRole, cands: readonly Entry[]): void {
  r.diags.warning(code, at, { written, role, candidates: formatCandidates(cands) });
}

/** 写入规范名，并在 origin 上记录原写法与角色（written !== canonical 时）。 */
function renamed<T extends { origin?: Core.CoreNode['origin'] }>(node: T, patch: Partial<T>, written: string, canonical: string, role: ResolvedRole): T {
  const origin = withResolvedOrigin(node.origin, written, canonical, role);
  return origin ? { ...node, ...patch, origin } : { ...node, ...patch };
}

/** 只读标记：输入 Core 不被修改，同一 Core 上重复运行 R2 结果相同。 */
function consume(node: MarkableNode): ResolutionMark | undefined {
  return resolutionMarkOf(node);
}

// ---- FIELD_REF（点分路径与 Set 目标） ----

interface PathResult {
  readonly name: string;
  readonly type: Static;
}

/** 仅在有观察者时才构造位置（含父名计算）：编译路径零开销。 */
function observeSite(r: Resolver, make: () => ScopedResolutionSite): void {
  const onSite = r.observer?.onScopedSite;
  if (onSite) onSite(make());
}

function withParent(parent: string | undefined): { parent?: string } {
  return parent === undefined ? {} : { parent };
}

/** 写法本身即某个已声明字段的规范名（§6.2 第 5 步）：接收者类型未知时直接接受，不告警。 */
function isCanonicalField(r: Resolver, seg: string): boolean {
  const w = nfc(seg);
  return [...r.t.datas.values()].some((fs) => fs.has(w));
}

/**
 * 一个字段段：类型已知查 fields[S]；未知时规范名直写直接接受，否则按全局唯一候选采用
 * （写法与规范名不同时报 W801）。
 */
function resolveSegment(r: Resolver, type: Static, seg: string, at: Span | undefined): PathResult {
  const s = dataOf(r, type);
  if (s === undefined && isCanonicalField(r, seg)) return { name: nfc(seg), type: undefined };
  const picked = chooseField(r, s, seg);
  if (picked.kind === 'hit') {
    if (s === undefined && picked.entry.canonical !== nfc(seg)) {
      warn(r, ErrorCode.RESOLVED_WITHOUT_TYPE, at, seg, 'FIELD_REF', [picked.entry]);
    }
    const canonical = picked.entry.canonical;
    return { name: canonical, type: s === undefined ? undefined : fieldType(r, s, canonical) };
  }
  if (picked.kind === 'ambiguous') report(r, ErrorCode.AMBIGUOUS_FIELD, at, seg, 'FIELD_REF', picked.candidates);
  else report(r, ErrorCode.UNRESOLVED_FIELD, at, seg, 'FIELD_REF');
  return { name: nfc(seg), type: undefined };
}

/** 首段为局部名时解析整条路径；首段不是局部名（模块 / 类型限定名）返回 undefined。 */
function resolvePath(r: Resolver, scope: Scope, written: string, at: Span | undefined): PathResult | undefined {
  const [head, ...tail] = written.split('.') as [string, ...string[]];
  const local = findLocal(scope, head);
  if (local.choice.kind === 'miss') return undefined;
  if (!local.local) {
    report(r, ErrorCode.AMBIGUOUS_NAME, at, head, 'LOCAL', local.choice.kind === 'ambiguous' ? local.choice.candidates : []);
    return undefined;
  }
  const parts = [local.local.name];
  let type = local.local.type;
  for (const [i, seg] of tail.entries()) {
    // 类型参数没有字段：其上的字段段一定无法解析（类型检查同样拒绝），不让原写法进入 IR
    if (type !== DYNAMIC && type?.kind === 'TypeVar') report(r, ErrorCode.UNRESOLVED_FIELD, at, seg, 'FIELD_REF');
    if (isOpaque(r, type)) return { name: [...parts, ...tail.slice(i)].join('.'), type: DYNAMIC };
    const next = resolveSegment(r, type, seg, at);
    const owner = type;
    observeSite(r, () => ({
      span: at, segment: { path: written, index: i + 1 }, written: seg, canonical: next.name, role: 'FIELD_REF', ...withParent(dataOf(r, owner)),
    }));
    parts.push(next.name);
    type = next.type;
  }
  return { name: parts.join('.'), type };
}

// ---- 值位置名字 ----

/** §6.2 第 1、2、4、5 步（无期望类型）。 */
function chooseValue(r: Resolver, scope: Scope, written: string): Choice {
  const local = findLocal(scope, written).choice;
  if (local.kind !== 'miss') return local;
  return declThenVocab(r.t.valueDecls, vocabTypesAndFunctions(r), written);
}

/**
 * 与期望枚举成员同写法的冲突层候选：模块函数 / 类型、词汇函数 / 类型，以及 R1 命中而 Core 中
 * 不可见的声明（如类型别名）。其它枚举的成员不冲突——期望类型已经消歧。仅大小写不同的
 * 函数同样冲突（ADR 0051 §14 第 1 条：`hoch` 与 `Hoch` 须写限定名）。
 */
function otherLayers(r: Resolver, written: string, current: string, mark: ResolutionMark): Entry[] {
  const found = [chooseDecl(r.t.valueDecls, written), chooseVocab(vocabTypesAndFunctions(r), written)].flatMap(choiceEntries);
  const viaR1 = mark.r1Role === 'FUNC_REF' || mark.r1Role === 'TYPE';
  return found.length === 0 && viaR1 ? [{ written, canonical: current, role: mark.r1Role! }] : found;
}

function choiceEntries(c: Choice): readonly Entry[] {
  if (c.kind === 'hit') return [c.entry];
  return c.kind === 'ambiguous' ? c.candidates : [];
}

/** R1 对同一写法的值位置规则已歧义（并已在同一位置报 E804）：R2 不重复报告。 */
function reportedByR1(r: Resolver, f: Frame, mark: ResolutionMark): boolean {
  return mark.r1Role === undefined && chooseValue(r, f.scope, mark.written).kind === 'ambiguous';
}

/**
 * 期望枚举 E 下的裸名（§6.2 跨层裁决表）。成员未命中返回 undefined，交给无期望类型规则。
 */
function resolveUnderEnum(r: Resolver, f: Frame, n: Core.Name, mark: ResolutionMark, e: string): Core.Name | undefined {
  const member = chooseMember(r, e, mark.written);
  const local = findLocal(f.scope, mark.written).choice;
  const at = spanOf(n);
  if (local.kind !== 'miss') {
    // LOCAL 层先于成员：命中即取局部名，成员同时命中时提示遮蔽
    if (local.kind === 'hit' && member.kind === 'hit') warn(r, ErrorCode.SHADOWED_VOCABULARY, at, mark.written, 'LOCAL', [member.entry]);
    return member.kind === 'miss' ? undefined : n;
  }
  if (member.kind === 'miss') return undefined;
  if (member.kind === 'ambiguous') {
    report(r, ErrorCode.AMBIGUOUS_NAME, at, mark.written, 'MEMBER_REF', member.candidates);
    return n;
  }
  const others = otherLayers(r, mark.written, n.name, mark);
  if (others.length > 0) {
    if (!reportedByR1(r, f, mark)) report(r, ErrorCode.AMBIGUOUS_NAME, at, mark.written, 'MEMBER_REF', [member.entry, ...others]);
    return n;
  }
  // 保持写法形态：裸名得裸成员规范名，使本地化源码与规范名拼写的同一程序产出相同 IR
  const canonical = member.entry.canonical;
  observeSite(r, () => ({ span: at, written: mark.written, canonical, role: 'MEMBER_REF', parent: e }));
  return renamed(n, { name: canonical }, mark.written, canonical, 'MEMBER_REF');
}

/**
 * 无期望类型：沿用 R1 结果；R1 未命中时按值位置规则（歧义已由 R1 报告）。仍未命中时，
 * 写法恰为某一个源码 / 导入枚举成员的规范名则原样接受（多个枚举 → E804），否则 E802。
 */
function resolveValue(r: Resolver, f: Frame, n: Core.Name, mark: ResolutionMark, callee: boolean): Core.Name {
  if (mark.r1Role !== undefined || isBuiltinValue(n.name)) return n;
  const picked = chooseValue(r, f.scope, mark.written);
  if (picked.kind === 'hit') return renamed(n, { name: picked.entry.canonical }, mark.written, picked.entry.canonical, picked.entry.role);
  // UFCS 拆出的部分可能来自限定调用（`io.get(…)`），首段为命名空间时不报 E802
  if (picked.kind === 'ambiguous' || mark.ufcs) return n;
  const owners = [...r.t.enums].filter(([, ms]) => ms.includes(nfc(mark.written)));
  if (owners.length > 1) {
    const cands = owners.map(([e]) => ({ written: mark.written, canonical: `${e}.${nfc(mark.written)}`, role: 'MEMBER_REF' as const }));
    report(r, ErrorCode.AMBIGUOUS_NAME, spanOf(n), mark.written, 'MEMBER_REF', cands);
  }
  // 调用目标全无候选时保留原写法，由类型检查的未定义函数诊断负责
  if (owners.length === 0 && !callee) report(r, ErrorCode.UNRESOLVED_NAME, spanOf(n), mark.written, 'FUNC_REF');
  return n;
}

function resolveName(r: Resolver, f: Frame, n: Core.Name, expected: Core.Type | undefined, callee = false): Core.Name {
  const mark = consume(n);
  if (!mark) return n;
  if (mark.written.includes('.')) {
    const path = resolvePath(r, f.scope, mark.written, spanOf(n));
    return path ? renamed(n, { name: path.name }, mark.written, path.name, 'FIELD_REF') : n;
  }
  const e = enumOf(r, expected);
  const out = (e === undefined ? undefined : resolveUnderEnum(r, f, n, mark, e)) ?? resolveValue(r, f, n, mark, callee);
  recordCapture(f, n.name, out.name);
  return out;
}

/** 记录 lambda 体内裸名的改写，供改写捕获列表。 */
function recordCapture(f: Frame, before: string, after: string): void {
  for (const map of f.captures) {
    const set = map.get(before) ?? new Set<string>();
    set.add(after);
    map.set(before, set);
  }
}

// ---- 表达式 ----

function resolveExpr(r: Resolver, f: Frame, e: Core.Expression, expected?: Core.Type): Core.Expression {
  const sub = (x: Core.Expression): Core.Expression => resolveExpr(r, f, x);
  switch (e.kind) {
    case 'Name':
      return observeTyped(r, f, resolveName(r, f, e, expected));
    case 'Call':
      return resolveCall(r, f, e);
    case 'Construct':
      return resolveConstruct(r, f, e);
    case 'Ok':
    case 'Err':
    case 'Some':
    case 'Await':
      return { ...e, expr: sub(e.expr) };
    case 'IfExpr':
      return { ...e, cond: sub(e.cond), thenE: sub(e.thenE), elseE: sub(e.elseE) };
    case 'ListLit':
      return { ...e, elements: e.elements.map(sub) };
    case 'Lambda':
      return resolveLambda(r, f, e);
    case 'Bool':
    case 'Int':
    case 'Long':
    case 'Double':
    case 'Decimal':
    case 'String':
    case 'Null':
    case 'None':
      return e;
    default: {
      const never: never = e;
      throw new Error(`未处理的表达式节点：${JSON.stringify(never)}`);
    }
  }
}

/** 向观察者报告已解析名字的 §4 静态类型（不透明 / 动态视为未知）。 */
function observeTyped(r: Resolver, f: Frame, n: Core.Name): Core.Name {
  const onTyped = r.observer?.onTypedName;
  if (onTyped) onTyped(n, asType(typeOf(r, f.scope, n)));
  return n;
}

/**
 * 未被 UFCS 拆分的点分调用目标（`Text.concat(…)`、`Action.equals(…)`）是限定调用，
 * 首段为命名空间（§5 MODULE，不本地化），不按字段路径解析，原样保留。
 */
function isQualifiedCall(target: Core.Expression): boolean {
  return target.kind === 'Name' && target.name.includes('.');
}

/** 调用实参的期望类型取被调源码函数对应参数的声明类型。 */
function resolveCall(r: Resolver, f: Frame, e: Core.Call): Core.Call {
  const target = isQualifiedCall(e.target)
    ? e.target
    : e.target.kind === 'Name'
      ? resolveName(r, f, e.target, undefined, true)
      : resolveExpr(r, f, e.target);
  const params = calleeOf(r, f.scope, target)?.params ?? [];
  const expectedAt = (i: number): Core.Type | undefined => {
    const p = params[i];
    return p && !p.typeInferred ? p.type : undefined;
  };
  return { ...e, target, args: e.args.map((a, i) => resolveExpr(r, f, a, expectedAt(i))) };
}

/** ConstructField 的期望类型取所构造 Data 的字段声明类型（字段名已由 R1 解析）。 */
function resolveConstruct(r: Resolver, f: Frame, e: Core.Construct): Core.Construct {
  const fields = e.fields.map((cf) => ({ ...cf, expr: resolveExpr(r, f, cf.expr, asType(fieldType(r, e.typeName, cf.name))) }));
  return { ...e, fields };
}

function resolveLambda(r: Resolver, f: Frame, e: Core.Lambda): Core.Lambda {
  const renames = new Map<string, Set<string>>();
  const inner: Frame = { scope: { parent: f.scope, locals: [] }, ret: e.ret, captures: [...f.captures, renames] };
  for (const p of e.params) declare(inner, p.name, p.type);
  const body = resolveBlock(r, inner, e.body);
  return e.captures ? { ...e, body, captures: rewriteCaptures(e.captures, renames) } : { ...e, body };
}

/** 捕获名随解析结果改写；解析为限定名（如枚举成员 `E.M`）的不再是自由变量。 */
function rewriteCaptures(captures: readonly string[], renames: Map<string, Set<string>>): string[] {
  const out = captures.flatMap((c) => [...(renames.get(c) ?? [c])]).filter((c) => !c.includes('.'));
  return [...new Set(out)];
}

// ---- 语句 ----

function resolveBlock(r: Resolver, f: Frame, b: Core.Block): Core.Block {
  const inner = child(f);
  return { ...b, statements: b.statements.map((s) => resolveStmt(r, inner, s)) };
}

function resolveStmt(r: Resolver, f: Frame, s: Core.Statement): Core.Statement {
  switch (s.kind) {
    case 'Let': {
      const expr = resolveExpr(r, f, s.expr);
      declare(f, s.name, typeOf(r, f.scope, expr));
      return { ...s, expr };
    }
    case 'Set':
      return resolveSet(r, f, s);
    case 'Return':
      return { ...s, expr: resolveExpr(r, f, s.expr, f.ret) };
    case 'If':
      return { ...s, cond: resolveExpr(r, f, s.cond), thenBlock: resolveBlock(r, f, s.thenBlock), elseBlock: s.elseBlock ? resolveBlock(r, f, s.elseBlock) : null };
    case 'Match':
      return resolveMatch(r, f, s);
    case 'Scope': {
      const inner = child(f);
      return { ...s, statements: s.statements.map((x) => resolveStmt(r, inner, x)) };
    }
    case 'Start': {
      const expr = resolveExpr(r, f, s.expr);
      declare(f, s.name);
      return { ...s, expr };
    }
    case 'Wait':
      return s;
    case 'workflow':
      return resolveWorkflow(r, f, s);
    default: {
      const never: never = s;
      throw new Error(`未处理的语句节点：${JSON.stringify(never)}`);
    }
  }
}

/** Set 目标：单段为局部名（不解析）；点分按路径解析，最后一段的声明类型作为右侧期望类型。 */
function resolveSet(r: Resolver, f: Frame, s: Core.Set): Core.Set {
  const mark = consume(s);
  const path = mark?.written.includes('.') ? resolvePath(r, f.scope, mark.written, spanOf(s)) : undefined;
  const expr = resolveExpr(r, f, s.expr, asType(path?.type));
  return path ? renamed(s, { name: path.name, expr }, mark!.written, path.name, 'FIELD_REF') : { ...s, expr };
}

function resolveWorkflow(r: Resolver, f: Frame, s: Core.Workflow): Core.Workflow {
  const steps = s.steps.map((step) => ({
    ...step,
    body: resolveBlock(r, f, step.body),
    ...(step.compensate ? { compensate: resolveBlock(r, f, step.compensate) } : {}),
  }));
  return { ...s, steps };
}

function resolveMatch(r: Resolver, f: Frame, s: Core.Match): Core.Match {
  const expr = resolveExpr(r, f, s.expr);
  const subject = typeOf(r, f.scope, expr);
  const cases = s.cases.map((c) => resolveCase(r, child(f), c, subject));
  return { ...s, expr, cases };
}

function resolveCase(r: Resolver, f: Frame, c: Core.Case, subject: Static): Core.Case {
  const pattern = resolvePattern(r, f, c.pattern, subject);
  const body: Core.Return | Core.Block =
    c.body.kind === 'Block' ? resolveBlock(r, f, c.body) : { ...c.body, expr: resolveExpr(r, f, c.body.expr, f.ret) };
  return { ...c, pattern, body };
}

// ---- 模式 ----

function resolvePattern(r: Resolver, f: Frame, p: Core.Pattern, subject: Static): Core.Pattern {
  switch (p.kind) {
    case 'PatName':
    case 'PatternName':
      return resolvePatName(r, f, p, subject);
    case 'PatCtor':
    case 'PatternCtor':
      return resolvePatCtor(r, f, p, subject);
    case 'PatNull':
    case 'PatternNull':
    case 'PatInt':
    case 'PatternInt':
      return p;
    default: {
      const never: never = p;
      throw new Error(`未处理的模式节点：${JSON.stringify(never)}`);
    }
  }
}

/**
 * 模式名：主语为枚举 E 时，命中 enumMembers[E] 即为成员（与其它层同时命中 → E804）；
 * 主语类型未知时，仅当写法精确等于某枚举成员才视为成员（唯一 → W801，多个 → E806）；
 * 其余为绑定名。模式名是声明而非引用，故不经过 LOCAL 层。
 */
function resolvePatName(r: Resolver, f: Frame, p: Core.PatName, subject: Static): Core.PatName {
  const mark = consume(p);
  const asMember = mark ? patNameMember(r, p, mark, subject) : undefined;
  if (asMember) return asMember;
  declare(f, p.name);
  return p;
}

function patNameMember(r: Resolver, p: Core.PatName, mark: ResolutionMark, subject: Static): Core.PatName | undefined {
  const e = enumOf(r, subject);
  if (e !== undefined) return patNameUnderEnum(r, p, mark, e);
  if (typeNameOf(subject) !== undefined) return undefined;
  const member = choose(allMembers(r).filter((x) => x.written === nfc(mark.written) || x.canonical === nfc(mark.written)), []);
  if (member.kind === 'miss') return undefined;
  if (member.kind === 'ambiguous') {
    report(r, ErrorCode.AMBIGUOUS_PATTERN, spanOf(p), mark.written, 'MEMBER_REF', member.candidates);
    return p;
  }
  if (member.entry.canonical !== nfc(mark.written)) {
    warn(r, ErrorCode.RESOLVED_WITHOUT_TYPE, spanOf(p), mark.written, 'MEMBER_REF', [member.entry]);
  }
  return renamed(p, { name: member.entry.canonical }, mark.written, member.entry.canonical, 'MEMBER_REF');
}

function patNameUnderEnum(r: Resolver, p: Core.PatName, mark: ResolutionMark, e: string): Core.PatName | undefined {
  const member = chooseMember(r, e, mark.written);
  if (member.kind === 'miss') return undefined;
  const conflicts = member.kind === 'hit' ? otherLayers(r, mark.written, p.name, mark) : [];
  if (member.kind === 'ambiguous' || conflicts.length > 0) {
    report(r, ErrorCode.AMBIGUOUS_NAME, spanOf(p), mark.written, 'MEMBER_REF', [...choiceEntries(member), ...conflicts]);
    return p;
  }
  const canonical = member.entry.canonical;
  observeSite(r, () => ({ span: spanOf(p), written: mark.written, canonical, role: 'MEMBER_REF', parent: e }));
  return renamed(p, { name: canonical }, mark.written, canonical, 'MEMBER_REF');
}

/** 全部枚举成员候选：源码与导入（规范名）及词汇（原写法）。 */
function allMembers(r: Resolver): Entry[] {
  const decls = [...r.t.enums].flatMap(([, ms]) => entriesOf(ms, 'MEMBER_REF'));
  const vocab = scoped(r, (s) => s.enumMembers, undefined, 'MEMBER_REF').flatMap((m) =>
    [...m.map.values()].flat().map((c) => ({ written: c.written, canonical: c.canonical, role: m.role }))
  );
  return [...decls, ...vocab];
}

function resolvePatCtor(r: Resolver, f: Frame, p: Core.PatCtor, subject: Static): Core.PatCtor {
  const mark = consume(p);
  const args = p.args?.map((a) => resolvePattern(r, f, a, undefined));
  for (const n of p.names) declare(f, n);
  const base: Core.PatCtor = args ? { ...p, args } : { ...p };
  return mark ? ctorResolution(r, base, mark, subject) : base;
}

/** 构造器模式按主语类型的三种情形：候选来源与歧义 / 未命中时的诊断码。 */
interface CtorRule {
  readonly choice: Choice;
  readonly role: ResolvedRole;
  readonly typed: boolean;
  readonly ambiguous: ErrorCode;
  readonly unresolved: ErrorCode;
}

/** 主语为枚举 → 成员（同 R1）；为其它已知类型 → Data 构造器（同 R1）；未知 → 全部成员与构造器中唯一（W801）。 */
function ctorRule(r: Resolver, written: string, subject: Static): CtorRule {
  const e = enumOf(r, subject);
  if (e !== undefined) {
    const choice = chooseMember(r, e, written);
    return { choice, role: 'MEMBER_REF', typed: true, ambiguous: ErrorCode.AMBIGUOUS_NAME, unresolved: ErrorCode.UNRESOLVED_PATTERN };
  }
  if (typeNameOf(subject) !== undefined) {
    const choice = declThenVocab(r.t.ctorDecls, vocabTypes(r), written);
    return { choice, role: 'TYPE', typed: true, ambiguous: ErrorCode.AMBIGUOUS_NAME, unresolved: ErrorCode.UNRESOLVED_TYPE };
  }
  const members = [...r.t.enums].flatMap(([, ms]) => entriesOf(ms, 'MEMBER_REF'));
  const maps = [...scoped(r, (s) => s.enumMembers, undefined, 'MEMBER_REF'), ...vocabTypes(r)];
  const choice = declThenVocab([...members, ...r.t.ctorDecls], maps, written);
  return { choice, role: 'TYPE', typed: false, ambiguous: ErrorCode.AMBIGUOUS_PATTERN, unresolved: ErrorCode.UNRESOLVED_PATTERN };
}

function ctorResolution(r: Resolver, p: Core.PatCtor, mark: ResolutionMark, subject: Static): Core.PatCtor {
  const rule = ctorRule(r, mark.written, subject);
  const at = spanOf(p);
  if (rule.choice.kind === 'hit') {
    const { canonical, role } = rule.choice.entry;
    if (!rule.typed && canonical !== nfc(mark.written)) warn(r, ErrorCode.RESOLVED_WITHOUT_TYPE, at, mark.written, role, [rule.choice.entry]);
    observeSite(r, () => ({ span: at, written: mark.written, canonical, role, ...withParent(role === 'MEMBER_REF' ? enumOf(r, subject) : undefined) }));
    return renamed(p, { typeName: canonical }, mark.written, canonical, role);
  }
  if (rule.choice.kind === 'ambiguous') report(r, rule.ambiguous, at, mark.written, rule.role, rule.choice.candidates);
  else report(r, rule.unresolved, at, mark.written, rule.role);
  return p;
}

// ---- 入口 ----

function resolveDecl(r: Resolver, d: Core.Declaration): Core.Declaration {
  if (d.kind !== 'Func') return d;
  const f: Frame = { scope: { parent: undefined, locals: [] }, ret: declaredRet(d), captures: [] };
  for (const p of d.params) declare(f, p.name, p.typeInferred ? undefined : p.type);
  return { ...d, body: resolveBlock(r, f, d.body) };
}

/**
 * R2：解析依赖类型的名字位置。返回新的 Core（只含规范名，原写法记在 origin.written）与诊断
 * （E801/E805 字段、E802 值名、E803/E806 模式、E804 期望枚举下的歧义、W800 遮蔽、W801 无类型采用）。
 * 任一 error 时调用方不得发出 IR。observer 只读接收解析结果（LSP 用），不改变输出。
 */
export function resolveTypedReferences(
  core: Core.Module,
  ctx: ResolutionContext,
  observer?: TypedReferenceObserver
): { module: Core.Module; diagnostics: TypecheckDiagnostic[] } {
  const r: Resolver = { scopes: ctx.scopes, t: buildTables(core, ctx), diags: new DiagnosticBuilder(), observer };
  const decls = core.decls.map((d) => resolveDecl(r, d));
  return { module: { ...core, decls }, diagnostics: r.diags.getDiagnostics() };
}
