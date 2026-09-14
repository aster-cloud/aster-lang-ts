/**
 * `initializationOptions` 里租户上下文的解析与注册 —— 单独成模块，**可单测**。
 *
 * <h2>为什么必须抽出来</h2>
 *
 * ★`server.ts` 顶层就 `createConnection()`，一 import 就抛
 * "Connection input stream is not set"，无法被单测直接触达。于是
 * 「LSP 到底有没有把客户端推来的租户词汇注册进去」这个决策点**无人守卫**。
 *
 * 实测证实了这个缺口：把 server.ts 里整段
 * `if (initOpts?.tenantId && Array.isArray(...)) { ... }` 改成 `if (false)`，
 * `tenant-vocabulary.test.ts` 的 6 条用例**仍然全绿**——它们测的是
 * canonicalizer 契约（"会不会用租户词汇"），证明不了"LSP 真的注册了"。
 *
 * 这正是 aster-lang-ts#162 记录过的第 16 种假绿，修法相同：
 * 把决策点抽成无副作用的独立模块。
 */
import { vocabularyRegistry } from '../config/lexicons/identifiers/registry.js';
import type { DomainVocabulary } from '../config/lexicons/identifiers/types.js';

/** 客户端在 initialize 时推送的租户上下文形状。 */
export interface TenantInitOptions {
  readonly tenantId?: string;
  readonly domainVocabularies?: unknown[];
}

/** 注册结果：供调用方设置会话状态，也便于断言。 */
export interface TenantInitResult {
  /** 本次会话的租户 id；无有效租户上下文时为 undefined。 */
  readonly tenantId: string | undefined;
  /** canonicalizer 查询用的 domain（取第一个成功注册的词汇表 id）。 */
  readonly domain: string | undefined;
  /** 成功注册的词汇表数量。 */
  readonly registered: number;
  /** 被跳过的无效词汇表的错误信息（调用方负责打日志）。 */
  readonly skipped: readonly string[];
}

const EMPTY: TenantInitResult = {
  tenantId: undefined, domain: undefined, registered: 0, skipped: [],
};

/**
 * 解析并注册客户端推送的租户领域词汇。
 *
 * <p>★`tenantId` 与 `domainVocabularies` **必须成对**：索引键是
 * `(tenantId, domain, locale)` 三元组，缺 tenantId 就查不到那一份。
 * 只有其一时整块忽略——注册了也查不出来，徒增困惑。
 *
 * <p>★单个词汇表校验失败**不中断**整批：`registerCustom` 对不合法词汇会抛错。
 * 词汇缺失应表现为「补全少了几项」，而不是「LSP 起不来」。
 *
 * @returns 会话应采用的租户上下文；无有效输入时各字段为空。
 */
export function applyTenantInitOptions(
  initOpts: TenantInitOptions | undefined,
): TenantInitResult {
  const tenantId = initOpts?.tenantId;
  const vocabs = initOpts?.domainVocabularies;
  if (!tenantId || !Array.isArray(vocabs)) return EMPTY;

  const skipped: string[] = [];
  let registered = 0;
  let domain: string | undefined;

  for (const vocab of vocabs) {
    try {
      vocabularyRegistry.registerCustom(tenantId, vocab as DomainVocabulary);
      registered++;
      // domain 取第一个**成功注册**的（而非数组首项）——首项若校验失败，
      // 拿它当 domain 会让后续查询全部落空。
      if (domain === undefined) {
        domain = (vocab as DomainVocabulary | undefined)?.id;
      }
    } catch (err) {
      skipped.push((err as Error)?.message ?? String(err));
    }
  }

  // 一个都没注册成功时不要留下 tenantId：带着 tenantId 但没有任何词汇，
  // 会让 buildCanonicalizeOptions 构造出一个查不到东西的 options，
  // 白白绕开「回退裸 lexicon」这条更快的路径。
  if (registered === 0) return { ...EMPTY, skipped };

  return { tenantId, domain, registered, skipped };
}
