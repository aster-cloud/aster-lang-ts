/**
 * LSP 的名称解析视图（ADR 0051 §5「LSP」一行与 Review Focus 1）。
 *
 * - 语法完整：R1 → lower → R2，收集全部按角色解析的位置（悬停用）与值位置名字的 §4 静态类型（字段补全用）。
 * - 语法不完整（解析器报 error，AST 为恢复出的片段）：只对已解析部分运行 R1，**跳过 R2**——
 *   未完成代码上的类型驱动解析不可信，其诊断会级联；悬停仍提供 R1 可得的信息，字段补全降级为不提供。
 * - 任一阶段抛错都降级为空视图：编辑中的源码绝不能让悬停 / 补全 / 诊断失败。
 *
 * 结果按 AST 对象缓存：同一文档版本的诊断、悬停与补全共用一次解析。
 */
import { nfc } from '../config/lexicons/identifiers/casefold.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { resolveAndLower, resolveDeclarationsOnly } from '../compile-pipeline.js';
import type { ScopedResolutionSite, TypedReferenceObserver } from '../core/resolve-typed-references.js';
import { originToSpan } from '../typecheck/pure.js';
import type { Core, Module as AstModule, ResolvedRole, Span, TypecheckDiagnostic } from '../types.js';

/** 一个按角色解析的写法及其源码位置。 */
export interface ResolutionSite {
  readonly span: Span;
  readonly written: string;
  readonly canonical: string;
  readonly role: ResolvedRole;
  /** 字段 / 枚举成员所属的规范父名；未知时缺省 */
  readonly parent?: string;
}

/** 值位置名字（含点分路径）与其 §4 静态类型。 */
export interface TypedName {
  readonly span: Span;
  readonly type: Core.Type;
}

export interface DocumentResolution {
  /** 是否运行了 R2（语法完整） */
  readonly complete: boolean;
  readonly sites: readonly ResolutionSite[];
  readonly typedNames: readonly TypedName[];
  /** R2 输出的 Core；仅语法完整时存在 */
  readonly core?: Core.Module;
  readonly diagnostics: readonly TypecheckDiagnostic[];
}

/** 解析所需的文档快照（server 的 CachedDoc 满足此形状）。 */
export interface ResolvableDocument {
  readonly ast: AstModule | null | undefined;
  readonly parseDiagnostics?: readonly { readonly severity: string }[];
  readonly vocabulary?: VocabularyScopes;
}

const EMPTY: DocumentResolution = { complete: false, sites: [], typedNames: [], diagnostics: [] };

const cache = new WeakMap<AstModule, DocumentResolution>();

export function resolveDocument(doc: ResolvableDocument): DocumentResolution {
  const ast = doc.ast;
  if (!ast) return EMPTY;
  const hit = cache.get(ast);
  if (hit) return hit;
  const complete = !(doc.parseDiagnostics ?? []).some((d) => d.severity === 'error');
  const result = safely(() => (complete ? resolveComplete(ast, doc.vocabulary) : resolvePartial(ast, doc.vocabulary)));
  cache.set(ast, result);
  return result;
}

function safely(run: () => DocumentResolution): DocumentResolution {
  try {
    return run();
  } catch {
    return EMPTY;
  }
}

function resolvePartial(ast: AstModule, vocabulary: VocabularyScopes | undefined): DocumentResolution {
  const r1 = resolveDeclarationsOnly(ast, vocabulary);
  return { complete: false, sites: collectR1Sites(r1.ast), typedNames: [], diagnostics: r1.diagnostics };
}

function resolveComplete(ast: AstModule, vocabulary: VocabularyScopes | undefined): DocumentResolution {
  const scoped: ResolutionSite[] = [];
  const typedNames: TypedName[] = [];
  const observer: TypedReferenceObserver = {
    onScopedSite: (site) => {
      const s = r2Site(site);
      if (s) scoped.push(s);
    },
    onTypedName: (name, type) => {
      const span = originToSpan(name.origin);
      if (span && type) typedNames.push({ span, type });
    },
  };
  const resolved = resolveAndLower(ast, vocabulary, observer);
  const sites = [...collectR1Sites(resolved.ast), ...scoped];
  return { complete: true, sites, typedNames, core: resolved.core, diagnostics: resolved.diagnostics };
}

// ---- 位置收集 ----

/** 点分写法中第 index 段的位置；写法与位置宽度不符（跨行 / 含空白）时退回整条路径。 */
function segmentSpan(span: Span, written: string, index: number): Span {
  const sameLine = span.start.line === span.end.line;
  if (!sameLine || span.end.col - span.start.col !== written.length) return span;
  const parts = written.split('.');
  const offset = parts.slice(0, index).reduce((n, p) => n + p.length + 1, 0);
  const col = span.start.col + offset;
  return { start: { line: span.start.line, col }, end: { line: span.start.line, col: col + (parts[index]?.length ?? 0) } };
}

function r2Site(site: ScopedResolutionSite): ResolutionSite | undefined {
  if (!site.span) return undefined;
  const span = site.segment ? segmentSpan(site.span, site.segment.path, site.segment.index) : site.span;
  const parent = site.parent === undefined ? {} : { parent: site.parent };
  return { span, written: site.written, canonical: site.canonical, role: site.role, ...parent };
}

interface AstNode {
  readonly kind?: string;
  readonly span?: Span;
  readonly nameSpan?: Span;
  readonly resolved?: { readonly canonical: string; readonly role: ResolvedRole; readonly written: string };
  readonly resolvedVariants?: readonly { readonly canonical: string; readonly role: ResolvedRole; readonly written: string }[];
  readonly variantSpans?: readonly Span[];
  readonly [key: string]: unknown;
}

/** 不含子节点的键：避免把元数据当作节点遍历。 */
const LEAF_KEYS: ReadonlySet<string> = new Set(['span', 'nameSpan', 'variantSpans', 'resolved', 'resolvedVariants', 'origin']);

/** 遍历 R1 输出的 AST，收集全部 resolved。字段的父名取所在 Data / 构造的类型，成员的父名取所在枚举。 */
function collectR1Sites(ast: AstModule): ResolutionSite[] {
  const out: ResolutionSite[] = [];
  const owners = memberOwners(ast);
  const visit = (node: unknown, parent: string | undefined): void => {
    if (Array.isArray(node)) return node.forEach((x) => visit(x, parent));
    if (!node || typeof node !== 'object') return;
    const n = node as AstNode;
    out.push(...ownSites(n, parent, owners));
    for (const [key, value] of Object.entries(n)) {
      if (!LEAF_KEYS.has(key)) visit(value, key === 'fields' ? n.resolved?.canonical : undefined);
    }
  };
  visit(ast, undefined);
  return out;
}

/** 枚举成员规范名 → 唯一所属枚举（多个枚举同名成员时不给父名）。 */
function memberOwners(ast: AstModule): Map<string, string | undefined> {
  const owners = new Map<string, string | undefined>();
  for (const d of ast.decls as unknown as readonly AstNode[]) {
    if (d.kind !== 'Enum' || !d.resolved) continue;
    for (const m of d.resolvedVariants ?? []) {
      owners.set(m.canonical, owners.has(m.canonical) ? undefined : d.resolved.canonical);
    }
  }
  return owners;
}

function ownSites(n: AstNode, parent: string | undefined, owners: Map<string, string | undefined>): ResolutionSite[] {
  const span = n.nameSpan ?? n.span;
  const r = n.resolved;
  const own = r && span ? siteOf(span, r, parent, owners) : [];
  if (n.kind !== 'Enum' || !r) return own;
  const variants = (n.resolvedVariants ?? []).flatMap((m, i) => {
    const at = n.variantSpans?.[i] ?? n.span;
    return at ? [{ span: at, written: m.written, canonical: m.canonical, role: m.role, parent: r.canonical }] : [];
  });
  return [...own, ...variants];
}

function siteOf(
  span: Span,
  r: NonNullable<AstNode['resolved']>,
  parent: string | undefined,
  owners: Map<string, string | undefined>
): ResolutionSite[] {
  if (r.role === 'MEMBER_REF' && r.written.includes('.')) return qualifiedMember(span, r);
  const owner = r.role === 'MEMBER_REF' ? owners.get(r.canonical) : isScopedRole(r.role) ? parent : undefined;
  const site: ResolutionSite = { span, written: r.written, canonical: r.canonical, role: r.role };
  return [owner === undefined ? site : { ...site, parent: owner }];
}

function isScopedRole(role: ResolvedRole): boolean {
  return role === 'FIELD_DECL' || role === 'FIELD_REF' || role === 'MEMBER_DECL';
}

/** `E.M`：首段为 TYPE，末段为 enumMembers[E] 的成员。 */
function qualifiedMember(span: Span, r: NonNullable<AstNode['resolved']>): ResolutionSite[] {
  const written = r.written.split('.');
  const canonical = r.canonical.split('.');
  if (written.length !== 2 || canonical.length !== 2) return [];
  const [we, wm] = written as [string, string];
  const [ce, cm] = canonical as [string, string];
  return [
    { span: segmentSpan(span, r.written, 0), written: we, canonical: ce, role: 'TYPE' },
    { span: segmentSpan(span, r.written, 1), written: wm, canonical: cm, role: 'MEMBER_REF', parent: ce },
  ];
}

// ---- 查询 ----

/** LSP 位置（0 基）是否落在 span（1 基、end 不含）内。 */
function contains(span: Span, pos: { line: number; character: number }): boolean {
  const line = pos.line + 1;
  const col = pos.character + 1;
  if (line < span.start.line || line > span.end.line) return false;
  if (line === span.start.line && col < span.start.col) return false;
  return !(line === span.end.line && col > span.end.col);
}

function area(span: Span): number {
  return (span.end.line - span.start.line) * 100000 + (span.end.col - span.start.col);
}

/** 光标处写法为 word 的解析位置（多个时取最内层）。 */
export function siteAt(
  res: DocumentResolution,
  pos: { line: number; character: number },
  word: string
): ResolutionSite | undefined {
  const w = nfc(word);
  const hits = res.sites.filter((s) => nfc(s.written) === w && contains(s.span, pos));
  return hits.sort((a, b) => area(a.span) - area(b.span))[0];
}
