/**
 * ir 阶段：取得求值用的 Core IR（README「检查顺序」ir 行，ADR 0059 §4.2、修订 1 A2）。
 *
 *   - A 包：严格读入 `compiled/core.json`（`readCoreIr`），失败 `PKG_UNSUPPORTED_IR`，IR 原样使用；
 *   - B 包：按 manifest 的 locale / aliasSet / allowStructural / 词汇本地编译（含 aliasSet 校验），
 *     去掉 `origin.start.col` / `origin.end.col` 后的规范字节 SHA-256 必须等于 `coreIr.positionFreeSha256`，
 *     编译失败或不等都是 `PKG_IR_DRIFT`，绝不求值；没有绕过参数。
 * `coreIr.sha256` 仍是平台 IR 的精确字节哈希，进 `meta.coreIrSha256`；本地 IR 的哈希不进信封。
 */
import { compile } from '../browser.js';
import { canonicalJson } from '../core/canonical-json.js';
import { readCoreIr } from '../core/read-core-ir.js';
import { initializeAllBundledLexicons, LexiconRegistry } from '../config/lexicons/index.js';
import { buildVocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import type { DomainVocabulary } from '../config/lexicons/identifiers/types.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { overlayAliases, SEMANTIC_KIND_NAMES, validateAliasSet, type AliasSet } from './alias-validate.js';
import { fail } from './errors.js';
import { sha256Hex } from './integrity.js';
import type { LoadedPackage } from './read-package.js';
import { decodeUtf8Strict, isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';

/** 本地编译失败：diagnostics 只写 stderr。 */
export class CompileFailure extends Error {
  constructor(readonly diagnostics: readonly string[]) {
    super(diagnostics.join('\n'));
    this.name = 'CompileFailure';
  }
}

export interface CompileSourceOptions {
  readonly locale: string;
  readonly aliasSet?: AliasSet | null | undefined;
  readonly allowStructural?: boolean;
  readonly vocabulary?: DomainVocabulary | undefined;
}

/**
 * locale → 内置词法表，与 aster-api `UserAliasValidator.resolveBase` 同一回退：
 * 不区分大小写精确匹配，否则 `zh*` → zh-CN、`de*` → de-DE，再否则缺省（en-US）。
 */
export function lexiconForLocale(locale: string): Lexicon {
  initializeAllBundledLexicons();
  const norm = locale.toLowerCase().replace(/_/g, '-');
  const id = LexiconRegistry.list().find((x) => x.toLowerCase() === norm);
  if (id) return LexiconRegistry.get(id)!;
  const prefixed = norm.startsWith('zh') ? 'zh-CN' : norm.startsWith('de') ? 'de-DE' : undefined;
  return (prefixed ? LexiconRegistry.get(prefixed) : undefined) ?? LexiconRegistry.getDefault();
}

/**
 * `policy/compile/alias-set.json`（或 `compile --alias-set` 的文件）→ aliasSet。与 aster-api `PolicyCompiler.parseAliasSetJson`
 * 同一 fail-closed 规则：`null` 为无别名；否则必须是「kind 名 → 字符串数组」的对象，未知 kind 即失败。
 */
export function parseAliasSetJson(bytes: Uint8Array): AliasSet | null {
  let tree: JsonValue;
  try {
    tree = parseStrictJson(bytes);
  } catch (e) {
    throw new CompileFailure([`alias-set JSON 损坏，拒绝编译（fail-closed）：${(e as Error).message}`]);
  }
  if (tree === null) return null;
  if (!isJsonObject(tree)) throw new CompileFailure(['alias-set 必须是对象或 null']);
  const out: Record<string, string[]> = {};
  for (const [kind, list] of Object.entries(tree)) {
    if (!SEMANTIC_KIND_NAMES.has(kind)) throw new CompileFailure([`alias-set 含未知 kind '${kind}'，拒绝编译（fail-closed）`]);
    if (!Array.isArray(list) || list.some((a) => typeof a !== 'string')) throw new CompileFailure([`alias-set 的 ${kind} 必须是字符串数组`]);
    out[kind] = list as string[];
  }
  return out;
}

/** 词汇 JSON（`policy/compile/vocabulary.json` 或 `compile --vocabulary`）。 */
export function parseVocabularyJson(bytes: Uint8Array): DomainVocabulary {
  let tree: JsonValue;
  try {
    tree = parseStrictJson(bytes);
  } catch (e) {
    throw new CompileFailure([`词汇 JSON 损坏：${(e as Error).message}`]);
  }
  if (!isJsonObject(tree)) throw new CompileFailure(['词汇 JSON 必须是对象']);
  return tree as unknown as DomainVocabulary;
}

/** 源码 → 规范 Core IR 字节（aliasSet 先校验再叠加）。失败抛 {@link CompileFailure}。 */
export function compileSource(source: string, opts: CompileSourceOptions): string {
  const base = lexiconForLocale(opts.locale);
  let scopes;
  try {
    scopes = opts.vocabulary ? buildVocabularyScopes(opts.vocabulary) : undefined;
  } catch (e) {
    throw new CompileFailure([`词汇不合法：${(e as Error).message}`]);
  }
  const aliasErrors = validateAliasSet(opts.aliasSet, { base, allowStructural: opts.allowStructural ?? false, vocabulary: scopes });
  if (aliasErrors.length > 0) throw new CompileFailure(['用户自定义别名校验失败', ...aliasErrors]);
  let result;
  try {
    result = compile(source, { lexicon: overlayAliases(base, opts.aliasSet), ...(opts.vocabulary ? { vocabulary: opts.vocabulary } : {}) });
  } catch (e) {
    throw new CompileFailure([`编译器异常：${(e as Error).message}`]);
  }
  if (!result.success || result.coreJson === undefined) {
    const diags = [
      ...(result.parseErrors ?? []).map((d) => JSON.stringify(d)),
      ...(result.loweringErrors ?? []),
      ...(result.resolutionDiagnostics ?? []).map((d) => JSON.stringify(d)),
    ];
    throw new CompileFailure(diags.length > 0 ? diags : ['编译失败']);
  }
  return result.coreJson;
}

/**
 * `.aster` 源码的解码（README「compile」）：严格 UTF-8，去掉至多一个开头的 BOM；非法字节抛 StrictJsonError。
 * `compile <file.aster>` 与包内 `policy/policy.aster` 共用。
 */
export function decodeSourceText(bytes: Uint8Array): string {
  const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  return decodeUtf8Strict(body);
}

/** 按 manifest 本地编译包内 `policy/`（B 包的 run、两种包的 `verify --recompile`、`compile <pkg>` 共用）。 */
export function compilePackageSource(pkg: LoadedPackage): string {
  const file = (p: string): Uint8Array | undefined => pkg.files.get(p);
  let source: string;
  try {
    source = decodeSourceText(file('policy/policy.aster')!);
  } catch {
    throw new CompileFailure(['policy/policy.aster 不是合法 UTF-8']);
  }
  const vocabBytes = file('policy/compile/vocabulary.json');
  return compileSource(source, {
    locale: pkg.manifest.source.locale,
    aliasSet: parseAliasSetJson(file('policy/compile/alias-set.json')!),
    allowStructural: pkg.manifest.source.allowStructural,
    vocabulary: vocabBytes ? parseVocabularyJson(vocabBytes) : undefined,
  });
}

/** 只删除每个 `origin` 对象的 `start.col` 与 `end.col`（缺失或非整数即失败）。 */
function dropOriginCols(node: unknown): void {
  if (Array.isArray(node)) {
    for (const x of node) dropOriginCols(x);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'origin' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const side of ['start', 'end'] as const) {
        const pos = (value as Record<string, unknown>)[side] as Record<string, unknown> | undefined;
        if (!pos || typeof pos !== 'object' || !Number.isInteger(pos['col'])) throw new Error(`origin.${side}.col 缺失或不是整数`);
        delete pos['col'];
      }
    }
    dropOriginCols(value);
  }
}

/** 修订 1 A2 的投影哈希：规范 Core IR 文本 → 去列后规范 JSON 的 UTF-8 SHA-256（小写 hex）。 */
export function positionFreeSha256(coreJson: string): string {
  const tree = JSON.parse(coreJson) as unknown;
  dropOriginCols(tree);
  return sha256Hex(Buffer.from(canonicalJson(tree), 'utf8'));
}

/** 严格读入 A 包的 `compiled/core.json`；失败 `PKG_UNSUPPORTED_IR`。 */
export function readCompiledIr(pkg: LoadedPackage): string {
  const bytes = pkg.files.get('compiled/core.json')!;
  try {
    const text = decodeUtf8Strict(bytes);
    readCoreIr(text);
    return text;
  } catch (e) {
    return fail('ir', 'PKG_UNSUPPORTED_IR', `compiled/core.json 严格读入失败：${(e as Error).message}`);
  }
}

/** B 包本地编译并按投影哈希比对；失败 `PKG_IR_DRIFT`（诊断写进 detail，只进 stderr）。 */
export function recompileAndCompare(pkg: LoadedPackage): string {
  let coreJson: string;
  try {
    coreJson = compilePackageSource(pkg);
  } catch (e) {
    const diags = e instanceof CompileFailure ? e.diagnostics.join('\n') : String(e);
    return fail('ir', 'PKG_IR_DRIFT', `本地编译失败：\n${diags}`);
  }
  let local: string;
  try {
    local = positionFreeSha256(coreJson);
  } catch (e) {
    return fail('ir', 'PKG_IR_DRIFT', `本地 IR 无法投影：${(e as Error).message}`);
  }
  if (local !== pkg.manifest.coreIr.positionFreeSha256) {
    fail('ir', 'PKG_IR_DRIFT', `本地 IR 投影哈希 ${local} ≠ coreIr.positionFreeSha256 ${pkg.manifest.coreIr.positionFreeSha256}`);
  }
  return coreJson;
}

/** 取得求值用的 IR。 */
export function obtainIr(pkg: LoadedPackage): { coreJson: string; recompiled: boolean } {
  if (pkg.manifest.mode === 'a') return { coreJson: readCompiledIr(pkg), recompiled: false };
  return { coreJson: recompileAndCompare(pkg), recompiled: true };
}
