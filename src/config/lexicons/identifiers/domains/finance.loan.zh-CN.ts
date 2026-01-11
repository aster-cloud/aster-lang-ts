/**
 * @module config/lexicons/identifiers/domains/finance.loan.zh-CN
 *
 * 贷款金融领域词汇表 - 简体中文。
 *
 * 该词汇表定义贷款业务中常用的结构体、字段和函数名称映射。
 */

import { DomainVocabulary, IdentifierKind } from '../types.js';

/**
 * 贷款金融领域词汇表（简体中文）。
 */
export const FINANCE_LOAN_ZH_CN: DomainVocabulary = {
  id: 'finance.loan',
  name: '贷款金融',
  locale: 'zh-CN',
  version: '1.0.0',

  metadata: {
    author: 'Aster Team',
    createdAt: '2025-01-06',
    description: '贷款金融业务领域的中文标识符映射',
  },

  // ==========================================
  // 结构体映射
  // ==========================================
  structs: [
    {
      canonical: 'Applicant',
      localized: '申请人',
      kind: IdentifierKind.STRUCT,
      description: '贷款申请人',
      aliases: ['借款人', '贷款人'],
    },
    {
      canonical: 'LoanRequest',
      localized: '贷款申请',
      kind: IdentifierKind.STRUCT,
      description: '贷款申请信息',
      aliases: ['借款申请', '申请'],
    },
    {
      canonical: 'ApprovalResult',
      localized: '审批结果',
      kind: IdentifierKind.STRUCT,
      description: '贷款审批结果',
      aliases: ['批准结果', '审核结果'],
    },
    {
      canonical: 'CreditReport',
      localized: '信用报告',
      kind: IdentifierKind.STRUCT,
      description: '信用评估报告',
      aliases: ['征信报告', '信用记录'],
    },
    {
      canonical: 'Collateral',
      localized: '抵押物',
      kind: IdentifierKind.STRUCT,
      description: '贷款抵押物',
      aliases: ['担保物', '抵押品'],
    },
    {
      canonical: 'RepaymentPlan',
      localized: '还款计划',
      kind: IdentifierKind.STRUCT,
      description: '贷款还款计划',
      aliases: ['还款方案'],
    },
  ],

  // ==========================================
  // 字段映射
  // ==========================================
  fields: [
    // Applicant 字段
    {
      canonical: 'id',
      localized: '编号',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['标识', 'ID', '申请人编号'],
    },
    {
      canonical: 'age',
      localized: '年龄',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'income',
      localized: '收入',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['年收入', '月收入'],
    },
    {
      canonical: 'creditScore',
      localized: '信用评分',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['信用分', '征信分'],
    },
    {
      canonical: 'workYears',
      localized: '工作年限',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['工龄', '从业年限'],
    },
    {
      canonical: 'debtRatio',
      localized: '负债率',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['负债比', '债务比率'],
    },
    {
      canonical: 'employer',
      localized: '雇主',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['工作单位', '公司'],
    },

    // LoanRequest 字段
    {
      canonical: 'amount',
      localized: '金额',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
      aliases: ['贷款金额', '申请金额'],
    },
    {
      canonical: 'termMonths',
      localized: '期限',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
      aliases: ['贷款期限', '还款期限', '月数'],
    },
    {
      canonical: 'purpose',
      localized: '用途',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
      aliases: ['贷款用途', '借款用途'],
    },
    {
      canonical: 'loanType',
      localized: '贷款类型',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
      aliases: ['类型', '产品类型'],
    },

    // ApprovalResult 字段
    {
      canonical: 'approved',
      localized: '批准',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
      aliases: ['是否批准', '通过'],
    },
    {
      canonical: 'reason',
      localized: '原因',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
      aliases: ['理由', '审批意见'],
    },
    {
      canonical: 'interestRate',
      localized: '利率',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
      aliases: ['年利率', '贷款利率'],
    },
    {
      canonical: 'monthlyPayment',
      localized: '月供',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
      aliases: ['月还款额', '每月还款'],
    },
    {
      canonical: 'approvedAmount',
      localized: '批准金额',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
      aliases: ['核准金额', '授信额度'],
    },

    // CreditReport 字段
    {
      canonical: 'score',
      localized: '评分',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
      aliases: ['分数', '信用分'],
    },
    {
      canonical: 'level',
      localized: '等级',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
      aliases: ['信用等级', '级别'],
    },
    {
      canonical: 'latePayments',
      localized: '逾期次数',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
      aliases: ['逾期记录', '违约次数'],
    },
    {
      canonical: 'totalDebt',
      localized: '总负债',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
      aliases: ['负债总额', '债务总额'],
    },
  ],

  // ==========================================
  // 函数映射
  // ==========================================
  functions: [
    {
      canonical: 'evaluateLoan',
      localized: '评估贷款',
      kind: IdentifierKind.FUNCTION,
      description: '评估贷款申请',
      aliases: ['贷款评估', '审核贷款'],
    },
    {
      canonical: 'checkBasicQualification',
      localized: '检查基础资格',
      kind: IdentifierKind.FUNCTION,
      aliases: ['基础资格检查', '资格审核'],
    },
    {
      canonical: 'calculateCreditLevel',
      localized: '计算信用等级',
      kind: IdentifierKind.FUNCTION,
      aliases: ['信用等级计算'],
    },
    {
      canonical: 'calculateInterestRate',
      localized: '计算利率',
      kind: IdentifierKind.FUNCTION,
      aliases: ['利率计算'],
    },
    {
      canonical: 'calculateMonthlyPayment',
      localized: '计算月供',
      kind: IdentifierKind.FUNCTION,
      aliases: ['月供计算'],
    },
    {
      canonical: 'checkDebtRatio',
      localized: '检查负债率',
      kind: IdentifierKind.FUNCTION,
      aliases: ['负债率检查'],
    },
  ],

  // ==========================================
  // 枚举值映射
  // ==========================================
  enumValues: [
    {
      canonical: 'Excellent',
      localized: '优秀',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['优'],
    },
    {
      canonical: 'Good',
      localized: '良好',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['良'],
    },
    {
      canonical: 'Fair',
      localized: '一般',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['中'],
    },
    {
      canonical: 'Poor',
      localized: '较差',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['差'],
    },
    {
      canonical: 'Personal',
      localized: '个人贷款',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['消费贷'],
    },
    {
      canonical: 'Mortgage',
      localized: '房贷',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['房屋贷款', '按揭贷款'],
    },
    {
      canonical: 'Business',
      localized: '经营贷款',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['企业贷款', '商业贷款'],
    },
  ],
};
