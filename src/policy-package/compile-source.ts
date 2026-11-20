/**
 * 源码 → 规范 Core IR 与修订 1 A2 的投影哈希（ADR 0059 §4.2）。CLI 的 B 包本地编译（`obtain-ir.ts`）与 Workers 内的
 * 重编译比对（`./package-check`，修订 3 P2-R5 / P2-R7）共用本模块，所以这里不得依赖 Node 内置模块（`node:*`、`Buffer`）。
 */
import { compile } from '../browser.js';
import { canonicalize } from '../frontend/canonicalizer.js';
import { canonicalJson } from '../core/canonical-json.js';
import { initializeAllBundledLexicons, LexiconRegistry } from '../config/lexicons/index.js';
import { buildVocabularyScopes, type VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { hasErrors, parseSource } from '../compile-pipeline.js';
import type { DomainVocabulary } from '../config/lexicons/identifiers/types.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { overlayAliases, SEMANTIC_KIND_NAMES, validateAliasSet, type AliasSet } from './alias-validate.js';
import { attributeParseFailure, checkAliasIdentifiers } from './alias-identifier-guard.js';
import { sha256HexSync } from './sha256.js';
import { decodeUtf8Strict, isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';

/** 本地编译失败：diagnostics 只写 stderr。 */
export class CompileFailure extends Error {
  constructor(readonly diagnostics: readonly string[]) {
    super(diagnostics.join('\n'));
    this.name = 'CompileFailure';
  }
}

/** 只含 ASCII 空白（空格、\t、\n、\r）或为空的源码；U+00A0、U+3000 等其他 Unicode 空白不算。 */
export const isBlankSource = (text: string): boolean => /^[ \t\n\r]*$/.test(text);

/** 空源码的拒绝消息（规范化前后两处判定共用）。 */
export const EMPTY_SOURCE_MESSAGE = '源码为空或只含 ASCII 空白';

/**
 * 规范化之后是否为空源码（与 core `InProcessCnlParser` 规范化后的二次判定同一规则，core#288）：
 * zh-CN 的 U+3000 由规范化转成半角空格，只含它的源码此时才是词法上的空源码，否则会编译成空模块；
 * en 等 locale 不转，U+3000 留给词法报 E050。开头的一个 BOM 由两引擎的词法器跳过，不算 token（core 对
 * 「BOM + 空白」同样不带码拒绝）。规范化抛错时交给编译器照常报错。
 */
function isBlankAfterCanonicalize(source: string, lexicon: Lexicon, scopes: VocabularyScopes | undefined): boolean {
  try {
    return isBlankSource(canonicalize(source.replace(/^\uFEFF/, ''), { lexicon, vocabulary: scopes }));
  } catch {
    return false;
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

/** 解析失败归因的全部探测共享的时限（毫秒），与 core `ParseBudget.DEFAULT_BUDGET` 相同。 */
const ATTRIBUTION_PROBE_BUDGET_MS = 2000;

/** 只做语法分析（规范化 + 词法 + 解析，不做名称解析）：无 error 级诊断且不抛错即通过。 */
function parsesSyntactically(source: string, lexicon: Lexicon, scopes: VocabularyScopes | undefined): boolean {
  try {
    return !hasErrors(parseSource(source, lexicon, scopes).diagnostics);
  } catch {
    return false;
  }
}

/**
 * 源码 → 规范 Core IR 字节（aliasSet 先校验再叠加）。失败抛 {@link CompileFailure}。
 *
 * 带汉字单词别名时，解析后、名称解析前跑别名名字守卫（ADR 0060 §5.3 第 2 条，E808）；解析失败而把第一条错误所在行的
 * 某个汉字单词别名换成普通名字后能通过语法分析时也报 E808（见 alias-identifier-guard.ts）。与 core `InProcessCnlParser.parseWithUserAliases` 同序。
 */
export function compileSource(source: string, opts: CompileSourceOptions): string {
  // 空白源码（只含 ASCII 空白）不交给编译器：源码形态与包形态同一判定（README「compile」）
  if (isBlankSource(source)) throw new CompileFailure([EMPTY_SOURCE_MESSAGE]);
  const base = lexiconForLocale(opts.locale);
  let scopes: VocabularyScopes | undefined;
  try {
    scopes = opts.vocabulary ? buildVocabularyScopes(opts.vocabulary) : undefined;
  } catch (e) {
    throw new CompileFailure([`词汇不合法：${(e as Error).message}`]);
  }
  const aliasErrors = validateAliasSet(opts.aliasSet, {
    base,
    allowStructural: opts.allowStructural ?? false,
    vocabulary: scopes,
    locale: opts.locale,
  });
  if (aliasErrors.length > 0) throw new CompileFailure(['用户自定义别名校验失败', ...aliasErrors]);
  const lexicon = overlayAliases(base, opts.aliasSet);
  if (isBlankAfterCanonicalize(source, lexicon, scopes)) throw new CompileFailure([EMPTY_SOURCE_MESSAGE]);
  let result;
  try {
    result = compile(source, {
      lexicon,
      ...(opts.vocabulary ? { vocabulary: opts.vocabulary } : {}),
      astGuard: (ast) => checkAliasIdentifiers(ast, opts.aliasSet, opts.locale),
    });
  } catch (e) {
    throw new CompileFailure([`编译器异常：${(e as Error).message}`]);
  }
  if (!result.success && result.parseErrors && result.parseErrors.length > 0) {
    // 全部探测共享一个时限（与 core 共享的语法分析预算同值）；用尽后不再探测，保留原解析错误
    const deadline = Date.now() + ATTRIBUTION_PROBE_BUDGET_MS;
    const attributed = attributeParseFailure(source, result.parseErrors[0]?.span?.start.line, opts.aliasSet, opts.locale, {
      exhausted: () => Date.now() > deadline,
      parses: (probe) => parsesSyntactically(probe, lexicon, scopes),
    });
    if (attributed) throw new CompileFailure([JSON.stringify(attributed)]);
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
  return sha256HexSync(canonicalJson(tree));
}
