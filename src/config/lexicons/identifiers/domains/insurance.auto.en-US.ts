// @generated — 由 scripts/generate-vocabularies.ts 自动生成，请勿手动修改

import { type DomainVocabulary, IdentifierKind } from '../types.js';

export const INSURANCE_AUTO_EN_US: DomainVocabulary = {
  id: 'insurance.auto',
  name: 'Auto Insurance',
  locale: 'en-US',
  version: '1.0.0',

  metadata: {
    author: 'Aster Team',
    createdAt: '2025-01-06',
    description: 'Auto insurance domain identifier mappings for English',
  },

  structs: [
    {
      canonical: 'Driver',
      localized: 'Driver',
      kind: IdentifierKind.STRUCT,
    },
    {
      canonical: 'Vehicle',
      localized: 'Vehicle',
      kind: IdentifierKind.STRUCT,
      aliases: ['Car', 'Automobile'],
    },
    {
      canonical: 'QuoteResult',
      localized: 'QuoteResult',
      kind: IdentifierKind.STRUCT,
      aliases: ['Quote'],
    },
    {
      canonical: 'Claim',
      localized: 'Claim',
      kind: IdentifierKind.STRUCT,
    },
    {
      canonical: 'Policy',
      localized: 'Policy',
      kind: IdentifierKind.STRUCT,
      aliases: ['InsurancePolicy'],
    },
    {
      canonical: 'Coverage',
      localized: 'Coverage',
      kind: IdentifierKind.STRUCT,
    },
  ],

  fields: [
    {
      canonical: 'age',
      localized: 'age',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
    },
    {
      canonical: 'drivingYears',
      localized: 'drivingYears',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      aliases: ['yearsOfDriving'],
    },
    {
      canonical: 'accidents',
      localized: 'accidents',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      aliases: ['accidentCount'],
    },
    {
      canonical: 'licenseType',
      localized: 'licenseType',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
    },
    {
      canonical: 'name',
      localized: 'name',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
    },
    {
      canonical: 'plateNo',
      localized: 'plateNo',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      aliases: ['licensePlate', 'plateNumber'],
    },
    {
      canonical: 'brand',
      localized: 'brand',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      aliases: ['make'],
    },
    {
      canonical: 'model',
      localized: 'model',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
    },
    {
      canonical: 'year',
      localized: 'year',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      aliases: ['modelYear'],
    },
    {
      canonical: 'safetyRating',
      localized: 'safetyRating',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
    },
    {
      canonical: 'mileage',
      localized: 'mileage',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
    },
    {
      canonical: 'engineType',
      localized: 'engineType',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
    },
    {
      canonical: 'approved',
      localized: 'approved',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'reason',
      localized: 'reason',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'monthlyPremium',
      localized: 'monthlyPremium',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'annualPremium',
      localized: 'annualPremium',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'deductible',
      localized: 'deductible',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'coverageAmount',
      localized: 'coverageAmount',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'policyNumber',
      localized: 'policyNumber',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
    },
    {
      canonical: 'startDate',
      localized: 'startDate',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
      aliases: ['effectiveDate'],
    },
    {
      canonical: 'endDate',
      localized: 'endDate',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
      aliases: ['expirationDate'],
    },
    {
      canonical: 'status',
      localized: 'status',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
    },
  ],

  functions: [
    {
      canonical: 'generateQuote',
      localized: 'generateQuote',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculatePremium',
      localized: 'calculatePremium',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculateAgeFactor',
      localized: 'calculateAgeFactor',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculateDrivingYearsFactor',
      localized: 'calculateDrivingYearsFactor',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'assessRisk',
      localized: 'assessRisk',
      kind: IdentifierKind.FUNCTION,
      aliases: ['evaluateRisk'],
    },
    {
      canonical: 'validateDriver',
      localized: 'validateDriver',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'validateVehicle',
      localized: 'validateVehicle',
      kind: IdentifierKind.FUNCTION,
    },
  ],

  enumValues: [
    {
      canonical: 'Approved',
      localized: 'Approved',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'Rejected',
      localized: 'Rejected',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['Denied'],
    },
    {
      canonical: 'Pending',
      localized: 'Pending',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'HighRisk',
      localized: 'HighRisk',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'MediumRisk',
      localized: 'MediumRisk',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'LowRisk',
      localized: 'LowRisk',
      kind: IdentifierKind.ENUM_VALUE,
    },
  ],
};
