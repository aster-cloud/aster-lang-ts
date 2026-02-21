// @generated — 由 scripts/generate-vocabularies.ts 自动生成，请勿手动修改

import { type DomainVocabulary, IdentifierKind } from '../types.js';

export const FINANCE_LOAN_EN_US: DomainVocabulary = {
  id: 'finance.loan',
  name: 'Finance Loan',
  locale: 'en-US',
  version: '1.0.0',

  metadata: {
    author: 'Aster Team',
    createdAt: '2025-01-06',
    description: 'Finance loan domain identifier mappings for English',
  },

  structs: [
    {
      canonical: 'Applicant',
      localized: 'Applicant',
      kind: IdentifierKind.STRUCT,
      aliases: ['Borrower'],
    },
    {
      canonical: 'LoanRequest',
      localized: 'LoanRequest',
      kind: IdentifierKind.STRUCT,
      aliases: ['LoanApplication'],
    },
    {
      canonical: 'ApprovalResult',
      localized: 'ApprovalResult',
      kind: IdentifierKind.STRUCT,
    },
    {
      canonical: 'CreditReport',
      localized: 'CreditReport',
      kind: IdentifierKind.STRUCT,
    },
    {
      canonical: 'Collateral',
      localized: 'Collateral',
      kind: IdentifierKind.STRUCT,
    },
    {
      canonical: 'RepaymentPlan',
      localized: 'RepaymentPlan',
      kind: IdentifierKind.STRUCT,
    },
  ],

  fields: [
    {
      canonical: 'id',
      localized: 'id',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'age',
      localized: 'age',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'income',
      localized: 'income',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'creditScore',
      localized: 'creditScore',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'workYears',
      localized: 'workYears',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['yearsEmployed'],
    },
    {
      canonical: 'debtRatio',
      localized: 'debtRatio',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
      aliases: ['debtToIncomeRatio'],
    },
    {
      canonical: 'employer',
      localized: 'employer',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'name',
      localized: 'name',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'idNumber',
      localized: 'idNumber',
      kind: IdentifierKind.FIELD,
      parent: 'Applicant',
    },
    {
      canonical: 'amount',
      localized: 'amount',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
      aliases: ['loanAmount'],
    },
    {
      canonical: 'termMonths',
      localized: 'termMonths',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
      aliases: ['loanTerm'],
    },
    {
      canonical: 'purpose',
      localized: 'purpose',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
      aliases: ['loanPurpose'],
    },
    {
      canonical: 'loanType',
      localized: 'loanType',
      kind: IdentifierKind.FIELD,
      parent: 'LoanRequest',
    },
    {
      canonical: 'approved',
      localized: 'approved',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
    },
    {
      canonical: 'reason',
      localized: 'reason',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
    },
    {
      canonical: 'interestRate',
      localized: 'interestRate',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
    },
    {
      canonical: 'monthlyPayment',
      localized: 'monthlyPayment',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
    },
    {
      canonical: 'approvedAmount',
      localized: 'approvedAmount',
      kind: IdentifierKind.FIELD,
      parent: 'ApprovalResult',
    },
    {
      canonical: 'score',
      localized: 'score',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
    },
    {
      canonical: 'level',
      localized: 'level',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
      aliases: ['creditLevel'],
    },
    {
      canonical: 'latePayments',
      localized: 'latePayments',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
    },
    {
      canonical: 'totalDebt',
      localized: 'totalDebt',
      kind: IdentifierKind.FIELD,
      parent: 'CreditReport',
    },
    {
      canonical: 'type',
      localized: 'type',
      kind: IdentifierKind.FIELD,
      parent: 'Collateral',
    },
    {
      canonical: 'value',
      localized: 'value',
      kind: IdentifierKind.FIELD,
      parent: 'Collateral',
    },
    {
      canonical: 'description',
      localized: 'description',
      kind: IdentifierKind.FIELD,
      parent: 'Collateral',
    },
  ],

  functions: [
    {
      canonical: 'evaluateLoan',
      localized: 'evaluateLoan',
      kind: IdentifierKind.FUNCTION,
      aliases: ['assessLoan'],
    },
    {
      canonical: 'checkBasicQualification',
      localized: 'checkBasicQualification',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculateCreditLevel',
      localized: 'calculateCreditLevel',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculateInterestRate',
      localized: 'calculateInterestRate',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculateMonthlyPayment',
      localized: 'calculateMonthlyPayment',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'checkDebtRatio',
      localized: 'checkDebtRatio',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'assessCollateral',
      localized: 'assessCollateral',
      kind: IdentifierKind.FUNCTION,
      aliases: ['evaluateCollateral'],
    },
  ],

  enumValues: [
    {
      canonical: 'Excellent',
      localized: 'Excellent',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'Good',
      localized: 'Good',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'Fair',
      localized: 'Fair',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'Poor',
      localized: 'Poor',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'Personal',
      localized: 'Personal',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['PersonalLoan'],
    },
    {
      canonical: 'Mortgage',
      localized: 'Mortgage',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['HomeLoan'],
    },
    {
      canonical: 'Business',
      localized: 'Business',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['BusinessLoan'],
    },
    {
      canonical: 'Auto',
      localized: 'Auto',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['AutoLoan', 'CarLoan'],
    },
  ],
};
