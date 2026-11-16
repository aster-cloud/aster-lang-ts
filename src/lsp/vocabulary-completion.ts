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

export type VocabularyRole = 'type' | 'value';

/** 同一写法（折叠后）只留一项；多个规范名共用写法时保留先出现者。 */
function collect(
  out: Map<string, CompletionItem>,
  buckets: Iterable<readonly Candidate[]>,
  kind: CompletionItemKind,
  roleLabel: string,
  takenCanonicals?: ReadonlySet<string>,
): void {
  for (const bucket of buckets) {
    for (const c of bucket) {
      if (takenCanonicals?.has(foldKey(c.canonical))) continue;
      const key = foldKey(c.written);
      if (out.has(key)) continue;
      out.set(key, { label: c.written, insertText: c.written, kind, detail: `${c.canonical} · ${roleLabel}`, data: c.written });
    }
  }
}

/**
 * `takenCanonicals`：已被其它来源（文档声明、别名、内置）占用的折叠后规范名（ADR 0051 §6.3），
 * 仅对 type 角色生效：规范名冲突时让位于既有项。
 */
export function vocabularyTermCompletions(
  scopes: VocabularyScopes | undefined,
  role: VocabularyRole,
  takenCanonicals?: ReadonlySet<string>,
): CompletionItem[] {
  if (!scopes) return [];
  const out = new Map<string, CompletionItem>();
  if (role === 'type') {
    collect(out, scopes.types.values(), CompletionItemKind.Class, 'type', takenCanonicals);
    return [...out.values()];
  }
  collect(out, scopes.functions.values(), CompletionItemKind.Function, 'function');
  for (const inner of scopes.enumMembers.values()) collect(out, inner.values(), CompletionItemKind.EnumMember, 'enum member');
  return [...out.values()];
}
