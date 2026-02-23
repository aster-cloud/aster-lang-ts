/**
 * CNL 策略输入值生成器
 *
 * 根据字段名称和类型自动生成有意义的示例输入值，
 * 用于策略执行时的输入自动填充。
 *
 * 生成策略：
 * 1. 根据字段名匹配业务领域规则，生成符合业务语义的值
 * 2. 根据字段类型生成合适的默认值
 * 3. 支持嵌套结构（struct）和数组类型
 *
 * 规则数据来源：
 * - 语言特定规则由 input-generation-rules.ts 管理（overlay 模式）
 * - 无 lexicon 时回退到英文基线规则
 *
 * @example
 * ```typescript
 * generateFieldValue('creditScore', 'Int')     // → 720
 * generateFieldValue('loanAmount', 'Float')    // → 50000.0
 * generateFieldValue('interestRate', 'Float')  // → 5.5
 * generateFieldValue('isApproved', 'Bool')     // → true
 *
 * generateFieldValue('applicantId', 'Text')    // → "USR-2024-001"
 * generateFieldValue('applicantName', 'Text')  // → "John Smith"
 * generateFieldValue('birthDate', 'DateTime')  // → "1990-01-15"
 * ```
 */

import type { Lexicon } from '../config/lexicons/types.js';
import { getInputGenerationRules } from '../config/lexicons/input-generation-rules.js';

/** 类型种类 */
export type TypeKind =
  | 'primitive'
  | 'struct'
  | 'enum'
  | 'list'
  | 'map'
  | 'option'
  | 'result'
  | 'function'
  | 'unknown';

/** 字段信息 */
export interface FieldInfo {
  name: string;
  type: string;
  typeKind: TypeKind;
  fields?: FieldInfo[]; // 嵌套字段（用于 struct 类型）
}

/** 参数信息 */
export interface ParameterInfo {
  name: string;
  type: string;
  typeKind: TypeKind;
  optional: boolean;
  position: number;
  fields?: FieldInfo[];
}

/**
 * 值生成规则接口
 */
export interface ValueGenerationRule {
  /** 字段名匹配模式 */
  pattern: RegExp;
  /** 生成函数 */
  generate: () => unknown;
  /** 优先级（数值越大优先级越高） */
  priority: number;
}

/**
 * 根据字段名和类型生成示例值
 *
 * @param fieldName 字段名称
 * @param typeName 类型名称（如 'Int', 'Float', 'Text', 'Bool', 'DateTime'）
 * @param typeKind 类型种类（如 'primitive', 'struct', 'list'）
 * @returns 生成的示例值
 */
export function generateFieldValue(
  fieldName: string,
  typeName: string,
  typeKind: TypeKind = 'primitive',
  lexicon?: Lexicon,
): unknown {
  const rules = getInputGenerationRules(lexicon);
  const matched = matchRule(fieldName, rules);
  if (matched !== undefined) {
    return coerceToType(matched, typeName, typeKind);
  }

  return generateDefaultValue(typeName, typeKind);
}

/**
 * 从指定规则集中匹配并生成值（按优先级降序匹配）
 */
function matchRule(fieldName: string, rules: readonly ValueGenerationRule[]): unknown | undefined {
  for (const rule of rules) {
    if (rule.pattern.test(fieldName)) {
      return rule.generate();
    }
  }
  return undefined;
}

/**
 * 将值转换为目标类型
 */
function coerceToType(value: unknown, typeName: string, typeKind: TypeKind): unknown {
  if (typeKind !== 'primitive') {
    return value;
  }

  const normalizedType = typeName.toLowerCase();

  if (isIntType(normalizedType)) {
    if (typeof value === 'number') {
      return Math.round(value);
    }
    if (typeof value === 'string' && !isNaN(Number(value))) {
      return parseInt(value, 10);
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
  }

  if (isFloatType(normalizedType)) {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && !isNaN(Number(value))) {
      return parseFloat(value);
    }
    if (typeof value === 'boolean') {
      return value ? 1.0 : 0.0;
    }
  }

  if (isBoolType(normalizedType)) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
  }

  if (isTextType(normalizedType)) {
    return String(value);
  }

  return value;
}

/**
 * 生成类型的默认值
 */
function generateDefaultValue(typeName: string, typeKind: TypeKind): unknown {
  switch (typeKind) {
    case 'struct':
      return {};
    case 'list':
      return [];
    case 'map':
      return {};
    case 'option':
      return null;
    case 'primitive':
      return generatePrimitiveDefault(typeName);
    default:
      return '';
  }
}

/**
 * 生成基础类型的默认值
 */
function generatePrimitiveDefault(typeName: string): unknown {
  const normalized = typeName.toLowerCase();

  if (isIntType(normalized)) {
    return 0;
  }
  if (isFloatType(normalized)) {
    return 0.0;
  }
  if (isBoolType(normalized)) {
    return false;
  }
  if (isDateTimeType(normalized)) {
    return new Date().toISOString().split('T')[0];
  }
  return '';
}

function isIntType(typeName: string): boolean {
  return ['int', 'integer', 'i32', 'i64', 'long', 'short'].some((t) =>
    typeName.includes(t)
  );
}

function isFloatType(typeName: string): boolean {
  return ['float', 'double', 'decimal', 'number', 'f32', 'f64', 'real'].some((t) =>
    typeName.includes(t)
  );
}

function isBoolType(typeName: string): boolean {
  return ['bool', 'boolean'].some((t) => typeName.includes(t));
}

function isTextType(typeName: string): boolean {
  return ['text', 'string', 'str', 'char', 'varchar'].some((t) =>
    typeName.includes(t)
  );
}

function isDateTimeType(typeName: string): boolean {
  return ['date', 'time', 'datetime', 'timestamp'].some((t) =>
    typeName.includes(t)
  );
}

/**
 * 为完整的参数列表生成输入值
 *
 * @param parameters 参数列表
 * @returns 生成的输入值对象
 */
export function generateInputValues(
  parameters: ParameterInfo[],
  lexicon?: Lexicon,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const param of parameters) {
    if (param.typeKind === 'struct' && param.fields) {
      const structValue: Record<string, unknown> = {};
      for (const field of param.fields) {
        structValue[field.name] = generateFieldValue(
          field.name,
          field.type,
          field.typeKind,
          lexicon,
        );
      }
      result[param.name] = structValue;
    } else if (param.typeKind === 'list') {
      result[param.name] = [generateFieldValue(param.name, param.type, 'primitive', lexicon)];
    } else {
      result[param.name] = generateFieldValue(
        param.name,
        param.type,
        param.typeKind,
        lexicon,
      );
    }
  }

  return result;
}

/**
 * 获取字段的示例值描述（用于 UI 提示）
 *
 * @param fieldName 字段名称
 * @param typeName 类型名称
 * @returns 示例值描述
 */
export function getFieldValueHint(fieldName: string, typeName: string, lexicon?: Lexicon): string {
  const value = generateFieldValue(fieldName, typeName, 'primitive', lexicon);

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
