/**
 * first-party lexicon 完整性检查（verify-lexicon-sync 第 3b 段）。
 *
 * 检查对象是 Java exportLexicons 产出的 first-party 包（en/zh/de/hi），确保每个包
 * 覆盖全部非可选 tokenKind。独立成模块以便单元测试锁定「缺必需 kind 即 CI 失败」。
 *
 * ★`CI_OPTIONAL_KINDS` 与 runtime `LexiconRegistry.OPTIONAL_KINDS` 语义**故意解耦**
 * （不要求逐字对齐）：
 *   - runtime 集对**所有**加载的 SPI 包（含旧 published 包、第三方包）宽容——缺可选
 *     token 只 warn 不塌，保护发布非原子期间新 core 遇到旧语言包。
 *   - 本 CI 集只作用于随生态一起演进的 **first-party 语言包**，可以比 runtime 更早收紧。
 * 两者都遵循 ADR 0029：新 kind 先进可选集，完整发版列车发完、消费方 pin 新 catalog 后，
 * 由下一次清理变更移出转正。
 */

/**
 * CI first-party 可选 token。迁移期新 kind 放这里，缺失只告警；
 * 不在此集合中的 kind，first-party 包缺失即 CI 错误。
 */
export const CI_OPTIONAL_KINDS: ReadonlySet<string> = new Set<string>();

export interface CompletenessLine {
  readonly level: 'error' | 'warn' | 'ok';
  readonly message: string;
}

export interface CompletenessResult {
  readonly errors: number;
  readonly warnings: number;
  readonly lines: readonly CompletenessLine[];
}

interface KeywordsOnly {
  readonly keywords: Readonly<Record<string, string>>;
}

/** 检查单个 first-party 包；缺必需 kind 按缺失个数计错误，缺可选 kind 按个数计告警。 */
function checkLocale(
  localeId: string,
  javaLex: KeywordsOnly | undefined,
  requiredKinds: readonly string[],
  optionalKinds: readonly string[],
): CompletenessResult {
  if (!javaLex) {
    const message = `first-party lexicon "${localeId}" 未出现在 Java exportLexicons 输出`;
    return { errors: 1, warnings: 0, lines: [{ level: 'error', message }] };
  }
  const missing = requiredKinds.filter(k => !(k in javaLex.keywords));
  if (missing.length > 0) {
    const message = `${localeId} 缺少必需 tokenKind: ${missing.join(', ')}`;
    return { errors: missing.length, warnings: 0, lines: [{ level: 'error', message }] };
  }
  const optionalMissing = optionalKinds.filter(k => !(k in javaLex.keywords));
  if (optionalMissing.length > 0) {
    const message = `${localeId} 缺可选 tokenKind（迁移期允许）: ${optionalMissing.join(', ')}`;
    return { errors: 0, warnings: optionalMissing.length, lines: [{ level: 'warn', message }] };
  }
  const message = `${localeId}: 覆盖全部 ${requiredKinds.length} 必需 + 可选 tokenKind`;
  return { errors: 0, warnings: 0, lines: [{ level: 'ok', message }] };
}

/**
 * 对每个 first-party locale 检查 Java 导出包的 tokenKind 覆盖度。
 *
 * @param javaTokens Java 导出的全部 tokenKind
 * @param javaLexicons Java exportLexicons 的 lexicons 段
 * @param localeIds 需要检查的 first-party locale
 * @param optional CI 可选集，默认 {@link CI_OPTIONAL_KINDS}
 */
export function checkFirstPartyCompleteness(
  javaTokens: ReadonlySet<string>,
  javaLexicons: Readonly<Record<string, KeywordsOnly>>,
  localeIds: readonly string[],
  optional: ReadonlySet<string> = CI_OPTIONAL_KINDS,
): CompletenessResult {
  const requiredKinds = [...javaTokens].filter(t => !optional.has(t));
  const optionalKinds = [...optional].filter(k => javaTokens.has(k));
  const results = localeIds.map(id => checkLocale(id, javaLexicons[id], requiredKinds, optionalKinds));
  return {
    errors: results.reduce((n, r) => n + r.errors, 0),
    warnings: results.reduce((n, r) => n + r.warnings, 0),
    lines: results.flatMap(r => r.lines),
  };
}
