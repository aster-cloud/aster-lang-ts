/**
 * canonicalize 第二参的构造 —— 单独成模块，**无副作用**。
 *
 * ★为什么不放在 server.ts：那个模块顶层就 `createConnection()`，
 *   一 import 就抛 "Connection input stream is not set"，无法被单测直接触达。
 *   而这个判断恰恰是「LSP 到底传没传租户上下文」的唯一决策点，必须可测：
 *   实测把租户参数删掉（回到缺陷版）时，仅测 canonicalizer 契约的用例**仍全绿**
 *   —— 契约证明"canonicalizer 会用租户词汇"，证明不了"LSP 真的传了"。
 */
import type { Lexicon } from '../config/lexicons/types.js';

/** 带租户上下文的 canonicalize options（与 canonicalizer 的 CanonicalizerOptions 对齐的子集）。 */
export interface TenantCanonicalizeOptions {
  readonly lexicon: Lexicon;
  readonly tenantId: string;
  readonly domain: string;
  readonly locale: string;
}

/**
 * 有完整租户上下文时返回 options 对象，否则退回裸 lexicon。
 *
 * ★三者缺任一即回退：canonicalizer 的自定义词汇分支要求
 * `opts.domain && opts.locale` 同时存在，半套参数只会**静默**走内置路径
 * ——静默降级比报错更难排查，故这里让回退是显式且可断言的。
 */
export function buildCanonicalizeOptions(
  lexicon: Lexicon | undefined,
  tenantId: string | undefined,
  domain: string | undefined,
): Lexicon | TenantCanonicalizeOptions | undefined {
  if (lexicon && tenantId && domain) {
    return { lexicon, tenantId, domain, locale: lexicon.id };
  }
  return lexicon;
}
