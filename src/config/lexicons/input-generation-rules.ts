/**
 * 语言特定的输入值生成规则（overlay 模式）
 *
 * 不修改 @generated 的 lexicon 文件，而是通过 attach 函数
 * 在运行时将规则附加到 Lexicon 对象上。
 *
 * 规则数据来源优先级：
 * 1. 从语言包 JSON overlay 加载（通过 registerOverlayRules）
 * 2. 内联 fallback 常量（当 JSON overlay 尚未接入时使用）
 */

import type { ValueGenerationRule } from '../../parser/input-generator.js';
import type { Lexicon } from './types.js';
import type { OverlayData } from './overlay-loader.js';
import { loadInputGenerationRules } from './overlay-loader.js';

/** 内联 fallback：英文字段名值生成规则 */
const EN_US_RULES: readonly ValueGenerationRule[] = [
  // 金融领域
  { pattern: /(?:credit|fico).*?score/i, generate: () => 720, priority: 10 },
  { pattern: /(?:loan|mortgage|principal).*?amount/i, generate: () => 50000.0, priority: 10 },
  { pattern: /(?:annual|monthly|yearly)?.*?(?:income|salary|earnings)/i, generate: () => 85000.0, priority: 9 },
  { pattern: /(?:monthly)?.*?(?:debt|obligation|payment)/i, generate: () => 1500.0, priority: 8 },
  { pattern: /(?:interest|apr|apy).*?rate/i, generate: () => 5.5, priority: 9 },
  { pattern: /(?:rate|interest)$/i, generate: () => 5.5, priority: 7 },
  { pattern: /(?:loan|term).*?(?:months?|years?|term)/i, generate: () => 36, priority: 9 },
  { pattern: /dti|debt.*?(?:to|income).*?ratio/i, generate: () => 0.35, priority: 10 },
  { pattern: /ltv|loan.*?(?:to|value).*?ratio/i, generate: () => 0.80, priority: 10 },
  // 保险领域
  { pattern: /premium/i, generate: () => 1200, priority: 9 },
  { pattern: /deductible/i, generate: () => 500, priority: 9 },
  { pattern: /(?:coverage|policy).*?limit/i, generate: () => 100000, priority: 9 },
  { pattern: /(?:years?)?.*?licensed|driving.*?experience/i, generate: () => 8, priority: 8 },
  { pattern: /accident.*?(?:count|number)/i, generate: () => 0, priority: 8 },
  { pattern: /violation.*?(?:count|number)/i, generate: () => 1, priority: 8 },
  // 用户/个人信息
  { pattern: /^age$|.*?age$/i, generate: () => 35, priority: 10 },
  { pattern: /(?:applicant|customer|user|member|patient).*?id/i, generate: () => 'USR-2024-001', priority: 10 },
  { pattern: /(?:policy|claim|order|transaction).*?id/i, generate: () => 'POL-2024-001', priority: 10 },
  { pattern: /(?:id|identifier)$/i, generate: () => 'ID-001', priority: 6 },
  { pattern: /(?:applicant|customer|user|patient|member)?.*?name/i, generate: () => 'John Smith', priority: 8 },
  { pattern: /email/i, generate: () => 'john.smith@example.com', priority: 9 },
  { pattern: /phone|mobile|tel/i, generate: () => '+1-555-123-4567', priority: 9 },
  { pattern: /address/i, generate: () => '123 Main Street, Anytown, ST 12345', priority: 8 },
  { pattern: /(?:years?)?.*?(?:employed|employment|work.*?experience)/i, generate: () => 5, priority: 8 },
  // 车辆信息
  { pattern: /(?:vehicle)?.*?make/i, generate: () => 'Toyota', priority: 9 },
  { pattern: /(?:vehicle)?.*?model/i, generate: () => 'Camry', priority: 9 },
  { pattern: /(?:vehicle|car).*?year/i, generate: () => 2022, priority: 9 },
  { pattern: /vin/i, generate: () => '1HGBH41JXMN109186', priority: 10 },
  { pattern: /mileage|odometer/i, generate: () => 35000, priority: 9 },
  // 医疗健康
  { pattern: /patient.*?id/i, generate: () => 'PAT-2024-001', priority: 11 },
  { pattern: /(?:diagnosis|icd).*?code/i, generate: () => 'J06.9', priority: 10 },
  { pattern: /claim.*?amount/i, generate: () => 2500.0, priority: 10 },
  { pattern: /service.*?(?:type|code)/i, generate: () => 'OFFICE_VISIT', priority: 8 },
  { pattern: /provider.*?id/i, generate: () => 'PRV-001', priority: 9 },
  // 通用数值
  { pattern: /amount|price|cost|fee|total|balance|payment/i, generate: () => 1000.0, priority: 5 },
  { pattern: /percentage|ratio|percent/i, generate: () => 0.25, priority: 6 },
  { pattern: /count|number|qty|quantity/i, generate: () => 10, priority: 5 },
  { pattern: /score|rating|level|rank/i, generate: () => 85, priority: 5 },
  { pattern: /limit|max|min|threshold/i, generate: () => 1000, priority: 5 },
  // 布尔
  { pattern: /(?:is|has)?.*?(?:approved|verified|valid|active|enabled|confirmed)/i, generate: () => true, priority: 8 },
  { pattern: /(?:is|has)?.*?(?:rejected|denied|disabled|blocked|suspended)/i, generate: () => false, priority: 8 },
  { pattern: /^(?:has|is|can|should|does|did|will|was)/i, generate: () => true, priority: 6 },
  { pattern: /flag$/i, generate: () => true, priority: 5 },
  // 日期时间
  { pattern: /birth.*?(?:date|day)|birthday/i, generate: () => '1990-01-15', priority: 10 },
  { pattern: /(?:created|registered|signup|joined).*?(?:date|at|time)/i, generate: () => '2024-01-01T10:00:00Z', priority: 9 },
  { pattern: /(?:expir|expire|expiry|expires).*?(?:date|at|time)/i, generate: () => '2025-12-31', priority: 9 },
  { pattern: /(?:updated|modified|changed).*?(?:date|at|time)/i, generate: () => '2024-06-15T14:30:00Z', priority: 9 },
  { pattern: /(?:date|time|timestamp)$/i, generate: () => new Date().toISOString().split('T')[0], priority: 4 },
  // 状态/枚举
  { pattern: /account.*?status/i, generate: () => 'ACTIVE', priority: 9 },
  { pattern: /employment.*?(?:status|type)/i, generate: () => 'EMPLOYED', priority: 9 },
  { pattern: /marital.*?status/i, generate: () => 'MARRIED', priority: 9 },
  { pattern: /(?:housing|residence).*?(?:status|type)/i, generate: () => 'OWN', priority: 9 },
  { pattern: /status/i, generate: () => 'ACTIVE', priority: 4 },
  { pattern: /type|category|kind/i, generate: () => 'STANDARD', priority: 4 },
].sort((a, b) => b.priority - a.priority);

/** 内联 fallback：中文字段名值生成规则 */
const ZH_CN_RULES: readonly ValueGenerationRule[] = [
  { pattern: /信用评分|信用分/, generate: () => 720, priority: 10 },
  { pattern: /贷款金额/, generate: () => 50000.0, priority: 10 },
  { pattern: /年收入/, generate: () => 85000.0, priority: 9 },
  { pattern: /月收入/, generate: () => 7000.0, priority: 9 },
  { pattern: /债务/, generate: () => 1500.0, priority: 8 },
  { pattern: /利率/, generate: () => 5.5, priority: 9 },
  { pattern: /贷款期限/, generate: () => 36, priority: 9 },
  { pattern: /保费/, generate: () => 1200, priority: 9 },
  { pattern: /免赔额/, generate: () => 500, priority: 9 },
  { pattern: /保险限额/, generate: () => 100000, priority: 9 },
  { pattern: /驾龄/, generate: () => 8, priority: 8 },
  { pattern: /事故次数/, generate: () => 0, priority: 8 },
  { pattern: /年龄/, generate: () => 35, priority: 10 },
  { pattern: /姓名|申请人/, generate: () => '张三', priority: 8 },
  { pattern: /邮箱/, generate: () => 'zhangsan@example.com', priority: 9 },
  { pattern: /电话|手机/, generate: () => '13800138000', priority: 9 },
  { pattern: /地址/, generate: () => '北京市朝阳区建国路1号', priority: 8 },
  { pattern: /评分/, generate: () => 85, priority: 5 },
  { pattern: /金额/, generate: () => 1000.0, priority: 5 },
  { pattern: /数量|次数/, generate: () => 10, priority: 5 },
  { pattern: /额度/, generate: () => 50000, priority: 8 },
  { pattern: /账龄/, generate: () => 5, priority: 8 },
  { pattern: /卡数/, generate: () => 3, priority: 8 },
  { pattern: /百分比|比率|费率/, generate: () => 0.25, priority: 6 },
];

/** 内联 fallback：德语字段名值生成规则 */
const DE_DE_RULES: readonly ValueGenerationRule[] = [
  { pattern: /Kreditbewertung/i, generate: () => 720, priority: 10 },
  { pattern: /Darlehensbetrag/i, generate: () => 50000.0, priority: 10 },
  { pattern: /Alter/i, generate: () => 35, priority: 10 },
  { pattern: /Name/i, generate: () => 'Max Mustermann', priority: 8 },
  { pattern: /Adresse/i, generate: () => 'Musterstraße 1, 10115 Berlin', priority: 8 },
  { pattern: /Telefon/i, generate: () => '+49-30-12345678', priority: 9 },
  { pattern: /Praemie/i, generate: () => 1200, priority: 9 },
  { pattern: /Selbstbeteiligung/i, generate: () => 500, priority: 9 },
];

const RULES_BY_LEXICON: Record<string, readonly ValueGenerationRule[]> = {
  'en-US': EN_US_RULES,
  'zh-CN': ZH_CN_RULES,
  'de-DE': DE_DE_RULES,
};

/**
 * 从 JSON overlay 数据注册输入生成规则（覆盖内联 fallback）。
 */
export function registerOverlayInputGenerationRules(lexiconId: string, overlay: NonNullable<OverlayData['inputGenerationRules']>): void {
  RULES_BY_LEXICON[lexiconId] = loadInputGenerationRules(overlay);
}

/** 获取指定 lexicon 的输入生成规则，回退到英文 */
export function getInputGenerationRules(lexicon?: Lexicon): readonly ValueGenerationRule[] {
  if (!lexicon) return EN_US_RULES;
  return lexicon.inputGenerationRules ?? RULES_BY_LEXICON[lexicon.id] ?? EN_US_RULES;
}

/** 为 lexicon 附加输入值生成规则（不修改原对象） */
export function attachInputGenerationRules(lexicon: Lexicon): Lexicon {
  if (lexicon.inputGenerationRules) return lexicon;
  const rules = RULES_BY_LEXICON[lexicon.id];
  if (!rules) return lexicon;
  return { ...lexicon, inputGenerationRules: rules };
}
