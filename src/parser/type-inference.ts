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

/** 基础类型名称 */
type PrimitiveTypeName = 'Text' | 'Int' | 'Float' | 'Bool' | 'DateTime';

/**
 * 类型推断规则接口
 */
export interface TypeInferenceRule {
  /** 字段名匹配模式 */
  readonly pattern: RegExp;
  /** 推断的类型 */
  readonly type: PrimitiveTypeName;
  /** 优先级（数值越大优先级越高） */
  readonly priority: number;
}

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
export const NAMING_RULES: readonly TypeInferenceRule[] = [
  // 明确的文本字段（避免误匹配 age 等数值后缀）
  { pattern: /(?:Message|Dosage)$/i, type: 'Text', priority: 11 },

  // ID 类型 - 各种标识符
  { pattern: /(?:Id|ID|Identifier)$/i, type: 'Text', priority: 10 },
  { pattern: /(?:Code|Key|Token|Uuid|Guid|Vin)$/i, type: 'Text', priority: 8 },

  // 金额/价格类型 - 金融相关（Float 表示精确小数）
  {
    pattern: /(?:Amount|Price|Cost|Fee|Total|Balance|Salary|Income|Payment|Percentage|Ratio)$/i,
    type: 'Float',
    priority: 10,
  },
  // 利率类型 - 通常为小数（APR/APY 在业务中常用整数基点表示，见下方规则）
  {
    pattern: /(?:Rate|Interest)$/i,
    type: 'Float',
    priority: 9,
  },
  // 利率/费率（中文）
  {
    pattern: /(?:利率|费率|比率|百分比)$/,
    type: 'Float',
    priority: 9,
  },

  // 计数/数量类型 - 整数相关（英文）
  {
    pattern: /(?:Count|Number|Qty|Quantity|Age|Score|Level|Rank|Index|Size|Length|Width|Height)$/i,
    type: 'Int',
    priority: 10,
  },
  // 计数/数量类型 - 整数相关（中文）
  // 评分/年龄/数量/次数/额度 等
  {
    pattern: /(?:评分|年龄|数量|次数|额度|金额|保费|免赔额|账龄|卡数)$/,
    type: 'Int',
    priority: 10,
  },
  {
    pattern: /(?:Checked)$/i,
    type: 'Int',
    priority: 8,
  },
  // 业务指标类型 - 整数（评级、限额、保费等）
  {
    pattern: /(?:Rating|Limit|Premium|Deductible|Multiplier|Deposit|Line|Utilization|Inquiries|Rent|Debt|Cards|Value|Payments)$/i,
    type: 'Int',
    priority: 9,
  },
  // 经验/工龄类型 - 整数
  {
    pattern: /(?:Licensed|Employed|Job|Experience)$/i,
    type: 'Int',
    priority: 8,
  },
  // 基点表示（整数）
  {
    pattern: /(?:Bps|APR|APY)$/i,
    type: 'Int',
    priority: 9,
  },
  // 时间单位（整数）
  {
    pattern: /(?:Years?|Months?|Weeks?|Days?|Hours?|Minutes?|Seconds?)$/i,
    type: 'Int',
    priority: 9,
  },

  // 布尔类型 - 前缀匹配（英文）
  {
    pattern: /^(?:is|has|can|should|was|will|did|does|allow|enable|disable|active|valid|require)/i,
    type: 'Bool',
    priority: 11,
  },
  // 布尔类型 - 前缀匹配（中文）
  // 是否* = "whether", 有无* = "has/have", 能否* = "can", 可否* = "may"
  {
    pattern: /^(?:是否|有无|能否|可否|允许|启用|禁用)/,
    type: 'Bool',
    priority: 11,
  },
  // 布尔类型 - 后缀匹配（英文）
  {
    pattern: /(?:Flag|Enabled|Disabled|Active|Valid|Approved|Rejected|Completed|Confirmed|Sufficient|Success|Passed|Verified)$/i,
    type: 'Bool',
    priority: 8,
  },
  // 布尔类型 - 后缀匹配（中文）
  // 仅包含明确的布尔语义词汇，排除可能是状态枚举的词（成功/失败/完成）
  {
    pattern: /(?:批准|通过|有效|合格|可疑|确认|验证)$/,
    type: 'Bool',
    priority: 8,
  },

  // 日期时间类型
  {
    pattern: /(?:Date|Time|At|Timestamp|Created|Updated|Modified|Expired|Birthday|Anniversary)$/i,
    type: 'DateTime',
    priority: 10,
  },

  // 分类/状态类型 - 文本
  {
    pattern: /(?:Type|Status|Category|Kind|Mode)$/i,
    type: 'Text',
    priority: 8,
  },
  // 产品/车辆属性 - 文本
  {
    pattern: /(?:Make|Model|Brand|Manufacturer)$/i,
    type: 'Text',
    priority: 7,
  },
  // 名称/描述类型 - 明确为文本
  {
    pattern: /(?:Name|Title|Description|Comment|Note|Remark|Address|Email|Phone|Url|Path|Reason|Recommendation|Factors|Purpose)$/i,
    type: 'Text',
    priority: 7,
  },
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
export function inferFieldType(fieldName: string, constraints: readonly Constraint[] = []): Type {
  // 优先使用约束推断
  const constraintDriven = inferTypeFromConstraints(constraints);
  if (constraintDriven) {
    return createPrimitiveType(constraintDriven);
  }

  // 其次使用命名推断
  const nameDriven = inferFromName(fieldName);
  if (nameDriven) {
    return createPrimitiveType(nameDriven);
  }

  // 默认类型
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

/**
 * 从字段名推断类型
 */
function inferFromName(fieldName: string): PrimitiveTypeName | null {
  let matchedRule: TypeInferenceRule | null = null;

  for (const rule of NAMING_RULES) {
    if (!rule.pattern.test(fieldName)) {
      continue;
    }
    // 选择优先级最高的匹配规则
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
