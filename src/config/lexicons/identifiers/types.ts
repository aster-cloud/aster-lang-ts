/**
 * @module config/lexicons/identifiers/types
 *
 * 标识符映射类型定义 - 支持多语言结构体、字段、函数名映射。
 *
 * **设计原则**：
 * - 领域分离：每个业务领域（金融、保险、医疗等）有独立的映射
 * - 双向映射：支持本地化→规范化 和 规范化→本地化 双向转换
 * - 可扩展：租户可添加自定义映射
 * - 类型安全：通过 TypeScript 类型系统保证映射完整性
 */

/**
 * 标识符类型枚举。
 */
export enum IdentifierKind {
  /** 结构体/类型名称 */
  STRUCT = 'struct',
  /** 字段名称 */
  FIELD = 'field',
  /** 函数名称 */
  FUNCTION = 'function',
  /** 枚举值 */
  ENUM_VALUE = 'enum_value',
}

/**
 * 单个标识符映射条目。
 */
export interface IdentifierMapping {
  /** 规范化名称（ASCII，用于编译和运行时） */
  readonly canonical: string;

  /** 本地化名称（显示给用户） */
  readonly localized: string;

  /** 标识符类型 */
  readonly kind: IdentifierKind;

  /** 可选：所属结构体（用于字段映射） */
  readonly parent?: string;

  /** 可选：描述/文档 */
  readonly description?: string;

  /** 可选：别名列表（同一含义的其他表达方式） */
  readonly aliases?: readonly string[];
}

/**
 * 领域词汇表 - 某个业务领域的完整标识符映射集合。
 */
export interface DomainVocabulary {
  /** 领域唯一标识符 (e.g., 'insurance.auto', 'finance.loan') */
  readonly id: string;

  /** 领域名称（本地化） */
  readonly name: string;

  /** 语言代码 (e.g., 'zh-CN', 'ja-JP') */
  readonly locale: string;

  /** 版本号 */
  readonly version: string;

  /** 结构体映射 */
  readonly structs: readonly IdentifierMapping[];

  /** 字段映射（按结构体分组） */
  readonly fields: readonly IdentifierMapping[];

  /** 函数映射 */
  readonly functions: readonly IdentifierMapping[];

  /** 枚举值映射 */
  readonly enumValues?: readonly IdentifierMapping[];

  /** 元数据 */
  readonly metadata?: {
    /** 作者/来源 */
    readonly author?: string;
    /** 创建时间 */
    readonly createdAt?: string;
    /** 最后更新时间 */
    readonly updatedAt?: string;
    /** 描述 */
    readonly description?: string;
  };
}

/**
 * 标识符映射索引 - 用于快速查找。
 */
export interface IdentifierIndex {
  /** 本地化名称 → 规范化名称 */
  readonly toCanonical: ReadonlyMap<string, string>;

  /** 规范化名称 → 本地化名称 */
  readonly toLocalized: ReadonlyMap<string, string>;

  /** 按类型分类的映射 */
  readonly byKind: ReadonlyMap<IdentifierKind, ReadonlyMap<string, IdentifierMapping>>;

  /** 字段映射（按父结构体索引） */
  readonly fieldsByParent: ReadonlyMap<string, ReadonlyMap<string, IdentifierMapping>>;
}

/**
 * 构建标识符索引。
 *
 * @param vocabulary - 领域词汇表
 * @returns 标识符索引
 */
export function buildIdentifierIndex(vocabulary: DomainVocabulary): IdentifierIndex {
  const toCanonical = new Map<string, string>();
  const toLocalized = new Map<string, string>();
  const byKind = new Map<IdentifierKind, Map<string, IdentifierMapping>>();
  const fieldsByParent = new Map<string, Map<string, IdentifierMapping>>();

  // 初始化 byKind 分类
  for (const kind of Object.values(IdentifierKind)) {
    byKind.set(kind, new Map());
  }

  const addMapping = (mapping: IdentifierMapping) => {
    // 双向映射
    toCanonical.set(mapping.localized.toLowerCase(), mapping.canonical);
    toLocalized.set(mapping.canonical.toLowerCase(), mapping.localized);

    // 别名也加入映射
    if (mapping.aliases) {
      for (const alias of mapping.aliases) {
        toCanonical.set(alias.toLowerCase(), mapping.canonical);
      }
    }

    // 按类型分类
    byKind.get(mapping.kind)!.set(mapping.localized.toLowerCase(), mapping);

    // 字段按父结构体索引
    if (mapping.kind === IdentifierKind.FIELD && mapping.parent) {
      if (!fieldsByParent.has(mapping.parent)) {
        fieldsByParent.set(mapping.parent, new Map());
      }
      fieldsByParent.get(mapping.parent)!.set(mapping.localized.toLowerCase(), mapping);
    }
  };

  // 处理所有映射
  vocabulary.structs.forEach(addMapping);
  vocabulary.fields.forEach(addMapping);
  vocabulary.functions.forEach(addMapping);
  vocabulary.enumValues?.forEach(addMapping);

  return {
    toCanonical,
    toLocalized,
    byKind: byKind as ReadonlyMap<IdentifierKind, ReadonlyMap<string, IdentifierMapping>>,
    fieldsByParent: fieldsByParent as ReadonlyMap<string, ReadonlyMap<string, IdentifierMapping>>,
  };
}

/**
 * 将本地化标识符转换为规范化名称。
 *
 * @param index - 标识符索引
 * @param localized - 本地化名称
 * @returns 规范化名称，如果不存在映射则返回原始名称
 */
export function canonicalizeIdentifier(index: IdentifierIndex, localized: string): string {
  return index.toCanonical.get(localized.toLowerCase()) ?? localized;
}

/**
 * 将规范化名称转换为本地化标识符。
 *
 * @param index - 标识符索引
 * @param canonical - 规范化名称
 * @returns 本地化名称，如果不存在映射则返回原始名称
 */
export function localizeIdentifier(index: IdentifierIndex, canonical: string): string {
  return index.toLocalized.get(canonical.toLowerCase()) ?? canonical;
}

/**
 * 检查是否存在标识符映射。
 *
 * @param index - 标识符索引
 * @param name - 标识符名称（本地化或规范化）
 * @returns 如果存在映射返回 true
 */
export function hasIdentifierMapping(index: IdentifierIndex, name: string): boolean {
  const lower = name.toLowerCase();
  return index.toCanonical.has(lower) || index.toLocalized.has(lower);
}

/**
 * 验证领域词汇表。
 *
 * @param vocabulary - 领域词汇表
 * @returns 验证结果
 */
export function validateVocabulary(vocabulary: DomainVocabulary): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenCanonical = new Set<string>();
  const seenLocalized = new Set<string>();

  const checkMapping = (mapping: IdentifierMapping, context: string) => {
    // 检查规范化名称是否为有效 ASCII 标识符
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(mapping.canonical)) {
      errors.push(`${context}: 规范化名称 "${mapping.canonical}" 必须是有效的 ASCII 标识符`);
    }

    // 检查重复
    const canonicalKey = `${mapping.kind}:${mapping.canonical.toLowerCase()}`;
    if (seenCanonical.has(canonicalKey)) {
      errors.push(`${context}: 规范化名称 "${mapping.canonical}" 重复`);
    }
    seenCanonical.add(canonicalKey);

    const localizedKey = `${mapping.kind}:${mapping.localized.toLowerCase()}`;
    if (seenLocalized.has(localizedKey)) {
      warnings.push(`${context}: 本地化名称 "${mapping.localized}" 重复，可能导致歧义`);
    }
    seenLocalized.add(localizedKey);

    // 检查字段映射是否有父结构体
    if (mapping.kind === IdentifierKind.FIELD && !mapping.parent) {
      warnings.push(`${context}: 字段 "${mapping.localized}" 没有指定父结构体`);
    }
  };

  vocabulary.structs.forEach((m, i) => checkMapping(m, `structs[${i}]`));
  vocabulary.fields.forEach((m, i) => checkMapping(m, `fields[${i}]`));
  vocabulary.functions.forEach((m, i) => checkMapping(m, `functions[${i}]`));
  vocabulary.enumValues?.forEach((m, i) => checkMapping(m, `enumValues[${i}]`));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
