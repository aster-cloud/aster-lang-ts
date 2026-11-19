/**
 * canonicalize 第二参的构造 —— 单独成模块，**无副作用**。
 *
 * ★为什么不放在 server.ts：那个模块顶层就 `createConnection()`，
 *   一 import 就抛 "Connection input stream is not set"，无法被单测直接触达。
 *   而这个判断恰恰是「LSP 到底传没传租户上下文」的唯一决策点，必须可测。
 *
 * canonicalize 只用词汇中的字面量宏；标识符按位置解析（ADR 0051），不在这里替换。
 */
import type { Lexicon } from '../config/lexicons/types.js';
import type { VocabularyScopes } from '../config/lexicons/identifiers/scopes.js';
import { vocabularyRegistry, initBuiltinVocabularies } from '../config/lexicons/identifiers/registry.js';
import { EN_US } from '../config/lexicons/en-US.js';

/**
 * 带租户词汇的 canonicalize options（CanonicalizerOptions 的子集）。
 * lexicon 为 undefined 表示内置英文（与 compile-pipeline 的 `{ lexicon, vocabulary }` 同形）。
 */
export interface TenantCanonicalizeOptions {
  readonly lexicon: Lexicon | undefined;
  readonly vocabulary: VocabularyScopes;
}

/**
 * 有完整租户上下文且注册中心查得到词汇时返回 options 对象，否则原样退回 lexicon。
 *
 * ★tenantId / domain 缺任一即回退：半套参数查不到租户那一份词汇，回退是显式且可断言的。
 * ★lexicon 为 undefined（LSP 中 en-US 的表示）不是「缺参数」：按 en-US 查词汇（issue #365）。
 *   返回的 options 仍携带原 lexicon（undefined），canonicalize / lex / parse 的英文路径与无词汇时一致，
 *   只多出词汇作用域。
 */
export function buildCanonicalizeOptions(
  lexicon: Lexicon | undefined,
  tenantId: string | undefined,
  domain: string | undefined,
): Lexicon | TenantCanonicalizeOptions | undefined {
  if (!tenantId || !domain) return lexicon;
  initBuiltinVocabularies();
  const vocabulary = vocabularyRegistry.getWithCustom(tenantId, domain, (lexicon ?? EN_US).id);
  return vocabulary ? { lexicon, vocabulary } : lexicon;
}
