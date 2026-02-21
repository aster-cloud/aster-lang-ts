/**
 * @module config/lexicons/identifiers/domains/insurance.auto.zh-CN
 *
 * 汽车保险领域词汇表 - 简体中文。
 *
 * 该词汇表定义汽车保险业务中常用的结构体、字段和函数名称映射。
 * 用户可以使用中文编写策略，系统自动转换为规范化名称进行编译。
 *
 * @example
 * 用户编写：
 * ```
 * 定义 驾驶员 包含 年龄：整数，驾龄：整数。
 * ```
 *
 * 系统转换为：
 * ```
 * Define Driver with age: Int, drivingYears: Int.
 * ```
 */

import { DomainVocabulary, IdentifierKind } from '../types.js';

/**
 * 汽车保险领域词汇表（简体中文）。
 */
export const INSURANCE_AUTO_ZH_CN: DomainVocabulary = {
  id: 'insurance.auto',
  name: '汽车保险',
  locale: 'zh-CN',
  version: '1.0.0',

  metadata: {
    author: 'Aster Team',
    createdAt: '2025-01-06',
    description: '汽车保险业务领域的中文标识符映射',
  },

  // ==========================================
  // 结构体映射
  // ==========================================
  structs: [
    {
      canonical: 'Driver',
      localized: '驾驶员',
      kind: IdentifierKind.STRUCT,
      description: '驾驶员信息',
      aliases: ['司机', '驾驶人'],
    },
    {
      canonical: 'Vehicle',
      localized: '车辆',
      kind: IdentifierKind.STRUCT,
      description: '车辆信息',
      aliases: ['汽车', '机动车'],
    },
    {
      canonical: 'QuoteResult',
      localized: '报价结果',
      kind: IdentifierKind.STRUCT,
      description: '保险报价结果',
      aliases: ['报价'],
    },
    {
      canonical: 'Accident',
      localized: '事故',
      kind: IdentifierKind.STRUCT,
      description: '事故记录',
      aliases: ['事故记录'],
    },
    {
      canonical: 'Violation',
      localized: '违章',
      kind: IdentifierKind.STRUCT,
      description: '违章记录',
      aliases: ['违章记录', '交通违法'],
    },
    {
      canonical: 'Policy',
      localized: '保单',
      kind: IdentifierKind.STRUCT,
      description: '保险单',
      aliases: ['保险单', '保险合同'],
    },
    {
      canonical: 'Claim',
      localized: '理赔',
      kind: IdentifierKind.STRUCT,
      description: '理赔申请',
      aliases: ['理赔申请', '索赔'],
    },
  ],

  // ==========================================
  // 字段映射
  // ==========================================
  fields: [
    // Driver 字段
    {
      canonical: 'id',
      localized: '编号',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      description: '驾驶员唯一标识',
      aliases: ['标识', 'ID'],
    },
    {
      canonical: 'age',
      localized: '年龄',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      description: '驾驶员年龄',
    },
    {
      canonical: 'drivingYears',
      localized: '驾龄',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      description: '驾驶年限',
      aliases: ['驾驶年限', '驾驶经验'],
    },
    {
      canonical: 'accidents',
      localized: '事故次数',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      description: '历史事故次数',
      aliases: ['事故数', '出险次数'],
    },
    {
      canonical: 'violations',
      localized: '违章次数',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      description: '交通违章次数',
      aliases: ['违章数', '违法次数'],
    },
    {
      canonical: 'licenseNumber',
      localized: '驾照号',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      description: '驾驶证号码',
      aliases: ['驾驶证号', '驾照编号'],
    },

    // Vehicle 字段
    {
      canonical: 'plateNo',
      localized: '车牌号',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      description: '车辆牌照号码',
      aliases: ['牌照', '车牌'],
    },
    {
      canonical: 'vehicleAge',
      localized: '车龄',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      description: '车辆使用年限',
      aliases: ['使用年限'],
    },
    {
      canonical: 'value',
      localized: '价值',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      description: '车辆价值',
      aliases: ['车价', '估值'],
    },
    {
      canonical: 'safetyScore',
      localized: '安全评分',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      description: '车辆安全等级评分',
      aliases: ['安全分', '安全等级'],
    },
    {
      canonical: 'brand',
      localized: '品牌',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      description: '车辆品牌',
      aliases: ['厂牌'],
    },
    {
      canonical: 'model',
      localized: '型号',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      description: '车辆型号',
      aliases: ['车型'],
    },

    // QuoteResult 字段
    {
      canonical: 'approved',
      localized: '批准',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      description: '是否批准',
      aliases: ['是否批准', '通过'],
    },
    {
      canonical: 'reason',
      localized: '原因',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      description: '结果原因',
      aliases: ['理由', '说明'],
    },
    {
      canonical: 'monthlyPremium',
      localized: '月保费',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      description: '每月保险费',
      aliases: ['月费', '月缴保费'],
    },
    {
      canonical: 'annualPremium',
      localized: '年保费',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      description: '每年保险费',
      aliases: ['年费', '年缴保费'],
    },
    {
      canonical: 'deductible',
      localized: '免赔额',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      description: '保险免赔额',
      aliases: ['自付额', '起赔线'],
    },
    {
      canonical: 'coverage',
      localized: '保额',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      description: '保险金额',
      aliases: ['保险金额', '赔付上限'],
    },

    // 通用字段（可在多个结构体中使用）
    {
      canonical: 'name',
      localized: '名称',
      kind: IdentifierKind.FIELD,
      description: '通用名称字段',
      aliases: ['姓名', '名字'],
    },
    {
      canonical: 'date',
      localized: '日期',
      kind: IdentifierKind.FIELD,
      description: '通用日期字段',
    },
    {
      canonical: 'amount',
      localized: '金额',
      kind: IdentifierKind.FIELD,
      description: '通用金额字段',
      aliases: ['数额', '费用'],
    },
    {
      canonical: 'status',
      localized: '状态',
      kind: IdentifierKind.FIELD,
      description: '通用状态字段',
    },
  ],

  // ==========================================
  // 函数映射
  // ==========================================
  functions: [
    {
      canonical: 'generateQuote',
      localized: '生成报价',
      kind: IdentifierKind.FUNCTION,
      description: '生成保险报价',
      aliases: ['计算报价', '出报价'],
    },
    {
      canonical: 'calculateAgeFactor',
      localized: '计算年龄因子',
      kind: IdentifierKind.FUNCTION,
      description: '根据年龄计算保费因子',
      aliases: ['年龄因子'],
    },
    {
      canonical: 'calculateRiskFactor',
      localized: '计算风险系数',
      kind: IdentifierKind.FUNCTION,
      description: '计算综合风险系数',
      aliases: ['风险系数', '计算风险'],
    },
    {
      canonical: 'calculatePremium',
      localized: '计算保费',
      kind: IdentifierKind.FUNCTION,
      description: '计算保险费用',
      aliases: ['保费计算'],
    },
    {
      canonical: 'checkEligibility',
      localized: '检查资格',
      kind: IdentifierKind.FUNCTION,
      description: '检查投保资格',
      aliases: ['资格检查', '验证资格'],
    },
    {
      canonical: 'processClaim',
      localized: '处理理赔',
      kind: IdentifierKind.FUNCTION,
      description: '处理理赔申请',
      aliases: ['理赔处理'],
    },
  ],

  // ==========================================
  // 枚举值映射
  // ==========================================
  enumValues: [
    {
      canonical: 'Approved',
      localized: '已批准',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['通过', '批准'],
    },
    {
      canonical: 'Rejected',
      localized: '已拒绝',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['拒绝', '不通过'],
    },
    {
      canonical: 'Pending',
      localized: '待处理',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['处理中', '审核中'],
    },
    {
      canonical: 'HighRisk',
      localized: '高风险',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['高危'],
    },
    {
      canonical: 'MediumRisk',
      localized: '中风险',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['中危'],
    },
    {
      canonical: 'LowRisk',
      localized: '低风险',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['低危'],
    },
  ],
};
