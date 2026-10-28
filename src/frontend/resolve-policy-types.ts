/**
 * @module frontend/resolve-policy-types
 *
 * 为执行输入映射提取策略的已解析类型（ADR 0051 §8）：只跑解析 + R1 + lower + R2，不做类型检查。
 * 每个声明同时给出规范名与源码原写法，供调用方把用户按策略写法提交的输入映射到规范 IR。
 */
import { LexiconRegistry, initializeAllBundledLexicons } from '../config/lexicons/index.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { buildVocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import type { DomainVocabulary } from '../config/lexicons/identifiers/types.js';
import type { Diagnostic } from '../diagnostics/diagnostics.js';
import { DiagnosticError } from '../diagnostics/diagnostics.js';
import { hasErrors, parseSource, resolveAndLower } from '../compile-pipeline.js';
import type * as AST from '../types.js';
import type { Core, TypecheckDiagnostic } from '../types.js';

/** 规范类型引用（与 Core IR 的类型节点同形） */
export type TypeRef = Core.Type;

export interface PolicyTypes {
  structs: Array<{
    canonical: string;
    written: string;
    fields: Array<{ canonical: string; written: string; type: TypeRef }>;
  }>;
  enums: Array<{ canonical: string; written: string; members: Array<{ canonical: string; written: string }> }>;
  functions: Array<{
    canonical: string;
    written: string;
    params: Array<{ name: string; type: TypeRef }>;
    returnType?: TypeRef;
  }>;
}

/** 解析诊断（语法）与名称解析诊断（E8xx / W8xx） */
export type PolicyTypesDiagnostic = Diagnostic | TypecheckDiagnostic;

export interface ResolvePolicyTypesOptions {
  /** 源码的 CNL 语言（lexicon id，如 de-DE） */
  locale: string;
  vocabulary?: DomainVocabulary;
  /** 关键词别名（ADR 0022），按语义 token 种类并入 lexicon，只影响解析 */
  aliasSet?: Record<string, string[]>;
}

export type ResolvePolicyTypesResult =
  | { ok: true; types: PolicyTypes }
  | { ok: false; diagnostics: PolicyTypesDiagnostic[] };

function lexiconFor(locale: string, aliasSet: Record<string, string[]> | undefined): Lexicon {
  initializeAllBundledLexicons();
  const base = LexiconRegistry.get(locale);
  if (!base) throw new Error(`未注册的 locale：${locale}`);
  if (!aliasSet || Object.keys(aliasSet).length === 0) return base;
  return { ...base, aliases: { ...base.aliases, ...aliasSet } };
}

/** 类型引用只保留结构，去掉源码位置（origin 中的写法与位置不属于类型身份）。 */
function typeRef(t: Core.Type): TypeRef {
  return JSON.parse(JSON.stringify(t, (k, v) => (k === 'origin' ? undefined : v))) as TypeRef;
}

const writtenOf = (resolved: AST.Resolved | undefined, fallback: string): string => resolved?.written ?? fallback;

function collect(ast: AST.Module, core: Core.Module): PolicyTypes {
  const types: PolicyTypes = { structs: [], enums: [], functions: [] };
  // lower 与 R2 都逐个映射声明，AST 与 Core 的声明下标一一对应
  core.decls.forEach((d, i) => {
    const src = ast.decls[i]!;
    if (d.kind === 'Data' && src.kind === 'Data') {
      const fields = d.fields.map((f, j) => ({
        canonical: f.name,
        written: writtenOf(src.fields[j]?.resolved, f.name),
        type: typeRef(f.type),
      }));
      types.structs.push({ canonical: d.name, written: writtenOf(src.resolved, d.name), fields });
    } else if (d.kind === 'Enum' && src.kind === 'Enum') {
      const members = d.variants.map((v, j) => ({ canonical: v, written: writtenOf(src.resolvedVariants?.[j], v) }));
      types.enums.push({ canonical: d.name, written: writtenOf(src.resolved, d.name), members });
    } else if (d.kind === 'Func' && src.kind === 'Func') {
      const params = d.params.map((p) => ({ name: p.name, type: typeRef(p.type) }));
      const returnType = d.retTypeInferred ? {} : { returnType: typeRef(d.ret) };
      types.functions.push({ canonical: d.name, written: writtenOf(src.resolved, d.name), params, ...returnType });
    }
  });
  return types;
}

/**
 * 解析策略源码中的类型声明。语法错误或任一 E8xx 时返回 ok:false 与诊断；W8xx 不影响结果。
 */
export function resolvePolicyTypes(source: string, opts: ResolvePolicyTypesOptions): ResolvePolicyTypesResult {
  const lexicon = lexiconFor(opts.locale, opts.aliasSet);
  const scopes = opts.vocabulary ? buildVocabularyScopes(opts.vocabulary) : undefined;
  try {
    const parsed = parseSource(source, lexicon, scopes);
    if (hasErrors(parsed.diagnostics)) return { ok: false, diagnostics: [...parsed.diagnostics] };
    const resolved = resolveAndLower(parsed.ast, scopes);
    if (hasErrors(resolved.diagnostics)) return { ok: false, diagnostics: [...resolved.diagnostics] };
    return { ok: true, types: collect(resolved.ast, resolved.core) };
  } catch (err) {
    if (err instanceof DiagnosticError) return { ok: false, diagnostics: [err.diagnostic] };
    throw err;
  }
}
