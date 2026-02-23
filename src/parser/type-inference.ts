/**
 * CNL 字段类型推断引擎
 *
 * 实现基于命名约定和约束信号的类型推断，使字段定义更接近自然语言。
 *
 * 推断优先级（从高到低）：
 * 1. 显式类型声明（由调用方处理，不在本模块）
 * 2. 约束驱动推断（Range → 数值类型，Pattern → Text）
 * 3. 命名约定推断（*Id → Text, *Amount → Float 等）
 * 4. 默认类型（Text）
 *
 * @example
 * ```typescript
 * // 命名推断
 * inferFieldType('applicantId')     // → Text (匹配 *Id)
 * inferFieldType('loanAmount')      // → Float (匹配 *Amount)
 * inferFieldType('termMonths')      // → Int (匹配 *Months)
 * inferFieldType('isApproved')      // → Bool (匹配 is*)
 *
 * // 约束驱动推断
 * inferFieldType('score', [{ kind: 'Range', min: 0, max: 100 }])  // → Int
 * inferFieldType('rate', [{ kind: 'Range', min: 0.0, max: 1.0 }]) // → Float
 * ```
 */

import { Node } from '../ast/ast.js';
import type { Constraint, ConstraintRange, Type } from '../types.js';
import type { TypeInferenceRule, PrimitiveTypeName } from '../types/type-inference.js';
import type { Lexicon } from '../config/lexicons/types.js';

export type { TypeInferenceRule, PrimitiveTypeName };

/**
 * 默认的字段命名类型推断规则
 *
 * 规则按照常见业务领域设计，覆盖：
 * - 标识符类型（ID、Identifier、Vin）
 * - 金融类型（Amount、Price、Cost）
 * - 计数类型（Count、Number、Age）
 * - 业务指标（Rating、Limit、Premium）
 * - 布尔类型（isXxx、hasXxx、Flag、Sufficient）
 * - 时间类型（Date、Time、At）
 * - 分类类型（Type、Status、Category）
 * - 产品属性（Make、Model）
 */
/**
 * 语言无关的通用基线命名规则。
 * 语言特定规则（英文布尔前缀、中文前缀、德语后缀等）
 * 已拆分至 config/lexicons/type-inference-rules.ts（overlay 模式）。
 */
export const BASE_NAMING_RULES: readonly TypeInferenceRule[] = [
  // 明确文本
  { pattern: /(?:Message|Dosage)$/i, type: 'Text', priority: 11 },
  // ID/标识符（所有语言通用）
  { pattern: /(?:Id|ID|Identifier)$/i, type: 'Text', priority: 10 },
  { pattern: /(?:Code|Key|Token|Uuid|Guid|Vin)$/i, type: 'Text', priority: 8 },
  // 金额/价格
  { pattern: /(?:Amount|Price|Cost|Fee|Total|Balance|Salary|Income|Payment|Percentage|Ratio)$/i, type: 'Float', priority: 10 },
  { pattern: /(?:Rate|Interest)$/i, type: 'Float', priority: 9 },
  // 计数/数量
  { pattern: /(?:Count|Number|Qty|Quantity|Age|Score|Level|Rank|Index|Size|Length|Width|Height)$/i, type: 'Int', priority: 10 },
  // 时间单位
  { pattern: /(?:Years?|Months?|Weeks?|Days?|Hours?|Minutes?|Seconds?)$/i, type: 'Int', priority: 9 },
];


/** 默认推断类型 */
const DEFAULT_TYPE: PrimitiveTypeName = 'Text';

/**
 * 从约束列表推断类型
 *
 * 推断规则：
 * - Range 约束 → 数值类型（Int 或 Float）
 * - Pattern 约束 → Text
 * - Required 约束 → 不影响类型推断
 *
 * @param constraints 约束列表
 * @returns 推断的类型名，如果无法从约束推断则返回 null
 */
export function inferTypeFromConstraints(constraints: readonly Constraint[]): PrimitiveTypeName | null {
  let inferred: PrimitiveTypeName | null = null;

  for (const constraint of constraints) {
    const constraintType = inferConstraintType(constraint);
    if (!constraintType) {
      continue;
    }

    if (!inferred) {
      inferred = constraintType;
      continue;
    }

    // 类型提升：Int + Float → Float
    if (inferred === 'Int' && constraintType === 'Float') {
      inferred = 'Float';
    }
  }

  return inferred;
}

/**
 * 推断字段类型
 *
 * 按优先级尝试推断：
 * 1. 约束驱动推断
 * 2. 命名约定推断
 * 3. 默认类型（Text）
 *
 * @param fieldName 字段名称
 * @param constraints 可选的约束列表
 * @returns 推断的类型 AST 节点
 */
export function inferFieldType(
  fieldName: string,
  constraints: readonly Constraint[] = [],
  lexicon?: Lexicon,
): Type {
  const constraintDriven = inferTypeFromConstraints(constraints);
  if (constraintDriven) return createPrimitiveType(constraintDriven);

  const nameDriven = inferFromName(fieldName, lexicon);
  if (nameDriven) return createPrimitiveType(nameDriven);

  return createPrimitiveType(DEFAULT_TYPE);
}

/**
 * 根据约束修正已推断的类型
 *
 * 当字段使用推断类型后又解析到约束时，可能需要修正类型。
 * 例如：字段名 `value` 默认推断为 Text，但如果有 Range 约束则应为数值类型。
 *
 * @param currentType 当前推断的类型
 * @param constraints 约束列表
 * @returns 修正后的类型
 */
export function refineInferredType(currentType: Type, constraints: readonly Constraint[]): Type {
  if (constraints.length === 0) {
    return currentType;
  }

  const refined = inferTypeFromConstraints(constraints);
  if (!refined) {
    return currentType;
  }

  // 检查当前类型是否与约束推断冲突
  const currentPrimitive = normalizePrimitiveType(currentType);

  // 如果当前类型与约束推断一致，保持不变
  if (currentPrimitive && currentPrimitive === refined) {
    return currentType;
  }

  // 如果当前是 Text（默认）而约束要求数值，采用约束推断
  if (currentPrimitive === 'Text' && (refined === 'Int' || refined === 'Float')) {
    return createPrimitiveType(refined);
  }

  // Int 可以提升为 Float
  if (currentPrimitive === 'Int' && refined === 'Float') {
    return createPrimitiveType('Float');
  }

  // 其他情况保持当前类型（避免意外修改）
  return currentType;
}

/**
 * 从单个约束推断类型
 */
function inferConstraintType(constraint: Constraint): PrimitiveTypeName | null {
  switch (constraint.kind) {
    case 'Pattern':
      // Pattern 约束只对文本有意义
      return 'Text';
    case 'Range':
      // Range 约束表示数值类型
      return hasFractionalBound(constraint) ? 'Float' : 'Int';
    case 'Required':
      // Required 不影响类型
      return null;
    default:
      return null;
  }
}

/**
 * 检查 Range 约束是否包含小数边界
 */
function hasFractionalBound(range: ConstraintRange): boolean {
  return [range.min, range.max].some(
    (value) => value !== undefined && !Number.isInteger(value)
  );
}

/** 规则缓存（按 lexicon id） */
const ruleCache = new Map<string, readonly TypeInferenceRule[]>();

function getMergedRules(lexicon?: Lexicon): readonly TypeInferenceRule[] {
  if (!lexicon?.typeInferenceRules) return BASE_NAMING_RULES;
  const id = lexicon.id;
  const cached = ruleCache.get(id);
  if (cached) return cached;
  const merged = [...BASE_NAMING_RULES, ...lexicon.typeInferenceRules];
  ruleCache.set(id, merged);
  return merged;
}

/**
 * 从字段名推断类型
 */
function inferFromName(fieldName: string, lexicon?: Lexicon): PrimitiveTypeName | null {
  const rules = getMergedRules(lexicon);
  let matchedRule: TypeInferenceRule | null = null;

  for (const rule of rules) {
    if (!rule.pattern.test(fieldName)) continue;
    if (!matchedRule || rule.priority > matchedRule.priority) {
      matchedRule = rule;
    }
  }

  return matchedRule?.type ?? null;
}

/**
 * 将 Type 节点标准化为基础类型名
 */
function normalizePrimitiveType(type: Type): PrimitiveTypeName | null {
  if (type.kind !== 'TypeName') {
    return null;
  }

  switch (type.name) {
    case 'Text':
    case 'Int':
    case 'Bool':
    case 'Float':
    case 'DateTime':
      return type.name as PrimitiveTypeName;
    case 'Double':
      return 'Float';
    default:
      return null;
  }
}

/**
 * 创建基础类型 AST 节点
 */
function createPrimitiveType(typeName: PrimitiveTypeName): Type {
  return Node.TypeName(typeName);
}
