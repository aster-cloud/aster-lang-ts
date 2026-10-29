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

/** 带租户词汇的 canonicalize options（CanonicalizerOptions 的子集）。 */
export interface TenantCanonicalizeOptions {
  readonly lexicon: Lexicon;
  readonly vocabulary: VocabularyScopes;
}

/**
 * 有完整租户上下文且注册中心查得到词汇时返回 options 对象，否则退回裸 lexicon。
 *
 * ★三者缺任一即回退：半套参数查不到租户那一份词汇，回退是显式且可断言的。
 */
export function buildCanonicalizeOptions(
  lexicon: Lexicon | undefined,
  tenantId: string | undefined,
  domain: string | undefined,
): Lexicon | TenantCanonicalizeOptions | undefined {
  if (!lexicon || !tenantId || !domain) return lexicon;
  initBuiltinVocabularies();
  const vocabulary = vocabularyRegistry.getWithCustom(tenantId, domain, lexicon.id);
  return vocabulary ? { lexicon, vocabulary } : lexicon;
}
