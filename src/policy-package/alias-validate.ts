/**
 * 用户自定义关键词别名校验：aster-api `UserAliasValidator`（ADR 0022 §11.5，方案 D，VERSION "1"）的 ts 移植，
 * 以及 `AliasOverlayLexicon.wrap` 的合并叠加语义。
 *
 * JVM 侧 `InProcessCnlParser.parseWithUserAliases` 在编译内校验 aliasSet；Node 的 B 包本地编译与 `compile --alias-set`
 * 必须做同样的校验，两个 CLI 才能在校验规则相同时对同一份 aliasSet 给出同一结论（P0 结果 §4）。规则逐条对应 Java 版：
 *   - 白名单两档（deny-by-default）：运算符 / 比较 kind 恒允许；结构词 kind 仅 `allowStructural` 时允许；其余恒拒；
 *   - DoS 上界：kind ≤ 32、每 kind ≤ 8 条、每条 ≤ 64 个 UTF-16 码元；
 *   - 提交值必须已是规范形（trim、词间单个空格、小写）；仅多词；不遮蔽 base 规范拼写 / base 别名；
 *     跨 kind 不重复；不与领域词汇标识符同形（折叠后比较）。
 */
import { SemanticTokenKind } from '../config/token-kind.js';
import { foldKey } from '../config/lexicons/identifiers/casefold.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import type { Lexicon } from '../config/lexicons/types.js';

/** 与 Java `UserAliasValidator.VERSION` 相同。 */
export const USER_ALIAS_VALIDATOR_VERSION = '1';
export const MAX_ALIAS_KINDS = 32;
export const MAX_ALIASES_PER_KIND = 8;
export const MAX_ALIAS_LENGTH = 64;

/** aliasSet：语义 token 种类名 → 别名短语。 */
export type AliasSet = Readonly<Record<string, readonly string[]>>;

const OPERATOR_KINDS: ReadonlySet<string> = new Set([
  SemanticTokenKind.PLUS,
  SemanticTokenKind.MINUS_WORD,
  SemanticTokenKind.TIMES,
  SemanticTokenKind.DIVIDED_BY,
  SemanticTokenKind.INTEGER_DIVIDED_BY,
  SemanticTokenKind.MODULO,
  SemanticTokenKind.LESS_THAN,
  SemanticTokenKind.GREATER_THAN,
  SemanticTokenKind.EQUALS_TO,
  SemanticTokenKind.AT_LEAST,
  SemanticTokenKind.AT_MOST,
]);

const STRUCTURAL_KINDS: ReadonlySet<string> = new Set([
  SemanticTokenKind.MODULE_DECL,
  SemanticTokenKind.FUNC_TO,
  SemanticTokenKind.IF,
  SemanticTokenKind.OTHERWISE,
  SemanticTokenKind.MATCH,
  SemanticTokenKind.WHEN,
  SemanticTokenKind.RETURN,
]);

/** 全部合法的语义 token 种类名（aliasSet JSON 的键必须在其中，否则 fail-closed）。 */
export const SEMANTIC_KIND_NAMES: ReadonlySet<string> = new Set(Object.values(SemanticTokenKind));

/** Java `String.trim()`：去掉首尾 ≤ U+0020 的字符。 */
function javaTrim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s.charCodeAt(a) <= 0x20) a++;
  while (b > a && s.charCodeAt(b - 1) <= 0x20) b--;
  return s.slice(a, b);
}

/** Java `String.isBlank()`：全部为 `Character.isWhitespace`（不含不换行空格）。 */
function javaIsBlank(s: string): boolean {
  return /^[\t\n\u000B\f\r\u001C-\u001F \u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]*$/.test(s);
}

/** 与 Java 版相同的归一：trim + 折叠 ASCII 空白（Java `\s`）为单个空格 + 小写。 */
export function normalizeAlias(s: string): string {
  return javaTrim(s).replace(/[ \t\n\u000B\f\r]+/g, ' ').toLowerCase();
}

/** 别名与任一角色的词汇写法折叠后相同（字面量宏不算标识符）。 */
function vocabularyHasWritten(scopes: VocabularyScopes | undefined, phrase: string): boolean {
  if (!scopes) return false;
  const key = foldKey(phrase);
  return (
    scopes.types.has(key) ||
    scopes.functions.has(key) ||
    [...scopes.fields.values()].some((m) => m.has(key)) ||
    [...scopes.enumMembers.values()].some((m) => m.has(key))
  );
}

export interface ValidateAliasSetOptions {
  /** 基础 lexicon（取规范拼写与已有别名做不遮蔽校验） */
  readonly base: Lexicon;
  /** 是否放开结构词别名（缺省 false） */
  readonly allowStructural?: boolean;
  /** 领域词汇作用域；缺省不做别名与标识符的碰撞校验 */
  readonly vocabulary?: VocabularyScopes | undefined;
}

/** 校验 aliasSet；返回错误列表（空即通过）。错误文本与 Java 版同义，只写 stderr。 */
export function validateAliasSet(aliasSet: AliasSet | null | undefined, opts: ValidateAliasSetOptions): string[] {
  if (!aliasSet) return [];
  const entries = Object.entries(aliasSet);
  if (entries.length === 0) return [];
  if (entries.length > MAX_ALIAS_KINDS) return [`别名集 kind 数量 ${entries.length} 超过上限 ${MAX_ALIAS_KINDS}`];

  const errors: string[] = [];
  const reserved = new Set<string>();
  for (const kw of Object.values(opts.base.keywords)) if (kw && !javaIsBlank(kw)) reserved.add(normalizeAlias(kw));
  for (const list of Object.values(opts.base.aliases ?? {})) {
    for (const a of list ?? []) if (a && !javaIsBlank(a)) reserved.add(normalizeAlias(a));
  }

  const seen = new Set<string>();
  for (const [kind, aliases] of entries) {
    const isOperator = OPERATOR_KINDS.has(kind);
    const isStructural = STRUCTURAL_KINDS.has(kind);
    if (!isOperator && !(isStructural && opts.allowStructural === true)) {
      errors.push(
        isStructural
          ? `不允许为结构词 ${kind} 自定义别名（需管理员授予结构词别名权限；审批时会显示规范化真实结构并留痕）`
          : `不允许为 ${kind} 自定义别名（仅运算符/比较类，或经授权的结构词可自定义，防止误导审批的语义滥用）`,
      );
      continue;
    }
    if (!aliases || aliases.length === 0) continue;
    if (aliases.length > MAX_ALIASES_PER_KIND) {
      errors.push(`${kind} 的别名数量 ${aliases.length} 超过上限 ${MAX_ALIASES_PER_KIND}`);
      continue;
    }
    for (const alias of aliases) {
      if (alias === null || alias === undefined || javaIsBlank(alias)) {
        errors.push(`${kind} 的别名不能为空`);
        continue;
      }
      if (alias.length > MAX_ALIAS_LENGTH) {
        errors.push(`${kind} 的别名长度 ${alias.length} 超过上限 ${MAX_ALIAS_LENGTH}`);
        continue;
      }
      const norm = normalizeAlias(alias);
      if (alias !== norm) {
        errors.push(`别名 '${alias}'（${kind}）含非规范空白/大小写；请提交规范形 '${norm}'（前后无空格、词间单个空格、小写）`);
        continue;
      }
      if (!norm.includes(' ')) errors.push(`别名 '${alias}'（${kind}）必须是多词短语；单词别名会占用标识符命名空间，破坏用户空间`);
      if (reserved.has(norm)) errors.push(`别名 '${alias}'（${kind}）与某规范关键词或已有别名同形，禁止遮蔽`);
      if (seen.has(norm)) errors.push(`别名 '${alias}' 在多个 kind 间重复定义`);
      seen.add(norm);
      if (vocabularyHasWritten(opts.vocabulary, norm)) {
        errors.push(`别名 '${alias}'（${kind}）与领域词汇标识符同形，会让关键词抢赢用户标识符，禁止`);
      }
    }
  }
  return errors;
}

/**
 * `AliasOverlayLexicon.wrap` 的合并语义：base 别名在前，用户别名按 kind 追加去重（不是同 kind 替换）。
 * aliasSet 为空时原样返回 base。
 */
export function overlayAliases(base: Lexicon, aliasSet: AliasSet | null | undefined): Lexicon {
  if (!aliasSet || Object.keys(aliasSet).length === 0) return base;
  const merged: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(base.aliases ?? {})) if (v && v.length > 0) merged[k] = [...v];
  for (const [k, v] of Object.entries(aliasSet)) {
    if (!v || v.length === 0) continue;
    const list = (merged[k] ??= []);
    for (const a of v) if (a && !javaIsBlank(a) && !list.includes(a)) list.push(a);
  }
  return { ...base, aliases: merged as NonNullable<Lexicon['aliases']> };
}
