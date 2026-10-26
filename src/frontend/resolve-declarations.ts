/**
 * @module frontend/resolve-declarations
 *
 * 名称解析阶段 R1（ADR 0051 §4–§6）：在 AST 上解析不依赖类型的位置——
 * 声明名（Data / Enum / Func / 字段 / 枚举成员）、全部类型位置、函数引用、
 * 枚举限定引用 `E.M`、构造表达式的类型名与字段名、主语类型已知的 PatternCtor。
 *
 * 节点的 name 保持原写法，结果写入 `resolved`。点分后续段、期望枚举下的裸名、
 * 主语未知的 PatternCtor 以及 PatternName 留给 R2（Core 上的类型驱动解析）。
 * 输入 AST 不被修改。
 */
import { compareCodePoints, foldKey, nfc } from '../config/lexicons/identifiers/casefold.js';
import { lookup } from '../config/lexicons/identifiers/scopes.js';
import type { Candidate, VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { DiagnosticBuilder } from '../typecheck/diagnostics.js';
import type * as AST from '../types.js';
import type { Resolved, ResolvedRole, Span, TypecheckDiagnostic } from '../types.js';
import type { ResolutionContext } from './resolution-context.js';

// ---- 候选与选择 ----

/** 参与匹配的一项：written 为可匹配的写法，canonical 为命中后的规范名。 */
interface Entry {
  readonly written: string;
  readonly canonical: string;
  readonly role: ResolvedRole;
}

type Choice =
  | { readonly kind: 'hit'; readonly entry: Entry }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly Entry[] }
  | { readonly kind: 'miss' };

const MISS: Choice = { kind: 'miss' };

function distinct(entries: readonly Entry[]): Entry[] {
  const seen = new Map<string, Entry>();
  for (const e of entries) seen.set(`${e.role}\u0000${e.canonical}`, e);
  return [...seen.values()];
}

/** 精确命中优先；无精确时折叠命中唯一才采用；同层多个不同规范名即歧义。 */
function choose(exact: readonly Entry[], folded: readonly Entry[]): Choice {
  for (const layer of [exact, folded]) {
    const uniq = distinct(layer);
    if (uniq.length === 1) return { kind: 'hit', entry: uniq[0]! };
    if (uniq.length > 1) return { kind: 'ambiguous', candidates: uniq };
  }
  return MISS;
}

/** 源码声明（含导入）：按原写法与规范名双向匹配。 */
function chooseDecl(decls: readonly Entry[], written: string): Choice {
  const w = nfc(written);
  const key = foldKey(w);
  const exact = decls.filter((d) => d.written === w || d.canonical === w);
  const folded = decls.filter((d) => foldKey(d.written) === key || foldKey(d.canonical) === key);
  return choose(exact, folded);
}

function toEntries(cands: readonly Candidate[], role: ResolvedRole): Entry[] {
  return cands.map((c) => ({ written: c.written, canonical: c.canonical, role }));
}

/** 词汇（§6.2 第 4 步）后接规范名直写（第 5 步）。 */
function chooseVocab(maps: readonly VocabMap[], written: string): Choice {
  const exact = maps.flatMap((m) => toEntries(lookup(m.map, written).exact, m.role));
  const folded = maps.flatMap((m) => toEntries(lookup(m.map, written).folded, m.role));
  const picked = choose(exact, folded);
  if (picked.kind !== 'miss') return picked;
  const w = nfc(written);
  const direct = maps.flatMap((m) => toEntries(byCanonical(m.map).get(w) ?? [], m.role));
  return choose(direct, []);
}

interface VocabMap {
  readonly map: ReadonlyMap<string, Candidate[]>;
  readonly role: ResolvedRole;
}

/** 规范名 → 候选的反向索引，按词汇映射缓存，避免每次未命中都全表扫描。 */
const canonicalIndex = new WeakMap<ReadonlyMap<string, Candidate[]>, Map<string, Candidate[]>>();

function byCanonical(map: ReadonlyMap<string, Candidate[]>): Map<string, Candidate[]> {
  const cached = canonicalIndex.get(map);
  if (cached) return cached;
  const index = new Map<string, Candidate[]>();
  for (const c of [...map.values()].flat()) index.set(c.canonical, [...(index.get(c.canonical) ?? []), c]);
  canonicalIndex.set(map, index);
  return index;
}

function formatCandidates(cands: readonly Entry[]): string {
  return cands
    .map((c) => `${c.canonical} (${c.written})`)
    .sort(compareCodePoints)
    .join(', ');
}

// ---- 模块符号表 ----

/** 本模块与导入模块已解析的声明，供引用位置的 §6.2 第 2 步使用。 */
interface ModuleTable {
  readonly types: Entry[];
  readonly functions: Entry[];
  readonly enums: Set<string>;
  readonly members: Map<string, Entry[]>;
  readonly fields: Map<string, Entry[]>;
}

interface Resolver {
  readonly scopes: VocabularyScopes | undefined;
  readonly table: ModuleTable;
  readonly diags: DiagnosticBuilder;
}

/** 词法作用域：局部名链，按父链向外查找。 */
interface Scope {
  readonly parent: Scope | undefined;
  readonly locals: Local[];
}

/** 源码局部名；typeName 为其声明类型（已解析的规范名），未知时缺省。 */
interface Local {
  readonly name: string;
  readonly typeName?: string;
}

function childScope(parent: Scope): Scope {
  return { parent, locals: [] };
}

function visibleLocals(scope: Scope | undefined): Local[] {
  const out: Local[] = [];
  for (let s = scope; s; s = s.parent) out.push(...[...s.locals].reverse());
  return out;
}

function findLocal(scope: Scope, written: string): Choice & { local?: Local } {
  const locals = visibleLocals(scope);
  const w = nfc(written);
  const hit = locals.find((l) => l.name === w);
  if (hit) return { kind: 'hit', entry: localEntry(hit.name), local: hit };
  const folded = locals.filter((l) => foldKey(l.name) === foldKey(w));
  const picked = choose([], folded.map((l) => localEntry(l.name)));
  if (picked.kind !== 'hit') return picked;
  return { ...picked, local: folded[0]! };
}

function localEntry(name: string): Entry {
  return { written: name, canonical: name, role: 'LOCAL' };
}

// ---- 诊断 ----

const SPAN0: Span = { start: { line: 0, col: 0 }, end: { line: 0, col: 0 } };

function reportAmbiguous(r: Resolver, written: string, role: ResolvedRole, cands: readonly Entry[], span?: Span): void {
  r.diags.error(ErrorCode.AMBIGUOUS_NAME, span ?? SPAN0, {
    written,
    role,
    candidates: formatCandidates(cands),
  });
}

/** 源码名胜出、而词汇对同一写法精确给出不同规范名时 → W800。 */
function warnShadow(r: Resolver, written: string, winner: Entry, maps: readonly VocabMap[], span?: Span): void {
  const w = nfc(written);
  const shadowed = maps.some((m) => lookup(m.map, w).exact.some((c) => c.canonical !== winner.canonical));
  if (!shadowed) return;
  r.diags.warning(ErrorCode.SHADOWED_VOCABULARY, span ?? SPAN0, {
    written,
    role: winner.role,
    candidates: winner.canonical,
  });
}

function resolvedOf(entry: Entry, written: string, role: ResolvedRole = entry.role): Resolved {
  return { canonical: entry.canonical, role, written };
}

// ---- 声明（§6.1） ----

function vocabTypes(r: Resolver): VocabMap[] {
  return r.scopes ? [{ map: r.scopes.types, role: 'TYPE' }] : [];
}

function vocabFunctions(r: Resolver): VocabMap[] {
  return r.scopes ? [{ map: r.scopes.functions, role: 'FUNC_REF' }] : [];
}

function scopedVocab(
  r: Resolver,
  pick: (s: VocabularyScopes) => ReadonlyMap<string, ReadonlyMap<string, Candidate[]>>,
  parent: string,
  role: ResolvedRole
): VocabMap[] {
  const map = r.scopes ? pick(r.scopes).get(parent) : undefined;
  return map ? [{ map, role }] : [];
}

/** 声明写法 → 规范名：精确命中词汇 → 折叠唯一 → 原写法；折叠多候选报 E804。 */
function declare(r: Resolver, written: string, role: ResolvedRole, maps: readonly VocabMap[], span?: Span): Resolved {
  const picked = chooseVocab(maps, written);
  if (picked.kind === 'hit') return resolvedOf(picked.entry, written, role);
  if (picked.kind === 'ambiguous') reportAmbiguous(r, written, role, picked.candidates, span);
  return { canonical: nfc(written), role, written };
}

interface DeclaredSite {
  readonly resolved: Resolved;
  readonly span: Span | undefined;
}

/** 同角色同作用域两个声明解析到同一规范名 → E807（报在后一处）。 */
function checkDuplicates(r: Resolver, sites: readonly DeclaredSite[]): void {
  const first = new Map<string, Resolved>();
  for (const { resolved, span } of sites) {
    const prev = first.get(resolved.canonical);
    if (!prev) {
      first.set(resolved.canonical, resolved);
      continue;
    }
    r.diags.error(ErrorCode.DUPLICATE_DECLARATION, span ?? SPAN0, {
      written: resolved.written,
      role: resolved.role,
      candidates: `${prev.written}, ${resolved.written} → ${resolved.canonical}`,
    });
  }
}

/** 预先解析全部声明名，建立模块符号表（含导入），供后续引用位置使用。 */
interface DeclNames {
  readonly byDecl: Map<AST.Declaration, Resolved>;
  readonly fieldNames: Map<AST.Data, Resolved[]>;
  readonly variantNames: Map<AST.Enum, Resolved[]>;
}

function declareTopLevel(r: Resolver, decls: readonly AST.Declaration[]): DeclNames {
  const names: DeclNames = { byDecl: new Map(), fieldNames: new Map(), variantNames: new Map() };
  const typeSites: DeclaredSite[] = [];
  const funcSites: DeclaredSite[] = [];
  for (const d of decls) {
    if (d.kind === 'Import') continue;
    const isFunc = d.kind === 'Func';
    const resolved = isFunc
      ? declare(r, d.name, 'FUNC_DECL', vocabFunctions(r), d.span)
      : declare(r, d.name, 'TYPE_DECL', vocabTypes(r), d.span);
    names.byDecl.set(d, resolved);
    (isFunc ? funcSites : typeSites).push({ resolved, span: d.span });
  }
  checkDuplicates(r, typeSites);
  checkDuplicates(r, funcSites);
  for (const [d, resolved] of names.byDecl) registerDecl(r, names, d, resolved);
  return names;
}

function registerDecl(r: Resolver, names: DeclNames, d: AST.Declaration, resolved: Resolved): void {
  const entry: Entry = { written: nfc(resolved.written), canonical: resolved.canonical, role: 'TYPE' };
  switch (d.kind) {
    case 'Func':
      r.table.functions.push({ ...entry, role: 'FUNC_REF' });
      return;
    case 'Data': {
      r.table.types.push(entry);
      const fields = d.fields.map((f) =>
        declare(r, f.name, 'FIELD_DECL', scopedVocab(r, (s) => s.fields, resolved.canonical, 'FIELD_REF'), f.span)
      );
      checkDuplicates(r, fields.map((f, i) => ({ resolved: f, span: d.fields[i]!.span })));
      names.fieldNames.set(d, fields);
      r.table.fields.set(resolved.canonical, fields.map((f) => refEntry(f, 'FIELD_REF')));
      return;
    }
    case 'Enum': {
      r.table.types.push(entry);
      r.table.enums.add(resolved.canonical);
      const members = declareVariants(r, d, resolved.canonical);
      names.variantNames.set(d, members);
      r.table.members.set(resolved.canonical, members.map((m) => refEntry(m, 'MEMBER_REF')));
      return;
    }
    case 'Import':
      return;
    default: {
      const never: never = d;
      throw new Error(`未处理的声明：${JSON.stringify(never)}`);
    }
  }
}

function declareVariants(r: Resolver, d: AST.Enum, parent: string): Resolved[] {
  const maps = scopedVocab(r, (s) => s.enumMembers, parent, 'MEMBER_REF');
  const members = d.variants.map((v, i) => declare(r, v, 'MEMBER_DECL', maps, d.variantSpans?.[i] ?? d.span));
  checkDuplicates(r, members.map((m, i) => ({ resolved: m, span: d.variantSpans?.[i] ?? d.span })));
  return members;
}

function refEntry(resolved: Resolved, role: ResolvedRole): Entry {
  return { written: nfc(resolved.written), canonical: resolved.canonical, role };
}

function registerImports(table: ModuleTable, ctx: ResolutionContext): void {
  const own = (name: string, role: ResolvedRole): Entry => ({ written: name, canonical: name, role });
  table.types.push(...ctx.imports.types.map((t) => own(t, 'TYPE')));
  table.functions.push(...ctx.imports.functions.map((f) => own(f, 'FUNC_REF')));
  for (const [e, ms] of ctx.imports.enumMembers) {
    table.enums.add(e);
    table.members.set(e, ms.map((m) => own(m, 'MEMBER_REF')));
  }
  for (const [s, fs] of ctx.imports.fields) table.fields.set(s, fs.map((f) => own(f, 'FIELD_REF')));
}

// ---- 引用（§6.2 第 1、2、4、5 步） ----

/** 源码声明 → 词汇 → 原写法（类型名、构造字段名、枚举成员共用）。 */
function resolveRef(
  r: Resolver,
  ref: { readonly written: string; readonly role: ResolvedRole; readonly span: Span | undefined },
  decls: readonly Entry[],
  maps: readonly VocabMap[]
): string {
  const { written, role, span } = ref;
  const fromDecl = chooseDecl(decls, written);
  if (fromDecl.kind === 'hit') {
    warnShadow(r, written, { ...fromDecl.entry, role }, maps, span);
    return fromDecl.entry.canonical;
  }
  const picked = fromDecl.kind === 'miss' ? chooseVocab(maps, written) : fromDecl;
  if (picked.kind === 'hit') return picked.entry.canonical;
  if (picked.kind === 'ambiguous') reportAmbiguous(r, written, role, picked.candidates, span);
  return nfc(written);
}

function resolveTypeName(r: Resolver, written: string, span?: Span): Resolved {
  const canonical = resolveRef(r, { written, role: 'TYPE', span }, r.table.types, vocabTypes(r));
  return { canonical, role: 'TYPE', written };
}

/** 值位置单段名：LOCAL → 模块函数/类型 → 词汇函数/类型 → 规范名直写；全部失败留给 R2。 */
function resolveValueName(r: Resolver, scope: Scope, written: string, span?: Span): Resolved | undefined {
  const maps = [...vocabFunctions(r), ...vocabTypes(r)];
  const local = findLocal(scope, written);
  const decl = local.kind === 'miss' ? chooseDecl([...r.table.functions, ...r.table.types], written) : local;
  const picked = decl.kind === 'miss' ? chooseVocab(maps, written) : decl;
  const role: ResolvedRole = local.kind === 'miss' ? 'FUNC_REF' : 'LOCAL';
  if (picked.kind === 'ambiguous') reportAmbiguous(r, written, role, picked.candidates, span);
  if (picked.kind !== 'hit') return undefined;
  if (decl.kind === 'hit') warnShadow(r, written, picked.entry, maps, span);
  return resolvedOf(picked.entry, written);
}

/** `E.M`：首段非局部名、非函数且解析为枚举类型时，按 enumMembers[E] 解析成员。 */
function resolveQualified(r: Resolver, scope: Scope, written: string, span?: Span): Resolved | undefined {
  const parts = written.split('.');
  if (parts.length !== 2) return undefined;
  const [head, tail] = parts as [string, string];
  if (findLocal(scope, head).kind !== 'miss') return undefined;
  if (chooseDecl(r.table.functions, head).kind !== 'miss') return undefined;
  const enumName = resolveTypeName(r, head, span).canonical;
  if (!r.table.enums.has(enumName) && !r.scopes?.enumMembers.has(enumName)) return undefined;
  const member = resolveMember(r, enumName, tail, span);
  return { canonical: `${enumName}.${member}`, role: 'MEMBER_REF', written };
}

function resolveMember(r: Resolver, enumName: string, written: string, span?: Span): string {
  const maps = scopedVocab(r, (s) => s.enumMembers, enumName, 'MEMBER_REF');
  return resolveRef(r, { written, role: 'MEMBER_REF', span }, r.table.members.get(enumName) ?? [], maps);
}

function resolveName(r: Resolver, scope: Scope, n: AST.Name): AST.Name {
  const resolved = n.name.includes('.')
    ? resolveQualified(r, scope, n.name, n.span)
    : resolveValueName(r, scope, n.name, n.span);
  return resolved ? { ...n, resolved } : n;
}

// ---- 类型 ----

function resolveType(r: Resolver, scope: Scope, t: AST.Type): AST.Type {
  const sub = (x: AST.Type): AST.Type => resolveType(r, scope, x);
  switch (t.kind) {
    case 'TypeName':
      // TS 解析器把类型参数的使用也表示为 TypeName（并把未声明的大写类型名推断为类型参数），
      // 按 §5 一律作 TYPE 位置解析：源码声明 → 词汇 → 原写法
      return { ...t, resolved: resolveTypeName(r, t.name, t.span) };
    case 'TypeApp':
      return { ...t, args: t.args.map(sub), resolved: resolveTypeName(r, t.base, t.span) };
    case 'Maybe':
    case 'Option':
    case 'List':
      return { ...t, type: sub(t.type) };
    case 'Result':
      return { ...t, ok: sub(t.ok), err: sub(t.err) };
    case 'Map':
      return { ...t, key: sub(t.key), val: sub(t.val) };
    case 'FuncType':
      return { ...t, params: t.params.map(sub), ret: sub(t.ret) };
    case 'TypePii':
      return { ...t, baseType: sub(t.baseType) };
    case 'TypeVar':
    case 'EffectVar':
      return t;
    default: {
      const never: never = t;
      throw new Error(`未处理的类型节点：${JSON.stringify(never)}`);
    }
  }
}

/** 参数：名为 LOCAL（不查词汇），类型递归解析；已知类型名记入作用域供模式匹配使用。 */
function resolveParam<P extends { readonly name: string; readonly type: AST.Type }>(
  r: Resolver,
  scope: Scope,
  p: P
): P & { readonly resolved: Resolved } {
  const type = resolveType(r, scope, p.type);
  const typeName = type.kind === 'TypeName' ? type.resolved?.canonical : undefined;
  scope.locals.push(typeName === undefined ? { name: nfc(p.name) } : { name: nfc(p.name), typeName });
  return { ...p, type, resolved: { canonical: p.name, role: 'LOCAL', written: p.name } };
}

// ---- 表达式 ----

function resolveExpr(r: Resolver, scope: Scope, e: AST.Expression): AST.Expression {
  const sub = (x: AST.Expression): AST.Expression => resolveExpr(r, scope, x);
  switch (e.kind) {
    case 'Name':
      return resolveName(r, scope, e);
    case 'Call':
      return { ...e, target: sub(e.target), args: e.args.map(sub) };
    case 'Construct':
      return resolveConstruct(r, scope, e);
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
      return resolveLambda(r, scope, e);
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

/** `X with f = …`：X 按 TYPE 解析，字段按已解析的 X 查 fields[X]。 */
function resolveConstruct(r: Resolver, scope: Scope, e: AST.Construct): AST.Construct {
  const type = resolveTypeName(r, e.typeName, e.span);
  const maps = scopedVocab(r, (s) => s.fields, type.canonical, 'FIELD_REF');
  const decls = r.table.fields.get(type.canonical) ?? [];
  const fields = e.fields.map((f) => {
    const canonical = resolveRef(r, { written: f.name, role: 'FIELD_REF', span: f.span }, decls, maps);
    const resolved: Resolved = { canonical, role: 'FIELD_REF', written: f.name };
    return { ...f, expr: resolveExpr(r, scope, f.expr), resolved };
  });
  return { ...e, fields, resolved: type };
}

function resolveLambda(r: Resolver, scope: Scope, e: AST.Lambda): AST.Lambda {
  const inner = childScope(scope);
  const params = e.params.map((p) => resolveParam(r, inner, p));
  return { ...e, params, retType: resolveType(r, inner, e.retType), body: resolveBlock(r, inner, e.body) };
}

// ---- 语句 ----

function resolveBlock(r: Resolver, scope: Scope, b: AST.Block): AST.Block {
  const inner = childScope(scope);
  return { ...b, statements: b.statements.map((s) => resolveStmt(r, inner, s)) };
}

function resolveStmt(r: Resolver, scope: Scope, s: AST.Statement): AST.Statement {
  const expr = (x: AST.Expression): AST.Expression => resolveExpr(r, scope, x);
  switch (s.kind) {
    case 'Let':
      return resolveLet(r, scope, s);
    case 'Set':
      // Set 目标属于 FIELD_REF（R2）
      return { ...s, expr: expr(s.expr) };
    case 'Return':
      return { ...s, expr: expr(s.expr) };
    case 'If':
      return resolveIf(r, scope, s);
    case 'Match':
      return resolveMatch(r, scope, s);
    case 'Start':
      scope.locals.push({ name: nfc(s.name) });
      return { ...s, expr: expr(s.expr) };
    case 'Wait':
      return s;
    case 'workflow':
      return resolveWorkflow(r, scope, s);
    case 'Block':
      return resolveBlock(r, scope, s);
    case 'Name':
    case 'Bool':
    case 'Int':
    case 'Long':
    case 'Double':
    case 'Decimal':
    case 'String':
    case 'Null':
    case 'Call':
    case 'Construct':
    case 'Ok':
    case 'Err':
    case 'Some':
    case 'None':
    case 'Lambda':
    case 'Await':
    case 'IfExpr':
    case 'ListLit':
      return expr(s);
    default: {
      const never: never = s;
      throw new Error(`未处理的语句节点：${JSON.stringify(never)}`);
    }
  }
}

function resolveLet(r: Resolver, scope: Scope, s: AST.Let): AST.Let {
  const expr = resolveExpr(r, scope, s.expr);
  scope.locals.push({ name: nfc(s.name) });
  return { ...s, expr, resolved: { canonical: s.name, role: 'LOCAL', written: s.name } };
}

function resolveIf(r: Resolver, scope: Scope, s: AST.If): AST.If {
  return {
    ...s,
    cond: resolveExpr(r, scope, s.cond),
    thenBlock: resolveBlock(r, scope, s.thenBlock),
    elseBlock: s.elseBlock ? resolveBlock(r, scope, s.elseBlock) : null,
  };
}

function resolveWorkflow(r: Resolver, scope: Scope, s: AST.WorkflowStmt): AST.WorkflowStmt {
  // 工作流与步骤名为源码局部声明，不查词汇
  const steps = s.steps.map((step) => ({
    ...step,
    body: resolveBlock(r, scope, step.body),
    ...(step.compensate ? { compensate: resolveBlock(r, scope, step.compensate) } : {}),
  }));
  return { ...s, steps };
}

/** Match 主语为已知类型的局部名（参数）时，PatternCtor 可在 R1 解析。 */
function subjectType(scope: Scope, e: AST.Expression): string | undefined {
  if (e.kind !== 'Name' || e.name.includes('.')) return undefined;
  const local = findLocal(scope, e.name);
  return local.kind === 'hit' ? local.local?.typeName : undefined;
}

function resolveMatch(r: Resolver, scope: Scope, s: AST.Match): AST.Match {
  const expr = resolveExpr(r, scope, s.expr);
  const subject = subjectType(scope, s.expr);
  const cases = s.cases.map((c) => resolveCase(r, childScope(scope), c, subject));
  return { ...s, expr, cases };
}

function resolveCase(r: Resolver, scope: Scope, c: AST.Case, subject: string | undefined): AST.Case {
  const pattern = resolvePattern(r, scope, c.pattern, subject);
  const body: AST.Return | AST.Block =
    c.body.kind === 'Block' ? resolveBlock(r, scope, c.body) : { ...c.body, expr: resolveExpr(r, scope, c.body.expr) };
  return { ...c, pattern, body };
}

// ---- 模式 ----

const KEYWORD_CTORS: ReadonlySet<string> = new Set(['Ok', 'Err', 'Some', 'None']);

function resolvePattern(r: Resolver, scope: Scope, p: AST.Pattern, subject: string | undefined): AST.Pattern {
  switch (p.kind) {
    case 'PatternName':
    case 'PatName':
      // 绑定名不查词汇；期望枚举下的裸名是否为成员由 R2 判定，故不写 resolved
      scope.locals.push({ name: nfc(p.name) });
      return p;
    case 'PatternCtor':
    case 'PatCtor':
      return resolvePatternCtor(r, scope, p, subject);
    case 'PatternNull':
    case 'PatNull':
    case 'PatternInt':
    case 'PatInt':
      return p;
    default: {
      const never: never = p;
      throw new Error(`未处理的模式节点：${JSON.stringify(never)}`);
    }
  }
}

function resolvePatternCtor(r: Resolver, scope: Scope, p: AST.PatternCtor, subject: string | undefined): AST.PatternCtor {
  for (const n of p.names) scope.locals.push({ name: nfc(n) });
  const args = p.args?.map((a) => resolvePattern(r, scope, a, undefined));
  const base: AST.PatternCtor = args ? { ...p, args } : p;
  const resolved = ctorResolution(r, p, subject);
  return resolved ? { ...base, resolved } : base;
}

function ctorResolution(r: Resolver, p: AST.PatternCtor, subject: string | undefined): Resolved | undefined {
  if (subject === undefined || KEYWORD_CTORS.has(p.typeName)) return undefined;
  if (r.table.enums.has(subject) || r.scopes?.enumMembers.has(subject)) {
    return { canonical: resolveMember(r, subject, p.typeName, p.span), role: 'MEMBER_REF', written: p.typeName };
  }
  return resolveTypeName(r, p.typeName, p.span);
}

// ---- 声明节点改写 ----

function rewriteDecl(r: Resolver, names: DeclNames, d: AST.Declaration): AST.Declaration {
  const resolved = names.byDecl.get(d);
  switch (d.kind) {
    case 'Import':
      return d;
    case 'Data':
      return rewriteData(r, d, resolved!, names.fieldNames.get(d) ?? []);
    case 'Enum':
      return { ...d, resolved: resolved!, resolvedVariants: names.variantNames.get(d) ?? [] };
    case 'Func':
      return rewriteFunc(r, d, resolved!);
    default: {
      const never: never = d;
      throw new Error(`未处理的声明：${JSON.stringify(never)}`);
    }
  }
}

function rootScope(): Scope {
  return { parent: undefined, locals: [] };
}

function rewriteData(r: Resolver, d: AST.Data, resolved: Resolved, fieldNames: readonly Resolved[]): AST.Data {
  const scope = rootScope();
  const fields = d.fields.map((f, i) => ({ ...f, type: resolveType(r, scope, f.type), resolved: fieldNames[i]! }));
  return { ...d, fields, resolved };
}

function rewriteFunc(r: Resolver, d: AST.Func, resolved: Resolved): AST.Func {
  const scope = rootScope();
  const params = d.params.map((p) => resolveParam(r, scope, p));
  const retType = resolveType(r, scope, d.retType);
  const body = d.body ? resolveBlock(r, scope, d.body) : null;
  return { ...d, params, retType, body, resolved };
}

// ---- 入口 ----

/**
 * R1：解析声明与类型位置。返回新的 AST（输入不变）与诊断
 * （E804 歧义、E807 重复声明、W800 遮蔽词汇）。
 */
export function resolveDeclarations(
  module: AST.Module,
  ctx: ResolutionContext
): { module: AST.Module; diagnostics: TypecheckDiagnostic[] } {
  const table: ModuleTable = { types: [], functions: [], enums: new Set(), members: new Map(), fields: new Map() };
  const r: Resolver = { scopes: ctx.scopes, table, diags: new DiagnosticBuilder() };
  const names = declareTopLevel(r, module.decls);
  registerImports(table, ctx);
  const decls = module.decls.map((d) => rewriteDecl(r, names, d));
  return { module: { ...module, decls }, diagnostics: r.diags.getDiagnostics() };
}
