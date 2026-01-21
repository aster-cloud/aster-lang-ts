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
 * @example
 * ```typescript
 * // 金融领域
 * generateFieldValue('creditScore', 'Int')     // → 720
 * generateFieldValue('loanAmount', 'Float')    // → 50000.0
 * generateFieldValue('interestRate', 'Float')  // → 5.5
 * generateFieldValue('isApproved', 'Bool')     // → true
 *
 * // 用户信息
 * generateFieldValue('applicantId', 'Text')    // → "APP-2024-001"
 * generateFieldValue('applicantName', 'Text')  // → "John Smith"
 * generateFieldValue('birthDate', 'DateTime')  // → "1990-01-15"
 * ```
 */

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
interface ValueGenerationRule {
  /** 字段名匹配模式 */
  pattern: RegExp;
  /** 生成函数 */
  generate: () => unknown;
  /** 优先级（数值越大优先级越高） */
  priority: number;
}

/**
 * 金融领域值生成规则
 */
const FINANCIAL_RULES: ValueGenerationRule[] = [
  // 信用评分
  {
    pattern: /(?:credit|fico).*?score/i,
    generate: () => 720,
    priority: 10,
  },
  // 贷款金额
  {
    pattern: /(?:loan|mortgage|principal).*?amount/i,
    generate: () => 50000.0,
    priority: 10,
  },
  // 收入
  {
    pattern: /(?:annual|monthly|yearly)?.*?(?:income|salary|earnings)/i,
    generate: () => 85000.0,
    priority: 9,
  },
  // 债务
  {
    pattern: /(?:monthly)?.*?(?:debt|obligation|payment)/i,
    generate: () => 1500.0,
    priority: 8,
  },
  // 利率
  {
    pattern: /(?:interest|apr|apy).*?rate/i,
    generate: () => 5.5,
    priority: 9,
  },
  {
    pattern: /(?:rate|interest)$/i,
    generate: () => 5.5,
    priority: 7,
  },
  // 贷款期限
  {
    pattern: /(?:loan|term).*?(?:months?|years?|term)/i,
    generate: () => 36,
    priority: 9,
  },
  // DTI (债务收入比)
  {
    pattern: /dti|debt.*?(?:to|income).*?ratio/i,
    generate: () => 0.35,
    priority: 10,
  },
  // LTV (贷款价值比)
  {
    pattern: /ltv|loan.*?(?:to|value).*?ratio/i,
    generate: () => 0.80,
    priority: 10,
  },
];

/**
 * 保险领域值生成规则
 */
const INSURANCE_RULES: ValueGenerationRule[] = [
  // 保费
  {
    pattern: /premium/i,
    generate: () => 1200,
    priority: 9,
  },
  // 免赔额
  {
    pattern: /deductible/i,
    generate: () => 500,
    priority: 9,
  },
  // 保险限额
  {
    pattern: /(?:coverage|policy).*?limit/i,
    generate: () => 100000,
    priority: 9,
  },
  // 驾驶年龄/驾龄
  {
    pattern: /(?:years?)?.*?licensed|driving.*?experience/i,
    generate: () => 8,
    priority: 8,
  },
  // 事故次数
  {
    pattern: /accident.*?(?:count|number)/i,
    generate: () => 0,
    priority: 8,
  },
  // 违章次数
  {
    pattern: /violation.*?(?:count|number)/i,
    generate: () => 1,
    priority: 8,
  },
];

/**
 * 用户/个人信息值生成规则
 */
const PERSONAL_RULES: ValueGenerationRule[] = [
  // 年龄
  {
    pattern: /^age$|.*?age$/i,
    generate: () => 35,
    priority: 10,
  },
  // ID 类型
  {
    pattern: /(?:applicant|customer|user|member|patient).*?id/i,
    generate: () => 'USR-2024-001',
    priority: 10,
  },
  {
    pattern: /(?:policy|claim|order|transaction).*?id/i,
    generate: () => 'POL-2024-001',
    priority: 10,
  },
  {
    pattern: /(?:id|identifier)$/i,
    generate: () => 'ID-001',
    priority: 6,
  },
  // 姓名
  {
    pattern: /(?:applicant|customer|user|patient|member)?.*?name/i,
    generate: () => 'John Smith',
    priority: 8,
  },
  // 邮箱
  {
    pattern: /email/i,
    generate: () => 'john.smith@example.com',
    priority: 9,
  },
  // 电话
  {
    pattern: /phone|mobile|tel/i,
    generate: () => '+1-555-123-4567',
    priority: 9,
  },
  // 地址
  {
    pattern: /address/i,
    generate: () => '123 Main Street, Anytown, ST 12345',
    priority: 8,
  },
  // 工作年限
  {
    pattern: /(?:years?)?.*?(?:employed|employment|work.*?experience)/i,
    generate: () => 5,
    priority: 8,
  },
];

/**
 * 车辆信息值生成规则
 */
const VEHICLE_RULES: ValueGenerationRule[] = [
  // 车辆品牌
  {
    pattern: /(?:vehicle)?.*?make/i,
    generate: () => 'Toyota',
    priority: 9,
  },
  // 车辆型号
  {
    pattern: /(?:vehicle)?.*?model/i,
    generate: () => 'Camry',
    priority: 9,
  },
  // 车辆年份（必须包含 vehicle 或 car 前缀，避免匹配 yearsLicensed）
  {
    pattern: /(?:vehicle|car).*?year/i,
    generate: () => 2022,
    priority: 9,
  },
  // VIN
  {
    pattern: /vin/i,
    generate: () => '1HGBH41JXMN109186',
    priority: 10,
  },
  // 里程
  {
    pattern: /mileage|odometer/i,
    generate: () => 35000,
    priority: 9,
  },
];

/**
 * 医疗健康领域值生成规则
 */
const HEALTHCARE_RULES: ValueGenerationRule[] = [
  // 患者 ID（优先级高于通用用户 ID）
  {
    pattern: /patient.*?id/i,
    generate: () => 'PAT-2024-001',
    priority: 11,
  },
  // 诊断代码
  {
    pattern: /(?:diagnosis|icd).*?code/i,
    generate: () => 'J06.9',
    priority: 10,
  },
  // 索赔金额
  {
    pattern: /claim.*?amount/i,
    generate: () => 2500.0,
    priority: 10,
  },
  // 服务类型
  {
    pattern: /service.*?(?:type|code)/i,
    generate: () => 'OFFICE_VISIT',
    priority: 8,
  },
  // 提供者 ID
  {
    pattern: /provider.*?id/i,
    generate: () => 'PRV-001',
    priority: 9,
  },
];

/**
 * 通用数值类型值生成规则
 */
const NUMERIC_RULES: ValueGenerationRule[] = [
  // 金额类
  {
    pattern: /amount|price|cost|fee|total|balance|payment/i,
    generate: () => 1000.0,
    priority: 5,
  },
  // 百分比/比率
  {
    pattern: /percentage|ratio|percent/i,
    generate: () => 0.25,
    priority: 6,
  },
  // 计数类
  {
    pattern: /count|number|qty|quantity/i,
    generate: () => 10,
    priority: 5,
  },
  // 评分/等级
  {
    pattern: /score|rating|level|rank/i,
    generate: () => 85,
    priority: 5,
  },
  // 限额
  {
    pattern: /limit|max|min|threshold/i,
    generate: () => 1000,
    priority: 5,
  },
];

/**
 * 布尔类型值生成规则
 */
const BOOLEAN_RULES: ValueGenerationRule[] = [
  // 审批/验证状态 - 默认通过
  {
    pattern: /(?:is|has)?.*?(?:approved|verified|valid|active|enabled|confirmed)/i,
    generate: () => true,
    priority: 8,
  },
  // 拒绝/禁用状态 - 默认否
  {
    pattern: /(?:is|has)?.*?(?:rejected|denied|disabled|blocked|suspended)/i,
    generate: () => false,
    priority: 8,
  },
  // 存在性检查 - 默认是
  {
    pattern: /^(?:has|is|can|should|does|did|will|was)/i,
    generate: () => true,
    priority: 6,
  },
  // Flag 后缀 - 默认是
  {
    pattern: /flag$/i,
    generate: () => true,
    priority: 5,
  },
];

/**
 * 日期时间类型值生成规则
 */
const DATETIME_RULES: ValueGenerationRule[] = [
  // 出生日期 - 1990年
  {
    pattern: /birth.*?(?:date|day)|birthday/i,
    generate: () => '1990-01-15',
    priority: 10,
  },
  // 创建/注册日期 - 最近
  {
    pattern: /(?:created|registered|signup|joined).*?(?:date|at|time)/i,
    generate: () => '2024-01-01T10:00:00Z',
    priority: 9,
  },
  // 过期日期 - 未来
  {
    pattern: /(?:expir|expire|expiry|expires).*?(?:date|at|time)/i,
    generate: () => '2025-12-31',
    priority: 9,
  },
  // 更新日期 - 最近
  {
    pattern: /(?:updated|modified|changed).*?(?:date|at|time)/i,
    generate: () => '2024-06-15T14:30:00Z',
    priority: 9,
  },
  // 通用日期 - 今天（使用词尾匹配避免误匹配 data 等）
  {
    pattern: /(?:date|time|timestamp)$/i,
    generate: () => new Date().toISOString().split('T')[0],
    priority: 4,
  },
];

/**
 * 状态/类型枚举值生成规则
 */
const ENUM_RULES: ValueGenerationRule[] = [
  // 账户状态
  {
    pattern: /account.*?status/i,
    generate: () => 'ACTIVE',
    priority: 9,
  },
  // 雇佣状态
  {
    pattern: /employment.*?(?:status|type)/i,
    generate: () => 'EMPLOYED',
    priority: 9,
  },
  // 婚姻状态
  {
    pattern: /marital.*?status/i,
    generate: () => 'MARRIED',
    priority: 9,
  },
  // 住房状态
  {
    pattern: /(?:housing|residence).*?(?:status|type)/i,
    generate: () => 'OWN',
    priority: 9,
  },
  // 通用状态
  {
    pattern: /status/i,
    generate: () => 'ACTIVE',
    priority: 4,
  },
  // 通用类型
  {
    pattern: /type|category|kind/i,
    generate: () => 'STANDARD',
    priority: 4,
  },
];

/**
 * 所有规则（按优先级排序）
 */
const ALL_RULES: ValueGenerationRule[] = [
  ...FINANCIAL_RULES,
  ...INSURANCE_RULES,
  ...PERSONAL_RULES,
  ...VEHICLE_RULES,
  ...HEALTHCARE_RULES,
  ...NUMERIC_RULES,
  ...BOOLEAN_RULES,
  ...DATETIME_RULES,
  ...ENUM_RULES,
].sort((a, b) => b.priority - a.priority);

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
  typeKind: TypeKind = 'primitive'
): unknown {
  // 1. 尝试根据字段名匹配规则生成值
  const ruleBasedValue = generateFromRules(fieldName);
  if (ruleBasedValue !== undefined) {
    // 确保类型兼容
    return coerceToType(ruleBasedValue, typeName, typeKind);
  }

  // 2. 根据类型生成默认值
  return generateDefaultValue(typeName, typeKind);
}

/**
 * 从规则中生成值
 */
function generateFromRules(fieldName: string): unknown | undefined {
  for (const rule of ALL_RULES) {
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
  // 默认为文本
  return '';
}

// 类型检查辅助函数
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
  parameters: ParameterInfo[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const param of parameters) {
    if (param.typeKind === 'struct' && param.fields) {
      // 为结构体生成嵌套对象
      const structValue: Record<string, unknown> = {};
      for (const field of param.fields) {
        structValue[field.name] = generateFieldValue(
          field.name,
          field.type,
          field.typeKind
        );
      }
      result[param.name] = structValue;
    } else if (param.typeKind === 'list') {
      // 为列表生成包含一个示例元素的数组
      result[param.name] = [generateFieldValue(param.name, param.type, 'primitive')];
    } else {
      result[param.name] = generateFieldValue(
        param.name,
        param.type,
        param.typeKind
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
export function getFieldValueHint(fieldName: string, typeName: string): string {
  const value = generateFieldValue(fieldName, typeName, 'primitive');

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
