/**
 * @module config/lexicons/identifiers/registry
 *
 * 领域词汇表注册中心 - 管理和加载所有领域词汇表。
 *
 * **核心功能**：
 * - 注册和管理领域词汇表
 * - 按领域+语言查找词汇表
 * - 合并多个词汇表（领域组合）
 * - 支持自定义/租户级词汇表
 */

import {
  type DomainVocabulary,
  type IdentifierIndex,
  buildIdentifierIndex,
  validateVocabulary,
} from './types.js';
import { buildVocabularyScopes, type VocabularyScopes } from './scopes.js';

// 内置领域词汇表（@generated 文件，由 Java 真源生成）
import { INSURANCE_AUTO_ZH_CN } from './domains/insurance.auto.zh-CN.js';
import { FINANCE_LOAN_ZH_CN } from './domains/finance.loan.zh-CN.js';
import { INSURANCE_AUTO_EN_US } from './domains/insurance.auto.en-US.js';
import { FINANCE_LOAN_EN_US } from './domains/finance.loan.en-US.js';
import { INSURANCE_AUTO_DE_DE } from './domains/insurance.auto.de-DE.js';
import { FINANCE_LOAN_DE_DE } from './domains/finance.loan.de-DE.js';

/**
 * 词汇表注册条目。
 */
interface VocabularyEntry {
  vocabulary: DomainVocabulary;
  index: IdentifierIndex;
  /** 编译用的按位置词汇视图（ADR 0051） */
  scopes: VocabularyScopes;
}

/**
 * 构建注册条目。按位置解析要求字段与枚举成员都有所属类型（ADR 0051 §7、§14.3），
 * 没有 parent 的字段 / 枚举成员无法定位作用域，不进入 scopes（仍保留在 vocabulary 与展示索引中）。
 * 内置词汇（由 Java 真源生成）的枚举成员目前都没有 parent。
 */
function makeEntry(vocabulary: DomainVocabulary): VocabularyEntry {
  const scoped: DomainVocabulary = {
    ...vocabulary,
    fields: vocabulary.fields.filter((m) => m.parent !== undefined),
    enumValues: (vocabulary.enumValues ?? []).filter((m) => m.parent !== undefined),
  };
  return { vocabulary, index: buildIdentifierIndex(vocabulary), scopes: buildVocabularyScopes(scoped) };
}

/**
 * 词汇表注册中心。
 */
class VocabularyRegistry {
  /** 词汇表存储：key = `${domain}:${locale}` */
  private readonly vocabularies = new Map<string, VocabularyEntry>();

  /** 自定义词汇表：key = `${tenantId}:${domain}:${locale}` */
  private readonly customVocabularies = new Map<string, VocabularyEntry>();

  /**
   * 生成词汇表键。
   */
  private makeKey(domain: string, locale: string): string {
    return `${domain}:${locale}`;
  }

  /**
   * 生成租户词汇表键。
   */
  private makeCustomKey(tenantId: string, domain: string, locale: string): string {
    return `${tenantId}:${domain}:${locale}`;
  }

  /**
   * 注册领域词汇表。
   *
   * @param vocabulary - 领域词汇表
   * @throws 如果词汇表验证失败，或 buildVocabularyScopes 拒绝该词汇
   *   （如字面量宏触发词对应多个内容 literal_conflict）
   */
  register(vocabulary: DomainVocabulary): void {
    const validation = validateVocabulary(vocabulary);
    if (!validation.valid) {
      throw new Error(
        `词汇表 "${vocabulary.id}" 验证失败:\n${validation.errors.join('\n')}`
      );
    }

    if (validation.warnings.length > 0) {
      console.warn(
        `词汇表 "${vocabulary.id}" 警告:\n${validation.warnings.join('\n')}`
      );
    }

    const key = this.makeKey(vocabulary.id, vocabulary.locale);
    this.vocabularies.set(key, makeEntry(vocabulary));
  }

  /**
   * 注册自定义/租户级词汇表。
   *
   * @param tenantId - 租户标识符
   * @param vocabulary - 领域词汇表
   * @throws 如果词汇表验证失败，或 buildVocabularyScopes 拒绝该词汇
   *   （如字面量宏触发词对应多个内容 literal_conflict）；无 parent 的字段 / 枚举成员不会导致失败
   */
  registerCustom(tenantId: string, vocabulary: DomainVocabulary): void {
    const validation = validateVocabulary(vocabulary);
    if (!validation.valid) {
      throw new Error(
        `自定义词汇表 "${vocabulary.id}" 验证失败:\n${validation.errors.join('\n')}`
      );
    }

    const key = this.makeCustomKey(tenantId, vocabulary.id, vocabulary.locale);
    this.customVocabularies.set(key, makeEntry(vocabulary));
  }

  /**
   * 注销租户自定义词汇（用于用户清空某领域词汇后回退到内置）。
   *
   * @param tenantId - 租户标识符
   * @param domain - 领域标识符
   * @param locale - 语言代码
   * @returns 若存在并被移除返回 true，否则 false
   */
  unregisterCustom(tenantId: string, domain: string, locale: string): boolean {
    const key = this.makeCustomKey(tenantId, domain, locale);
    return this.customVocabularies.delete(key);
  }

  /**
   * 获取领域词汇表。
   *
   * @param domain - 领域标识符
   * @param locale - 语言代码
   * @returns 词汇表和索引，如果不存在返回 undefined
   */
  get(domain: string, locale: string): VocabularyEntry | undefined {
    const key = this.makeKey(domain, locale);
    return this.vocabularies.get(key);
  }

  /**
   * 获取领域词汇表索引。
   *
   * @param domain - 领域标识符
   * @param locale - 语言代码
   * @returns 标识符索引，如果不存在返回 undefined
   */
  getIndex(domain: string, locale: string): IdentifierIndex | undefined {
    return this.get(domain, locale)?.index;
  }

  /**
   * 获取编译用的词汇作用域：租户自定义词汇优先，未命中回退内置。
   *
   * @param tenantId - 租户标识符（缺省时只查内置）
   * @param domain - 领域标识符
   * @param locale - 语言代码
   * @returns 词汇作用域，未注册时返回 undefined
   */
  getWithCustom(
    tenantId: string | undefined,
    domain: string,
    locale: string
  ): VocabularyScopes | undefined {
    if (tenantId) {
      const custom = this.customVocabularies.get(this.makeCustomKey(tenantId, domain, locale));
      if (custom) return custom.scopes;
    }
    return this.get(domain, locale)?.scopes;
  }

  /**
   * 合并多个领域的词汇表。
   *
   * @param domains - 领域标识符列表
   * @param locale - 语言代码
   * @returns 合并后的词汇表
   */
  merge(domains: string[], locale: string): DomainVocabulary | undefined {
    const entries = domains
      .map(d => this.get(d, locale))
      .filter((e): e is VocabularyEntry => e !== undefined);

    if (entries.length === 0) return undefined;

    // 合并所有映射
    const merged: DomainVocabulary = {
      id: domains.join('+'),
      name: entries.map(e => e.vocabulary.name).join(' + '),
      locale,
      version: '1.0.0',
      structs: entries.flatMap(e => e.vocabulary.structs),
      fields: entries.flatMap(e => e.vocabulary.fields),
      functions: entries.flatMap(e => e.vocabulary.functions),
      enumValues: entries.flatMap(e => e.vocabulary.enumValues ?? []),
    };

    return merged;
  }

  /**
   * 获取所有已注册的领域列表。
   *
   * @param locale - 可选，按语言过滤
   * @returns 领域标识符列表
   */
  listDomains(locale?: string): string[] {
    const domains = new Set<string>();
    for (const [key] of this.vocabularies) {
      const parts = key.split(':');
      const domain = parts[0];
      const loc = parts[1];
      if (domain && (!locale || loc === locale)) {
        domains.add(domain);
      }
    }
    return Array.from(domains);
  }

  /**
   * 获取指定语言的所有词汇表。
   *
   * @param locale - 语言代码
   * @returns 词汇表列表
   */
  listByLocale(locale: string): DomainVocabulary[] {
    const result: DomainVocabulary[] = [];
    for (const [key, entry] of this.vocabularies) {
      if (key.endsWith(`:${locale}`)) {
        result.push(entry.vocabulary);
      }
    }
    return result;
  }

  /**
   * 清除所有注册的词汇表（同时重置内置初始化标志）。
   */
  clear(): void {
    this.vocabularies.clear();
    this.customVocabularies.clear();
    builtinsInitialized = false;
  }
}

/**
 * 全局词汇表注册中心实例。
 */
export const vocabularyRegistry = new VocabularyRegistry();

let builtinsInitialized = false;

/**
 * 初始化内置词汇表（幂等，多次调用安全）。
 */
export function initBuiltinVocabularies(): void {
  if (builtinsInitialized) return;
  builtinsInitialized = true;
  vocabularyRegistry.register(INSURANCE_AUTO_ZH_CN);
  vocabularyRegistry.register(FINANCE_LOAN_ZH_CN);
  vocabularyRegistry.register(INSURANCE_AUTO_EN_US);
  vocabularyRegistry.register(FINANCE_LOAN_EN_US);
  vocabularyRegistry.register(INSURANCE_AUTO_DE_DE);
  vocabularyRegistry.register(FINANCE_LOAN_DE_DE);
}

// 导出类型供外部使用
export type { VocabularyEntry };
export { VocabularyRegistry };
