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
  /**
   * 字面量宏（token → 字符串字面量）。与其它 kind 不同：canonical **不是** ASCII
   * 标识符，而是要替换出去的**字符串内容**（不含引号）。canonicalize 时把 localized
   * token 逐字替换成 `<open>content<close>`（用当前 lexicon 的 stringQuotes 包裹，
   * 从而被 segmentString 正确保护，避免插入 ASCII 引号在标点归一化后不被隔离）。
   *
   * <p>用途：把一个领域术语固定展开成一段标准文案（合规场景常见），例如
   * `思故乡 → "静夜思"`。内容受严格校验（单行、无控制字符、无裸引号/反斜杠），
   * 防止编译期文本注入。仅用于**表达式位置**；用在声明位置会由 parser 报错。
   */
  LITERAL = 'literal',
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

  /**
   * 字面量宏映射（kind = LITERAL）。localized token 展开成字符串字面量。
   * 独立数组（不塞进 enumValues）以免语义错位。canonical 为字面量**内容**（不含引号）。
   */
  readonly literals?: readonly IdentifierMapping[];

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

  /**
   * 字面量宏的 localized key（已 toLowerCase）。canonicalize 替换时据此判定：
   * 命中则把 `toCanonical` 里存的**内容**用 lexicon 引号包裹后插入，而非当作标识符原样插入。
   */
  readonly literals: ReadonlySet<string>;
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
  const literals = new Set<string>();

  // 初始化 byKind 分类
  for (const kind of Object.values(IdentifierKind)) {
    byKind.set(kind, new Map());
  }

  const addMapping = (mapping: IdentifierMapping): void => {
    const localizedKey = mapping.localized.toLowerCase();
    // localized → canonical（字面量宏存的是「内容」，替换阶段再包引号）
    toCanonical.set(localizedKey, mapping.canonical);
    // 字面量宏是单向宏展开，不建反向映射（避免 toLocalized 暴露怪异的内容反查）。
    if (mapping.kind === IdentifierKind.LITERAL) {
      literals.add(localizedKey);
    } else {
      toLocalized.set(mapping.canonical.toLowerCase(), mapping.localized);
    }

    // 别名也加入映射（字面量宏的别名同样触发宏展开）
    if (mapping.aliases) {
      for (const alias of mapping.aliases) {
        const aliasKey = alias.toLowerCase();
        toCanonical.set(aliasKey, mapping.canonical);
        if (mapping.kind === IdentifierKind.LITERAL) literals.add(aliasKey);
      }
    }

    // 按类型分类
    byKind.get(mapping.kind)!.set(localizedKey, mapping);

    // 字段按父结构体索引
    if (mapping.kind === IdentifierKind.FIELD && mapping.parent) {
      if (!fieldsByParent.has(mapping.parent)) {
        fieldsByParent.set(mapping.parent, new Map());
      }
      fieldsByParent.get(mapping.parent)!.set(localizedKey, mapping);
    }
  };

  // 处理所有映射
  vocabulary.structs.forEach(addMapping);
  vocabulary.fields.forEach(addMapping);
  vocabulary.functions.forEach(addMapping);
  vocabulary.enumValues?.forEach(addMapping);
  vocabulary.literals?.forEach(addMapping);

  return {
    toCanonical,
    toLocalized,
    byKind: byKind as ReadonlyMap<IdentifierKind, ReadonlyMap<string, IdentifierMapping>>,
    fieldsByParent: fieldsByParent as ReadonlyMap<string, ReadonlyMap<string, IdentifierMapping>>,
    literals,
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
  const seenTrigger = new Map<string, boolean>(); // 触发词(localized+aliases) → 是否字面量宏；字面量宏须全局唯一

  const checkMapping = (mapping: IdentifierMapping, context: string): void => {
    if (mapping.kind === IdentifierKind.LITERAL) {
      // 字面量宏：canonical 是要展开的**字符串内容**（不含引号），严格校验以防编译期注入：
      // 单行、无控制字符、无裸双引号（"）或反斜杠（\）。允许中文/标点/空格等普通可见字符。
      const content = mapping.canonical ?? '';
      if (content.length === 0) {
        errors.push(`${context}: 字面量宏内容不得为空`);
      }
      // 禁控制字符（0x00-0x1F 与 0x7F，含 \r \n \t \0）——单行、防注入
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001F\u007F]/.test(content)) {
        errors.push(`${context}: 字面量宏内容含控制字符/换行，禁止（防注入）`);
      }
      // 禁任何字符串定界符与反斜杠——内容会被包进 lexicon 引号里，若含该 lexicon（或任何
      // 已知 lexicon）的引号字符可提前闭合字符串、逃逸出 token 注入源码（Codex 复审 P0）。
      // 禁：ASCII 双引号 "、反斜杠 \、CJK 直角引号「」『』、书名号/法式引号 « »、
      // 以及智能/弯引号 “ ” ‘ ’（canonicalize 会先做智能引号归一化，若放行则展开非幂等，
      // 重编译 canonical 输出会因 unterminated-string 失败）。
      if (/["\\「」『』«»“”‘’]/.test(content)) {
        errors.push(`${context}: 字面量宏内容不得含引号定界符（" 「 」 『 』 « » “ ” ‘ ’）或反斜杠 "${content}"（防逃逸/注入）`);
      }
    } else {
      // 普通标识符：canonical 必须是有效 ASCII 标识符（不变）
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(mapping.canonical)) {
        errors.push(`${context}: 规范化名称 "${mapping.canonical}" 必须是有效的 ASCII 标识符`);
      }
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

    // 字面量宏触发词隔离（Codex 复审 P0）：canonicalizer 上下文无关替换——**字面量宏**
    // 展开成字符串、普通标识符展开成标识符，二者语义天差地别。故要求：字面量宏的触发词
    // （localized + aliases）不得与**任何其它映射**（含普通标识符、其它字面量宏）的触发词
    // 冲突，否则一个词到底展开成字符串还是标识符不可预测。普通标识符之间同名（不同 kind，
    // 靠上下文消歧，如 struct/field 同名）仍是既有的 warning 行为，不动。
    const isLit = mapping.kind === IdentifierKind.LITERAL;
    const triggers = [mapping.localized, ...(mapping.aliases ?? [])];
    for (const t of triggers) {
      const key = t.toLowerCase();
      const prev = seenTrigger.get(key);
      if (prev !== undefined && (prev || isLit)) {
        // prev 是字面量宏、或当前是字面量宏 → 字面量宏与他人触发词冲突，error。
        errors.push(`${context}: 触发词 "${t}" 与另一条映射冲突（字面量宏触发词须全局唯一，防"字符串 vs 标识符"替换歧义）`);
      }
      // 记录：值=是否字面量宏（一旦记为 true 不回退，保证后续普通标识符命中同名也报错）
      seenTrigger.set(key, (prev ?? false) || isLit);
    }

    // 检查字段映射是否有父结构体
    if (mapping.kind === IdentifierKind.FIELD && !mapping.parent) {
      warnings.push(`${context}: 字段 "${mapping.localized}" 没有指定父结构体`);
    }
  };

  vocabulary.structs.forEach((m, i) => checkMapping(m, `structs[${i}]`));
  vocabulary.fields.forEach((m, i) => checkMapping(m, `fields[${i}]`));
  vocabulary.functions.forEach((m, i) => checkMapping(m, `functions[${i}]`));
  vocabulary.enumValues?.forEach((m, i) => checkMapping(m, `enumValues[${i}]`));
  vocabulary.literals?.forEach((m, i) => checkMapping(m, `literals[${i}]`));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
