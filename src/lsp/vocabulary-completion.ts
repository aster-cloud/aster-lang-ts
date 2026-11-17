/**
 * 词汇术语补全（ADR 0058 §8.1）。
 *
 * 词汇来自文档的 VocabularyScopes（与成员补全同源）：
 * - role='type'：词汇中的类型（struct），并入类型位置的候选；
 * - role='value'：函数与枚举成员，用于表达式位置。
 * 字段只经 `x.` 成员补全提供，这里不重复。
 * 类型项绝不出现在表达式位置：结构体与字段共用同一本地化词时（ADR 0051），
 * 表达式位置的该词指向字段，给类型项会误导。
 */
import type { CompletionItem } from 'vscode-languageserver/node.js';
import { CompletionItemKind } from 'vscode-languageserver/node.js';
import type { Candidate, VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { foldKey } from '../config/lexicons/identifiers/casefold.js';
import { getLspUiTexts } from '../config/lexicons/lsp-ui-texts.js';
import type { Lexicon } from '../config/lexicons/types.js';

export type VocabularyRole = 'type' | 'value';

/** 同一写法（折叠后）只留一项；多个规范名共用写法时保留先出现者。规范名或写法折叠后在 taken 中的项让位。 */
function collect(
  out: Map<string, CompletionItem>,
  buckets: Iterable<readonly Candidate[]>,
  kind: CompletionItemKind,
  roleLabel: string,
  taken?: ReadonlySet<string>,
): void {
  for (const bucket of buckets) {
    for (const c of bucket) {
      const key = foldKey(c.written);
      if (out.has(key) || taken?.has(key) || taken?.has(foldKey(c.canonical))) continue;
      out.set(key, { label: c.written, insertText: c.written, kind, detail: `${c.canonical} · ${roleLabel}`, data: c.written });
    }
  }
}

export interface VocabularyCompletionOptions {
  /**
   * 已有候选（文档声明、类型别名、导入别名、内置类型）折叠后的标签（ADR 0051 §6.3）：词汇项的写法或规范名
   * 与其中之一相同即让位，既有项胜出。仅对 type 角色生效。
   */
  readonly takenLabels?: ReadonlySet<string>;
  /** 文档 lexicon：detail 中的角色名按它本地化（与名称解析悬停同一套 UI 文本） */
  readonly lexicon?: Lexicon;
}

export function vocabularyTermCompletions(
  scopes: VocabularyScopes | undefined,
  role: VocabularyRole,
  options: VocabularyCompletionOptions = {},
): CompletionItem[] {
  if (!scopes) return [];
  const ui = getLspUiTexts(options.lexicon);
  const out = new Map<string, CompletionItem>();
  if (role === 'type') {
    collect(out, scopes.types.values(), CompletionItemKind.Class, ui.resolutionRoleType, options.takenLabels);
    return [...out.values()];
  }
  collect(out, scopes.functions.values(), CompletionItemKind.Function, ui.resolutionRoleFunction);
  for (const inner of scopes.enumMembers.values()) collect(out, inner.values(), CompletionItemKind.EnumMember, ui.resolutionRoleMember);
  return [...out.values()];
}
