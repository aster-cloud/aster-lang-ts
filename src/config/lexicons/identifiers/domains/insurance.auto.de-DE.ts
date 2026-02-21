// @generated — 由 scripts/generate-vocabularies.ts 自动生成，请勿手动修改

import { type DomainVocabulary, IdentifierKind } from '../types.js';

export const INSURANCE_AUTO_DE_DE: DomainVocabulary = {
  id: 'insurance.auto',
  name: 'Kfz-Versicherung',
  locale: 'de-DE',
  version: '1.0.0',

  metadata: {
    author: 'Aster Team',
    createdAt: '2025-01-06',
    description: 'Kfz-Versicherung Fachbegriffe auf Deutsch',
  },

  structs: [
    {
      canonical: 'Driver',
      localized: 'Fahrer',
      kind: IdentifierKind.STRUCT,
      aliases: ['Fahrzeugfuehrer'],
    },
    {
      canonical: 'Vehicle',
      localized: 'Fahrzeug',
      kind: IdentifierKind.STRUCT,
      aliases: ['Kfz', 'Auto'],
    },
    {
      canonical: 'QuoteResult',
      localized: 'Angebotsergebnis',
      kind: IdentifierKind.STRUCT,
      aliases: ['Angebot'],
    },
    {
      canonical: 'Claim',
      localized: 'Schadensfall',
      kind: IdentifierKind.STRUCT,
      aliases: ['Schadensmeldung'],
    },
    {
      canonical: 'Policy',
      localized: 'Versicherungspolice',
      kind: IdentifierKind.STRUCT,
      aliases: ['Police'],
    },
    {
      canonical: 'Coverage',
      localized: 'Deckungsumfang',
      kind: IdentifierKind.STRUCT,
      aliases: ['Versicherungsschutz'],
    },
  ],

  fields: [
    {
      canonical: 'age',
      localized: 'Alter',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
    },
    {
      canonical: 'drivingYears',
      localized: 'Fahrjahre',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      aliases: ['Fahrerfahrung'],
    },
    {
      canonical: 'accidents',
      localized: 'Unfaelle',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
      aliases: ['Unfallzahl'],
    },
    {
      canonical: 'licenseType',
      localized: 'Fuehrerscheinklasse',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
    },
    {
      canonical: 'name',
      localized: 'Name',
      kind: IdentifierKind.FIELD,
      parent: 'Driver',
    },
    {
      canonical: 'plateNo',
      localized: 'Kennzeichen',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      aliases: ['Nummernschild'],
    },
    {
      canonical: 'brand',
      localized: 'Marke',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      aliases: ['Hersteller'],
    },
    {
      canonical: 'model',
      localized: 'Modell',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
    },
    {
      canonical: 'year',
      localized: 'Baujahr',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
    },
    {
      canonical: 'safetyRating',
      localized: 'Sicherheitsbewertung',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
    },
    {
      canonical: 'mileage',
      localized: 'Kilometerstand',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      aliases: ['Laufleistung'],
    },
    {
      canonical: 'engineType',
      localized: 'Motortyp',
      kind: IdentifierKind.FIELD,
      parent: 'Vehicle',
      aliases: ['Antriebsart'],
    },
    {
      canonical: 'approved',
      localized: 'genehmigt',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'reason',
      localized: 'Grund',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      aliases: ['Begruendung'],
    },
    {
      canonical: 'monthlyPremium',
      localized: 'Monatsbeitrag',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      aliases: ['Monatspraemie'],
    },
    {
      canonical: 'annualPremium',
      localized: 'Jahresbeitrag',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      aliases: ['Jahrespraemie'],
    },
    {
      canonical: 'deductible',
      localized: 'Selbstbeteiligung',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
    },
    {
      canonical: 'coverageAmount',
      localized: 'Deckungssumme',
      kind: IdentifierKind.FIELD,
      parent: 'QuoteResult',
      aliases: ['Versicherungssumme'],
    },
    {
      canonical: 'policyNumber',
      localized: 'Policennummer',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
      aliases: ['Versicherungsnummer'],
    },
    {
      canonical: 'startDate',
      localized: 'Vertragsbeginn',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
      aliases: ['Startdatum'],
    },
    {
      canonical: 'endDate',
      localized: 'Vertragsende',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
      aliases: ['Ablaufdatum'],
    },
    {
      canonical: 'status',
      localized: 'Status',
      kind: IdentifierKind.FIELD,
      parent: 'Policy',
      aliases: ['Vertragsstatus'],
    },
  ],

  functions: [
    {
      canonical: 'generateQuote',
      localized: 'Angebot erstellen',
      kind: IdentifierKind.FUNCTION,
      aliases: ['Angebot berechnen'],
    },
    {
      canonical: 'calculatePremium',
      localized: 'Praemie berechnen',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculateAgeFactor',
      localized: 'Altersfaktor berechnen',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'calculateDrivingYearsFactor',
      localized: 'Erfahrungsfaktor berechnen',
      kind: IdentifierKind.FUNCTION,
    },
    {
      canonical: 'assessRisk',
      localized: 'Risiko bewerten',
      kind: IdentifierKind.FUNCTION,
      aliases: ['Risikobewertung'],
    },
    {
      canonical: 'validateDriver',
      localized: 'Fahrer pruefen',
      kind: IdentifierKind.FUNCTION,
      aliases: ['Fahrerpruefung'],
    },
    {
      canonical: 'validateVehicle',
      localized: 'Fahrzeug pruefen',
      kind: IdentifierKind.FUNCTION,
      aliases: ['Fahrzeugpruefung'],
    },
  ],

  enumValues: [
    {
      canonical: 'Approved',
      localized: 'Genehmigt',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['Bewilligt'],
    },
    {
      canonical: 'Rejected',
      localized: 'Abgelehnt',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'Pending',
      localized: 'Ausstehend',
      kind: IdentifierKind.ENUM_VALUE,
      aliases: ['In Bearbeitung'],
    },
    {
      canonical: 'HighRisk',
      localized: 'Hohes Risiko',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'MediumRisk',
      localized: 'Mittleres Risiko',
      kind: IdentifierKind.ENUM_VALUE,
    },
    {
      canonical: 'LowRisk',
      localized: 'Niedriges Risiko',
      kind: IdentifierKind.ENUM_VALUE,
    },
  ],
};
