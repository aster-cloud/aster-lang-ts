// Structured diagnostics with error codes, spans, and fix-its

import type { Position, Span } from '../types.js';

export enum DiagnosticSeverity {
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
  Hint = 'hint',
}

export enum DiagnosticCode {
  // Lexer errors (L001-L099)
  L001_UnexpectedCharacter = 'L001',
  L002_UnterminatedString = 'L002',
  L003_InvalidIndentation = 'L003',
  L004_InconsistentDedent = 'L004',

  // Lowering errors (L101-L199)
  L101_UnknownDeclKind = 'L101',
  L102_UnknownEffect = 'L102',
  L103_UnknownStmtKind = 'L103',
  L104_UnknownExprKind = 'L104',
  L105_UnknownPatternKind = 'L105',
  L106_UnknownTypeKind = 'L106',

  // Parser errors (P001-P199)
  P001_ExpectedIdentifier = 'P001',
  P002_ExpectedTypeIdentifier = 'P002',
  P003_ExpectedToken = 'P003',
  P004_ExpectedKeyword = 'P004',
  P005_UnexpectedToken = 'P005',
  P006_ExpectedPunctuation = 'P006',
  P007_ExpectedExpression = 'P007',
  P008_ExpectedType = 'P008',
  P009_ExpectedPattern = 'P009',
  P010_ExpectedIndent = 'P010',
  P011_ExpectedDedent = 'P011',
  P012_IncompleteConstruction = 'P012',
  P013_MissingFunctionBody = 'P013',
  P014_InvalidEffectClause = 'P014',

  // Semantic errors (S001-S199)
  S001_UndefinedVariable = 'S001',
  S002_TypeMismatch = 'S002',
  S003_DuplicateDefinition = 'S003',
  S004_UnreachableCode = 'S004',
  S005_MissingReturn = 'S005',
  S006_NonExhaustiveMatch = 'S006',
  S007_InvalidEffectUsage = 'S007',

  // Style warnings (W001-W099)
  W001_UnusedVariable = 'W001',
  W002_PreferredSyntax = 'W002',
  W003_RedundantCode = 'W003',

  // Manifest/Package errors (M001-M099)
  M001_ManifestParseError = 'M001',
  M002_ManifestFileNotFound = 'M002',
  M003_InvalidPackageName = 'M003',
  M004_InvalidVersion = 'M004',
  M005_InvalidVersionConstraint = 'M005',
  M006_InvalidEffectName = 'M006',
  M007_UnknownManifestField = 'M007',
  M008_InvalidCapability = 'M008',

  // Package Registry errors (R001-R099)
  R001_NetworkError = 'R001',
  R002_RateLimitExceeded = 'R002',
  R003_PackageNotFoundOnGitHub = 'R003',
  R004_DownloadFailed = 'R004',
  R005_InvalidReleaseFormat = 'R005',
  R006_AuthenticationFailed = 'R006',
  R007_InvalidResponse = 'R007',

  // Package Cache errors (C001-C099)
  C001_CacheCorrupted = 'C001',
  C002_ExtractionFailed = 'C002',
  C003_DiskSpaceInsufficient = 'C003',
  C004_ManifestMissing = 'C004',
  C005_CacheExpired = 'C005',
  C006_InvalidCacheMetadata = 'C006',
  C007_CacheWriteFailed = 'C007',

  // Version resolver errors (V001-V099)
  V001_DependencyResolutionTimeout = 'V001',
  V002_VersionConflictUnresolvable = 'V002',
  V003_PackageNotFound = 'V003',

  // Deprecated - use V001-V003 instead
  /** @deprecated Use V001_DependencyResolutionTimeout */
  DEPENDENCY_RESOLUTION_TIMEOUT = 'V001',
  /** @deprecated Use V002_VersionConflictUnresolvable */
  VERSION_CONFLICT_UNRESOLVABLE = 'V002',
  /** @deprecated Use V003_PackageNotFound */
  PACKAGE_NOT_FOUND = 'V003',
}

export interface FixIt {
  readonly description: string;
  readonly span: Span;
  readonly replacement: string;
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly span: Span;
  readonly fixIts?: readonly FixIt[];
  readonly relatedInformation?: readonly {
    readonly span: Span;
    readonly message: string;
  }[];
}

export class DiagnosticError extends Error {
  public readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
    this.name = 'DiagnosticError';
  }

  // For backward compatibility with existing error handling
  get pos(): Position {
    return this.diagnostic.span.start;
  }
}

export class DiagnosticBuilder {
  private severity: DiagnosticSeverity = DiagnosticSeverity.Error;
  private code?: DiagnosticCode;
  private message?: string;
  private span?: Span;
  private fixIts: FixIt[] = [];
  private relatedInformation: Array<{ span: Span; message: string }> = [];

  static error(code: DiagnosticCode): DiagnosticBuilder {
    return new DiagnosticBuilder().withSeverity(DiagnosticSeverity.Error).withCode(code);
  }

  static warning(code: DiagnosticCode): DiagnosticBuilder {
    return new DiagnosticBuilder().withSeverity(DiagnosticSeverity.Warning).withCode(code);
  }

  static info(code: DiagnosticCode): DiagnosticBuilder {
    return new DiagnosticBuilder().withSeverity(DiagnosticSeverity.Info).withCode(code);
  }

  withSeverity(severity: DiagnosticSeverity): DiagnosticBuilder {
    this.severity = severity;
    return this;
  }

  withCode(code: DiagnosticCode): DiagnosticBuilder {
    this.code = code;
    return this;
  }

  withMessage(message: string): DiagnosticBuilder {
    this.message = message;
    return this;
  }

  withSpan(span: Span): DiagnosticBuilder {
    this.span = span;
    return this;
  }

  withPosition(pos: Position): DiagnosticBuilder {
    this.span = { start: pos, end: pos };
    return this;
  }

  withFixIt(description: string, span: Span, replacement: string): DiagnosticBuilder {
    this.fixIts.push({ description, span, replacement });
    return this;
  }

  withRelated(span: Span, message: string): DiagnosticBuilder {
    this.relatedInformation.push({ span, message });
    return this;
  }

  build(): Diagnostic {
    if (!this.code) throw new Error('Diagnostic code is required');
    if (!this.message) throw new Error('Diagnostic message is required');
    if (!this.span) throw new Error('Diagnostic span is required');

    const diagnostic: Diagnostic = {
      severity: this.severity,
      code: this.code,
      message: this.message,
      span: this.span,
    };

    if (this.fixIts.length > 0) {
      (diagnostic as { fixIts?: readonly FixIt[] }).fixIts = this.fixIts as readonly FixIt[];
    }

    if (this.relatedInformation.length > 0) {
      (
        diagnostic as {
          relatedInformation?: ReadonlyArray<{ span: Span; message: string }>;
        }
      ).relatedInformation = this.relatedInformation as ReadonlyArray<{
        span: Span;
        message: string;
      }>;
    }

    return diagnostic;
  }

  throw(): never {
    throw new DiagnosticError(this.build());
  }
}

// Common diagnostic patterns
export const Diagnostics = {
  expectedIdentifier: (pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.P001_ExpectedIdentifier)
      .withMessage('Expected identifier')
      .withPosition(pos),

  expectedToken: (expected: string, actual: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.P003_ExpectedToken)
      .withMessage(`Expected '${expected}', got '${actual}'`)
      .withPosition(pos),

  expectedKeyword: (keyword: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.P004_ExpectedKeyword)
      .withMessage(`Expected keyword '${keyword}'`)
      .withPosition(pos),

  unexpectedToken: (token: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.P005_UnexpectedToken)
      .withMessage(`Unexpected token '${token}'`)
      .withPosition(pos),

  expectedPunctuation: (
    punct: string,
    pos: Position,
    fixIt?: { span: Span; replacement: string }
  ): DiagnosticBuilder => {
    const builder = DiagnosticBuilder.error(DiagnosticCode.P006_ExpectedPunctuation)
      .withMessage(`Expected '${punct}'`)
      .withPosition(pos);

    if (fixIt) {
      builder.withFixIt(`Add '${punct}'`, fixIt.span, fixIt.replacement);
    }

    return builder;
  },

  unterminatedString: (pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L002_UnterminatedString)
      .withMessage('Unterminated string literal')
      .withPosition(pos),

  invalidIndentation: (pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L003_InvalidIndentation)
      .withMessage('Indentation must be multiples of 2 spaces')
      .withPosition(pos)
      .withFixIt('Use 2-space indentation', { start: pos, end: pos }, '  '),

  inconsistentDedent: (pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L004_InconsistentDedent)
      .withMessage('Inconsistent dedent level')
      .withPosition(pos),

  unexpectedCharacter: (char: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L001_UnexpectedCharacter)
      .withMessage(`Unexpected character '${char}'`)
      .withPosition(pos),

  // Lowering errors
  unknownDeclKind: (kind: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L101_UnknownDeclKind)
      .withMessage(`Unknown declaration kind: ${kind}`)
      .withPosition(pos),

  unknownEffect: (effect: string, validEffects: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L102_UnknownEffect)
      .withMessage(`Unknown effect '${effect}', valid values: ${validEffects}`)
      .withPosition(pos),

  unknownStmtKind: (kind: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L103_UnknownStmtKind)
      .withMessage(`lowerStmt: unhandled statement kind '${kind}'`)
      .withPosition(pos),

  unknownExprKind: (kind: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L104_UnknownExprKind)
      .withMessage(`Unknown expression kind: ${kind}`)
      .withPosition(pos),

  unknownPatternKind: (kind: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L105_UnknownPatternKind)
      .withMessage(`Unknown pattern kind: ${kind}`)
      .withPosition(pos),

  unknownTypeKind: (kind: string, pos: Position): DiagnosticBuilder =>
    DiagnosticBuilder.error(DiagnosticCode.L106_UnknownTypeKind)
      .withMessage(`Unknown type kind: ${kind}`)
      .withPosition(pos),
};

// Utility to format diagnostics for display
export function formatDiagnostic(diagnostic: Diagnostic, source?: string): string {
  const { severity, code, message, span } = diagnostic;
  const pos = `${span.start.line}:${span.start.col}`;

  let result = `${severity} ${code}: ${message} at ${pos}`;

  if (source && diagnostic.fixIts && diagnostic.fixIts.length > 0) {
    result += '\n\nSuggested fixes:';
    for (const fixIt of diagnostic.fixIts) {
      result += `\n  - ${fixIt.description}: "${fixIt.replacement}"`;
    }
  }

  if (source) {
    const lines = source.split(/\r?\n/);
    const line = lines[span.start.line - 1];
    if (line) {
      result += `\n> ${span.start.line}| ${line}`;
      result += `\n> ${' '.repeat(String(span.start.line).length)}  ${' '.repeat(span.start.col - 1)}^`;
    }
  }

  return result;
}

// Utility to create a dummy position for diagnostics without source location
export function dummyPosition(): Position {
  return { line: 1, col: 1 };
}
