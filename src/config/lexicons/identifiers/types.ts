/**
 * @module config/lexicons/identifiers/types
 *
 * 标识符映射类型定义 - 支持多语言结构体、字段、函数名映射。
 *
 * **设计原则**：
 * - 领域分离：每个业务领域（金融、保险、医疗等）有独立的映射
 * - 本地化→规范化按源码位置解析（VocabularyScopes，ADR 0051）；本索引只提供规范化→本地化
 * - 可扩展：租户可添加自定义映射
 * - 类型安全：通过 TypeScript 类型系统保证映射完整性
 */

import { nfc } from './casefold.js';

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
   * 标识符，而是要替换出去的**字符串内容**（不含引号）。canonicalize 时把触发词
   * token（按折叠键匹配）替换成 `<open>content<close>`（用当前 lexicon 的 stringQuotes 包裹，
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
 * 标识符映射索引 - 用于展示与按类型查找（规范名 → 本地化写法等）。
 * 源码中的名字按位置解析见 VocabularyScopes（ADR 0051），本索引不参与编译。
 */
export interface IdentifierIndex {
  /** 规范化名称（小写） → 本地化名称 */
  readonly toLocalized: ReadonlyMap<string, string>;

  /** 按类型分类的映射（键为本地化名称小写） */
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
  const toLocalized = new Map<string, string>();
  const byKind = new Map<IdentifierKind, Map<string, IdentifierMapping>>();
  const fieldsByParent = new Map<string, Map<string, IdentifierMapping>>();

  // 初始化 byKind 分类
  for (const kind of Object.values(IdentifierKind)) {
    byKind.set(kind, new Map());
  }

  const addMapping = (mapping: IdentifierMapping): void => {
    const localizedKey = mapping.localized.toLowerCase();
    // 字面量宏是单向宏展开，不建反向映射（避免 toLocalized 暴露怪异的内容反查）。
    if (mapping.kind !== IdentifierKind.LITERAL) {
      toLocalized.set(mapping.canonical.toLowerCase(), mapping.localized);
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
    toLocalized,
    byKind: byKind as ReadonlyMap<IdentifierKind, ReadonlyMap<string, IdentifierMapping>>,
    fieldsByParent: fieldsByParent as ReadonlyMap<string, ReadonlyMap<string, IdentifierMapping>>,
  };
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

/** 映射所属的解析作用域（ADR 0051 §7）：字段 / 枚举成员按规范父名分作用域；字面量宏不在其中。 */
function scopeOf(mapping: IdentifierMapping): string | undefined {
  switch (mapping.kind) {
    case IdentifierKind.STRUCT:
      return 'types';
    case IdentifierKind.FUNCTION:
      return 'functions';
    case IdentifierKind.FIELD:
      return mapping.parent === undefined ? undefined : `fields[${mapping.parent}]`;
    case IdentifierKind.ENUM_VALUE:
      return mapping.parent === undefined ? undefined : `enumMembers[${mapping.parent}]`;
    default:
      return undefined;
  }
}

/** 缺 parent 时的诊断（字段与枚举成员措辞不同，下游按文案识别原因）。 */
function missingParentMessage(mapping: IdentifierMapping, context: string): string | undefined {
  if (mapping.parent) return undefined;
  if (mapping.kind === IdentifierKind.FIELD) return `${context}: 字段 "${mapping.localized}" 没有指定父结构体`;
  if (mapping.kind === IdentifierKind.ENUM_VALUE) return `${context}: 枚举成员 "${mapping.localized}" 没有指定父枚举`;
  return undefined;
}

/** 字面量宏内容的注入防护校验；普通标识符校验规范名是 ASCII 标识符。 */
function checkCanonical(mapping: IdentifierMapping, context: string, errors: string[]): void {
  if (mapping.kind !== IdentifierKind.LITERAL) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(mapping.canonical)) {
      errors.push(`${context}: 规范化名称 "${mapping.canonical}" 必须是有效的 ASCII 标识符`);
    }
    return;
  }
  // 字面量宏：canonical 是要展开的**字符串内容**（不含引号），严格校验以防编译期注入：
  // 单行、无控制字符、无任何字符串定界符与反斜杠（内容会被包进 lexicon 引号里，含引号可提前
  // 闭合字符串、逃逸出 token 注入源码；智能引号会被 canonicalize 归一化，放行则展开非幂等）。
  const content = mapping.canonical ?? '';
  if (content.length === 0) {
    errors.push(`${context}: 字面量宏内容不得为空`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(content)) {
    errors.push(`${context}: 字面量宏内容含控制字符/换行，禁止（防注入）`);
  }
  if (/["\\「」『』«»“”‘’]/.test(content)) {
    errors.push(`${context}: 字面量宏内容不得含引号定界符（" 「 」 『 』 « » “ ” ‘ ’）或反斜杠 "${content}"（防逃逸/注入）`);
  }
}

/**
 * 验证领域词汇表（ADR 0051：名称按位置解析）。
 *
 * - 规范名必须是 ASCII 标识符；字面量宏内容做注入防护。
 * - 字段与枚举成员必须有 parent（按父类型分作用域；不支持全局字段）。
 * - 冲突只在同一角色、同一作用域内判定：NFC 后写法（本地化名或同义词）完全相同却对应不同规范名
 *   → error。同规范名的多个写法（同义词）、仅大小写不同的写法、不同父类型下的同名字段都合法，
 *   使用点由解析器按位置精确优先、折叠唯一再判定。
 * - 字面量宏触发词须全局唯一：canonicalize 在解析前做上下文无关替换，触发词若与任何其它映射同名，
 *   一个词展开成字符串还是标识符就不可预测。
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
  // 作用域内写法（NFC）→ 首个映射的规范名与位置，用于判定同写法不同规范名
  const seenWritten = new Map<string, { canonical: string; context: string }>();
  const seenTrigger = new Map<string, boolean>(); // 触发词(localized+aliases) → 是否字面量宏

  const checkScopeConflict = (mapping: IdentifierMapping, context: string, written: string): void => {
    const scope = scopeOf(mapping);
    if (scope === undefined) return;
    const key = `${scope}\u0000${written}`;
    const prev = seenWritten.get(key);
    if (prev === undefined) {
      seenWritten.set(key, { canonical: mapping.canonical, context });
    } else if (prev.canonical !== mapping.canonical) {
      errors.push(
        `${context}: 写法 "${written}" 在 ${scope} 中对应多个规范名（${prev.canonical}、${mapping.canonical}，另见 ${prev.context}）`,
      );
    }
  };

  const checkTrigger = (mapping: IdentifierMapping, context: string, trigger: string): void => {
    const isLit = mapping.kind === IdentifierKind.LITERAL;
    const key = trigger.toLowerCase();
    const prev = seenTrigger.get(key);
    if (prev !== undefined && (prev || isLit)) {
      errors.push(`${context}: 触发词 "${trigger}" 与另一条映射冲突（字面量宏触发词须全局唯一，防"字符串 vs 标识符"替换歧义）`);
    }
    // 一旦记为字面量宏不回退，保证后续普通标识符命中同名也报错
    seenTrigger.set(key, (prev ?? false) || isLit);
  };

  const checkMapping = (mapping: IdentifierMapping, context: string): void => {
    checkCanonical(mapping, context, errors);
    const missingParent = missingParentMessage(mapping, context);
    if (missingParent) errors.push(missingParent);
    for (const trigger of [mapping.localized, ...(mapping.aliases ?? [])]) {
      checkScopeConflict(mapping, context, nfc(trigger));
      checkTrigger(mapping, context, trigger);
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
