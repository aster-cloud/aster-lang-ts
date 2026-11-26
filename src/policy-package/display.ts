/**
 * 包格式 1.1 显示排版的 CLI 编排（ADR 0059 修订 4 D5–D8）：`verify` 的 display / display-ir 检查、`show`、
 * `run --display` 共用。规则本身在 `../layout`（L1–L7、反向映射、L8 / L9 的字符串部分），这里只负责：
 *   - 从包取规则上下文（词汇 localized、包 locale 与 en-US 词法表的字面量关键词与运算符拼写、aliasSet 运算符别名）；
 *   - 显示文本文件的读取（usage 阶段）；
 *   - L8 / L9 需要的编译（与 `recompile` 同一组编译输入）与 positionFreeSha256 比较；
 *   - stderr 上给人看的结构映射与字面量宏说明。
 * 行为以 aster-lang-test `conformance/package-v1/README.md`「显示排版」「show」「run --display」为准。
 */
import { readFileSync, statSync } from 'node:fs';
import { foldKey, compareCodePoints } from '../config/lexicons/identifiers/casefold.js';
import {
  checkHiddenEscapes,
  hiddenEscapeTriples,
  checkDerivedLayout,
  checkPackageLayout,
  irNameStrings,
  layoutRuleOf,
  padStructuralSpans,
  reconstructFromDisplay,
  structuralNameHits,
  type LayoutRuleContext,
  type PolicyLayout,
} from '../layout/index.js';
import { LAYOUT_LIMITS } from '../layout/types.js';
import { OPERATOR_KINDS, type AliasSet } from './alias-validate.js';
import { CompileFailure, compileSource, lexiconForLocale, parseAliasSetJson, parseVocabularyJson, positionFreeSha256 } from './compile-source.js';
import { PackageError } from './errors.js';
import type { LoadedPackage } from './read-package.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';

/** 显示排版的两个固定路径（D1）。 */
export const LAYOUT_PATH = 'policy/display/layout.json';
export const DISPLAY_PATH = 'policy/display/display.aster';

/** 字面量关键词的 kind（L6(c)）。 */
export const LITERAL_KINDS: readonly string[] = ['TRUE', 'FALSE', 'NULL', 'NONE'];

/** `--display` / `--from-display` 文件的大小上限：display 字节上限 + 开头 BOM（3 字节）。超出不读内容。 */
export const MAX_DISPLAY_FILE_BYTES = LAYOUT_LIMITS.displayBytes + 3;

/** 某个 locale 词法表中一组 kind 的全部拼写（keywords 与词法表 aliases），foldKey、按码点排序去重。 */
function spellingsOf(locale: string, kinds: Iterable<string>): string[] {
  const lex = lexiconForLocale(locale);
  const keywords = lex.keywords as Readonly<Record<string, string>>;
  const aliases = (lex.aliases ?? {}) as Readonly<Record<string, readonly string[] | undefined>>;
  const all: string[] = [];
  for (const k of kinds) {
    if (keywords[k] !== undefined) all.push(keywords[k]!);
    all.push(...(aliases[k] ?? []));
  }
  return [...new Set(all.map(foldKey))].sort(compareCodePoints);
}

/** 一个 locale 的字面量关键词与运算符拼写（与 aster-lang-test `vectors/keyword-spellings.json` 同形）。 */
export function keywordSpellings(locale: string): { literal: string[]; operator: string[] } {
  return { literal: spellingsOf(locale, LITERAL_KINDS), operator: spellingsOf(locale, OPERATOR_KINDS) };
}

/** 词汇 JSON 全部条目（全部 kind 的数组）的 `localized`。 */
function vocabularyLocalized(vocab: JsonValue | undefined): string[] {
  const out: string[] = [];
  if (!isJsonObject(vocab)) return out;
  for (const v of Object.values(vocab)) {
    if (!Array.isArray(v)) continue;
    for (const e of v) if (isJsonObject(e) && typeof e['localized'] === 'string') out.push(e['localized']);
  }
  return out;
}

/** 包 locale ∪ en-US 的拼写，运算符另并入 aliasSet 中运算符 kind 的别名。 */
export function ruleContext(locale: string, aliasSet: AliasSet | null, vocab: JsonValue | undefined): LayoutRuleContext {
  const loc = keywordSpellings(locale);
  const en = keywordSpellings('en-US');
  const aliases = Object.entries(aliasSet ?? {})
    .filter(([k]) => OPERATOR_KINDS.has(k))
    .flatMap(([, v]) => v);
  return {
    vocabularyLocalized: vocabularyLocalized(vocab),
    literalKeywords: [...loc.literal, ...en.literal],
    operatorSpellings: [...loc.operator, ...en.operator, ...aliases],
  };
}

/** 包的编译输入（与本地重编译相同）。 */
interface CompileInputs {
  readonly locale: string;
  readonly aliasSet: AliasSet | null;
  readonly allowStructural: boolean;
  readonly vocabulary: ReturnType<typeof parseVocabularyJson> | undefined;
  readonly vocabTree: JsonValue | undefined;
}

function compileInputs(pkg: LoadedPackage): CompileInputs {
  const vocabBytes = pkg.files.get('policy/compile/vocabulary.json');
  let aliasSet: AliasSet | null = null;
  try {
    aliasSet = parseAliasSetJson(pkg.files.get('policy/compile/alias-set.json')!);
  } catch {
    aliasSet = null;
  }
  let vocabTree: JsonValue | undefined;
  try {
    vocabTree = vocabBytes ? parseStrictJson(vocabBytes) : undefined;
  } catch {
    vocabTree = undefined;
  }
  return {
    locale: pkg.manifest.source.locale,
    aliasSet,
    allowStructural: pkg.manifest.source.allowStructural,
    vocabulary: vocabTree !== undefined ? parseVocabularyJson(vocabBytes!) : undefined,
    vocabTree,
  };
}

/** 包的规则上下文。 */
export function packageRuleContext(pkg: LoadedPackage): LayoutRuleContext {
  const c = compileInputs(pkg);
  return ruleContext(c.locale, c.aliasSet, c.vocabTree);
}

/** manifest 有 display（1.1）时返回 layoutVersion，否则 null。 */
export function displayMember(pkg: LoadedPackage): { layoutVersion: number } | null {
  return pkg.manifest.display ?? null;
}

/**
 * display 阶段：包排版 L1–L7（不编译）。包没有 display 时返回 null；失败抛 PKG_DISPLAY_INVALID（display）。
 */
export function checkPackageDisplay(pkg: LoadedPackage): PolicyLayout | null {
  const member = displayMember(pkg);
  if (!member) return null;
  try {
    return checkPackageLayout({
      layoutBytes: pkg.files.get(LAYOUT_PATH)!,
      displayBytes: pkg.files.get(DISPLAY_PATH)!,
      source: pkg.files.get('policy/policy.aster')!,
      layoutVersion: member.layoutVersion,
      ...packageRuleContext(pkg),
      // L10b 要编译：verify 记在 display-ir（checkDisplayIr），show / run --display 由 checkPackageHiddenEscapes 补跑
      l10b: 'deferred',
    });
  } catch (e) {
    const rule = layoutRuleOf(e);
    if (rule === undefined) throw e;
    throw new PackageError('PKG_DISPLAY_INVALID', 'display', `显示排版 ${(e as Error).message}`);
  }
}

/** 按包的编译输入编译一段源码；失败抛 CompileFailure。 */
function compileWith(pkg: LoadedPackage, source: string): string {
  const c = compileInputs(pkg);
  return compileSource(source, { locale: c.locale, aliasSet: c.aliasSet, allowStructural: c.allowStructural, vocabulary: c.vocabulary });
}

/** L10b 的编译接缝：按包的编译输入取 positionFreeSha256，编译失败为 undefined。 */
function hashWith(pkg: LoadedPackage): (source: string) => string | undefined {
  return (source) => {
    try {
      return positionFreeSha256(compileWith(pkg, source));
    } catch (e) {
      if (e instanceof CompileFailure) return undefined;
      throw e;
    }
  };
}

/** L10b 的失败原因（null 表示通过或没有隐藏转义）。 */
function hiddenEscapeProblem(pkg: LoadedPackage, layout: PolicyLayout): string | null {
  try {
    checkHiddenEscapes(layout, hashWith(pkg));
    return null;
  } catch (e) {
    if (layoutRuleOf(e) === undefined) throw e;
    return (e as Error).message;
  }
}

/**
 * show / run --display 的包排版 L10b（ADR 0059 修订 5 §2.4）：含隐藏转义时编译 policy.aster 与去掉反引号的各个变体，
 * 失败抛 PKG_DISPLAY_INVALID。verify 不调它：verify 的 L10b 在 display-ir（--recompile）。
 */
export function checkPackageHiddenEscapes(pkg: LoadedPackage, layout: PolicyLayout): void {
  const why = hiddenEscapeProblem(pkg, layout);
  if (why !== null) throw new PackageError('PKG_DISPLAY_INVALID', 'display', `显示排版 ${why}`);
}

/**
 * L8 / L9：coreJson 为该排版规范源码的编译结果。返回失败原因（null 表示通过）。
 * L8：IR 中 name / written 的字符串不得整词出现在结构 canonical 中；L9：补空格后的源码必须编译成功且投影哈希不变。
 */
export function displayIrProblem(pkg: LoadedPackage, layout: PolicyLayout, coreJson: string): string | null {
  const hits = structuralNameHits(layout, irNameStrings(coreJson));
  if (hits.length > 0) return `L8: 结构 span 中出现了 IR 名字 ${JSON.stringify(hits)}`;
  let padded: string;
  try {
    padded = compileWith(pkg, padStructuralSpans(layout));
  } catch (e) {
    if (e instanceof CompileFailure) return `L9: 补空格后的源码编译失败：${e.diagnostics.join('; ').slice(0, 300)}`;
    throw e;
  }
  if (positionFreeSha256(padded) !== positionFreeSha256(coreJson)) return 'L9: 补空格后投影哈希改变（结构 span 切进了值或名字）';
  // L10b（ADR 0059 修订 5）：去掉被隐藏的反引号不得得到另一个程序
  return hiddenEscapeProblem(pkg, layout);
}

/** verify 的 display-ir：coreJson 为本地重编译 policy/ 的结果。失败抛 PKG_DISPLAY_INVALID。 */
export function checkDisplayIr(pkg: LoadedPackage, layout: PolicyLayout, coreJson: string): void {
  const why = displayIrProblem(pkg, layout, coreJson);
  if (why !== null) throw new PackageError('PKG_DISPLAY_INVALID', 'display-ir', `显示排版 ${why}`);
}

/** 读入的编辑后显示文本（usage 阶段）；oversize 时不读内容，之后为 DISPLAY_UNMAPPABLE。 */
export interface EditedDisplay {
  readonly oversize: boolean;
  readonly text: string | null;
}

/** `--display` / `--from-display` 的文件：不存在、不是普通文件、不可读、非法 UTF-8 为 USAGE；去掉至多一个 BOM。 */
export function readEditedDisplay(path: string, opt: string): EditedDisplay {
  let bytes: Uint8Array;
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new PackageError('USAGE', 'usage', `${opt} 不是普通文件：${path}`);
    if (st.size > MAX_DISPLAY_FILE_BYTES) return { oversize: true, text: null };
    bytes = readFileSync(path);
  } catch (e) {
    if (e instanceof PackageError) throw e;
    throw new PackageError('USAGE', 'usage', `${opt} 不存在或不可读：${path}`);
  }
  let text: string;
  try {
    // 严格 UTF-8；开头的 BOM 保留在文本里，下面只去掉一个
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new PackageError('USAGE', 'usage', `${opt} 不是合法 UTF-8：${path}`);
  }
  return { oversize: false, text: text.startsWith('﻿') ? text.slice(1) : text };
}

/** 派生程序：还原出的排版、规范源码与其 Core IR。 */
export interface DerivedProgram {
  readonly layout: PolicyLayout;
  readonly canonical: string;
  readonly coreJson: string;
  readonly matchesPackage: boolean;
}

/**
 * reconstruct → derived（L2、L5、L6、L7）→ compile → display-ir（L8、L9）。失败抛对应码：
 * DISPLAY_UNMAPPABLE / DISPLAY_AMBIGUOUS（reconstruct）、DISPLAY_REJECTED（derived / display-ir）、COMPILE_ERROR（compile）。
 */
export function deriveProgram(pkg: LoadedPackage, layout: PolicyLayout, edited: EditedDisplay, stderr: string[]): DerivedProgram {
  if (edited.oversize || edited.text === null) {
    throw new PackageError('DISPLAY_UNMAPPABLE', 'reconstruct', `显示文本超过 ${LAYOUT_LIMITS.displayBytes} 字节`);
  }
  const r = reconstructFromDisplay(layout, edited.text);
  if (r.kind === 'unmappable') {
    if (r.crlf) stderr.push('aster: 显示文本文件使用 CRLF 换行；结构 span 以 \\n 为界，请改用 LF 换行后重试');
    throw new PackageError('DISPLAY_UNMAPPABLE', 'reconstruct', `显示文本在偏移 ${r.offset}（UTF-16）附近无法对应到包的排版`);
  }
  if (r.kind === 'ambiguous') {
    throw new PackageError('DISPLAY_AMBIGUOUS', 'reconstruct', `显示文本有不止一种对应方式（分歧约在偏移 ${r.offset}）；请让隐藏空格旁的一句保持原样`);
  }
  const ctx = packageRuleContext(pkg);
  try {
    checkDerivedLayout(r.layout, ctx.vocabularyLocalized, ctx.literalKeywords, ctx.operatorSpellings);
  } catch (e) {
    if (layoutRuleOf(e) === undefined) throw e;
    throw new PackageError('DISPLAY_REJECTED', 'derived', `派生排版 ${(e as Error).message}`);
  }
  const canonical = r.canonical;
  let coreJson: string;
  try {
    coreJson = compileWith(pkg, canonical);
  } catch (e) {
    if (e instanceof CompileFailure) throw new PackageError('COMPILE_ERROR', 'compile', `派生源码编译失败：\n${e.diagnostics.join('\n')}`);
    throw e;
  }
  const why = displayIrProblem(pkg, r.layout, coreJson);
  if (why !== null) throw new PackageError('DISPLAY_REJECTED', 'display-ir', `派生排版 ${why}`);
  return { layout: r.layout, canonical, coreJson, matchesPackage: positionFreeSha256(coreJson) === pkg.manifest.coreIr.positionFreeSha256 };
}

/**
 * show 的 stderr 说明（不跨 CLI 比较）：结构映射（每个 display ≠ canonical 的结构 span 一行 `display ⇐ canonical`，
 * JSON 字符串形式、去重保序）与字面量宏（触发词 → 展开值）。
 */
export function structureNotes(pkg: LoadedPackage, layout: PolicyLayout): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const s of layout.spans) {
    if ('text' in s || s.display === s.canonical) continue;
    const l = `${JSON.stringify(s.display)} ⇐ ${JSON.stringify(s.canonical)}`;
    if (!seen.has(l)) {
      seen.add(l);
      lines.push(l);
    }
  }
  const out: string[] = [];
  if (lines.length > 0) out.push('aster: 显示排版中的结构文字（display ⇐ canonical，只是排版，编译的是 canonical）：', ...lines);
  // 被隐藏的转义（ADR 0059 修订 5 §4.3）：显示里看不到反引号，这些词是名字
  const hidden = hiddenEscapeTriples(layout);
  if (hidden.length > 0) {
    out.push('aster: 显示里隐藏了反引号的名字转义（这些词是名字，不是关键词）：', ...hidden.map((t) => `hidden escape: ${JSON.stringify(`\`${t.name}\``)} (name)`));
  }
  const vocab = compileInputs(pkg).vocabTree;
  const literals = isJsonObject(vocab) && Array.isArray(vocab['literals']) ? vocab['literals'] : [];
  const macros = literals
    .filter((e): e is { [key: string]: JsonValue } => isJsonObject(e) && typeof e['localized'] === 'string' && typeof e['canonical'] === 'string')
    .map((e) => `${e['localized'] as string} → ${e['canonical'] as string}`);
  if (macros.length > 0) out.push('aster: 字面量宏（显示的是触发词，编译的是展开值）：', ...macros);
  return out;
}
