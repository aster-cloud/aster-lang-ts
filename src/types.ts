// Core type definitions for Aster CNL

import { Effect as EffectEnum } from './config/semantic.js';
import type { ErrorCode } from './diagnostics/error_codes.js';
import type * as Base from './types/base.js';

export interface Position {
  readonly line: number;
  readonly col: number;
}

export interface Span {
  readonly start: Position;
  readonly end: Position;
}

// Optional file-backed origin info; used for IR provenance and logs
export interface Origin {
  readonly file?: string;
  readonly start: Position;
  readonly end: Position;
}

/**
 * AST 节点的基础元数据接口
 *
 * 用于为 AST 节点附加位置、来源等元数据信息，消除 `(x as any).span = ...` 模式。
 */
export interface AstMetadata {
  /** 源代码位置信息（可选，由 parser 附加） */
  span?: Span;
  /** 来源文件信息（可选，由 lower_to_core 附加） */
  origin?: Origin;
  /** 文件路径（可选） */
  file?: string | null;
}

/**
 * 带有效应能力标注的 AST 节点接口
 *
 * 用于在语法分析阶段附加效应能力信息（如 `[files, secrets]`），
 * 支持细粒度的效应跟踪和验证。
 */
export interface EffectCapable {
  /** 效应能力列表（无副作用时为空列表） */
  effectCaps: EffectCaps;
  /** 效应能力是否显式声明（区分隐式推导和显式标注） */
  effectCapsExplicit: boolean;
}

/**
 * 能力类型枚举
 *
 * 定义系统支持的所有效应能力类型。
 */
export type CapabilityKind = import('./config/semantic.js').CapabilityKind;

/** Effect capability 列表的统一别名 */
export type EffectCaps = readonly CapabilityKind[];

export interface Token {
  readonly kind: TokenKind;
  readonly value: string | number | boolean | null | CommentValue;
  readonly start: Position;
  readonly end: Position;
  readonly channel?: 'trivia';
}

export enum TokenKind {
  EOF = 'EOF',
  NEWLINE = 'NEWLINE',
  INDENT = 'INDENT',
  DEDENT = 'DEDENT',
  DOT = 'DOT',
  COLON = 'COLON',
  COMMA = 'COMMA',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  EQUALS = 'EQUALS',
  PLUS = 'PLUS',
  STAR = 'STAR',
  MINUS = 'MINUS',
  SLASH = 'SLASH',
  LT = 'LT',
  GT = 'GT',
  LTE = 'LTE',
  GTE = 'GTE',
  NEQ = 'NEQ',
  QUESTION = 'QUESTION',
  AT = 'AT',
  IDENT = 'IDENT',
  TYPE_IDENT = 'TYPE_IDENT',
  STRING = 'STRING',
  INT = 'INT',
  FLOAT = 'FLOAT',
  LONG = 'LONG',
  BOOL = 'BOOL',
  NULL = 'NULL',
  KEYWORD = 'KEYWORD',
  COMMENT = 'COMMENT',
}

/**
 * 注释 Token 的取值结构
 *
 * 保存原始文本、整理后的主体文本以及注释分类，使词法分析阶段的注释处理更加可控。
 */
export interface CommentValue {
  readonly raw: string;
  readonly text: string;
  readonly trivia: 'inline' | 'standalone';
}

/**
 * 判断指定 Token 是否为注释 Token，便于在遍历过程中筛选注释。
 */
export function isCommentToken(token: Token): token is Token & {
  readonly kind: TokenKind.COMMENT;
  readonly value: CommentValue;
} {
  return token.kind === TokenKind.COMMENT;
}

// Effect 枚举现在从 config/semantic.ts 导出，保持类型定义集中
export { Effect } from './config/semantic.js';

export interface TypecheckDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: ErrorCode;
  message: string;
  span?: Span;
  origin?: Origin;
  help?: string;
  data?: unknown;
  source?: 'aster-typecheck' | 'aster-pii'; // 诊断来源标识（P1-3 Task 6）
}

// CNL AST types
export type AstNode = Base.BaseNode<Span>;

export interface Module extends Base.BaseModule<Span, Declaration> {
  span: Span;
}

export interface Import extends Base.BaseImport<Span> {
  span: Span;
}

export interface Data extends Base.BaseData<Span, Type> {
  readonly fields: readonly Field[];
  span: Span;
}

// ============================================================
// CNL 约束类型
// ============================================================

/**
 * 必填约束 - 对应 CNL 语法 "required"
 */
export interface ConstraintRequired {
  readonly kind: 'Required';
  readonly span: Span;
}

/**
 * 范围约束 - 对应 CNL 语法 "between X and Y", "at least X", "at most Y"
 */
export interface ConstraintRange {
  readonly kind: 'Range';
  readonly min?: number;
  readonly max?: number;
  readonly span: Span;
}

/**
 * 模式约束 - 对应 CNL 语法 "matching pattern '...'" 或 "matching '...'"
 */
export interface ConstraintPattern {
  readonly kind: 'Pattern';
  readonly regexp: string;
  readonly span: Span;
}

/**
 * CNL 约束联合类型
 */
export type Constraint = ConstraintRequired | ConstraintRange | ConstraintPattern;

export interface Field extends Base.BaseField<Type> {
  /** CNL 约束列表 */
  readonly constraints?: readonly Constraint[];
  /** 标记类型是否为推断得出（用于诊断和文档生成） */
  readonly typeInferred?: boolean;
  span: Span;
}

export interface Enum extends Base.BaseEnum<Span> {
  span: Span;
}

export interface Func extends Base.BaseFunc<Span, readonly string[], Type> {
  readonly retType: Type;
  /** 标记返回类型是否为推断得出（用于诊断和文档生成） */
  readonly retTypeInferred?: boolean;
  readonly body: Block | null;
  readonly params: readonly Parameter[];
  readonly effectParams?: readonly string[];
  span: Span;
}

export interface Parameter extends Base.BaseParameter<Type> {
  /** CNL 约束列表 */
  readonly constraints?: readonly Constraint[];
  /** 标记类型是否为推断得出（用于诊断和文档生成） */
  readonly typeInferred?: boolean;
  span: Span;
}

export interface Block extends Base.BaseBlock<Span, Statement> {
  span: Span;
}

export type Declaration = Import | Data | Enum | Func;

export type Statement =
  | Let
  | Set
  | Return
  | If
  | Match
  | Start
  | Wait
  | WorkflowStmt
  | Expression
  | Block;

export interface Let extends Base.BaseLet<Span, Expression> {
  span: Span;
  readonly nameSpan?: Span;
}

export interface Set extends Base.BaseSet<Span, Expression> {
  span: Span;
}

export interface Return extends Base.BaseReturn<Span, Expression> {
  span: Span;
}

export interface If extends Base.BaseIf<Span, Expression, Block> {
  span: Span;
}

export interface Match extends Base.BaseMatch<Span, Expression, Case> {
  span: Span;
}

export interface Case extends Base.BaseCase<Span, Pattern, Return | Block> {
  span: Span;
}

export interface Start extends Base.BaseStart<Span, Expression> {
  span: Span;
}

export interface Wait extends Base.BaseWait<Span> {
  span: Span;
}

export interface WorkflowStmt
  extends Base.BaseWorkflow<Span, StepStmt, RetryPolicy, Timeout> {
  span: Span;
}

export interface StepStmt extends Base.BaseStep<Span, Block> {
  span: Span;
}

export interface RetryPolicy extends Base.BaseRetryPolicy {}

export interface Timeout extends Base.BaseTimeout {}

export type Pattern = PatternNull | PatternCtor | PatternName | PatternInt;

export interface PatternNull extends Base.BasePatternNull<Span> {
  span: Span;
}

export interface PatternCtor extends Base.BasePatternCtor<Span, Pattern> {
  span: Span;
}

export interface PatternName extends Base.BasePatternName<Span> {
  span: Span;
}

export interface PatternInt extends Base.BasePatternInt<Span> {
  span: Span;
}

export type Expression =
  | Name
  | Bool
  | Int
  | Long
  | Double
  | String
  | Null
  | Call
  | Construct
  | Ok
  | Err
  | Some
  | None
  | Lambda
  | Await;

export interface Await extends Base.BaseAwait<Span, Expression> {
  span: Span;
}

export interface Name extends Base.BaseName<Span> {
  span: Span;
}

export interface Bool extends Base.BaseBool<Span> {
  span: Span;
}

export interface Int extends Base.BaseInt<Span> {
  span: Span;
}

export interface Long extends Base.BaseLong<Span> {
  span: Span;
}

export interface Double extends Base.BaseDouble<Span> {
  span: Span;
}

export interface String extends Base.BaseString<Span> {
  span: Span;
}

export interface Null extends Base.BaseNull<Span> {
  span: Span;
}

export interface Call extends Base.BaseCall<Span, Expression> {
  span: Span;
}

export interface Lambda extends Base.BaseLambda<Span, Type, Block> {
  readonly retType: Type;
  span: Span;
}

export interface Construct extends Base.BaseConstruct<Span, ConstructField> {
  span: Span;
}

export interface ConstructField extends Base.BaseConstructField<Expression> {
  span: Span;
}

export interface Ok extends Base.BaseOk<Span, Expression> {
  span: Span;
}

export interface Err extends Base.BaseErr<Span, Expression> {
  span: Span;
}

export interface Some extends Base.BaseSome<Span, Expression> {
  span: Span;
}

export interface None extends Base.BaseNone<Span> {
  span: Span;
}

export type Type =
  | TypeName
  | Maybe
  | Option
  | Result
  | List
  | Map
  | TypeApp
  | TypeVar
  | EffectVar
  | FuncType
  | TypePii;

/**
 * PII 敏感级别
 * - L1: 低敏感（如公开的邮箱地址）
 * - L2: 中敏感（如电话号码、地址）
 * - L3: 高敏感（如SSN、金融账户、健康数据）
 */
export type PiiSensitivityLevel = 'L1' | 'L2' | 'L3';

/**
 * PII 数据类别
 */
export type PiiDataCategory =
  | 'email'      // 电子邮件地址
  | 'phone'      // 电话号码
  | 'ssn'        // 社会安全号码
  | 'address'    // 物理地址
  | 'financial'  // 金融信息（银行账户、信用卡等）
  | 'health'     // 健康医疗数据
  | 'name'       // 姓名
  | 'biometric'; // 生物识别信息（指纹、面部识别等）

export const PII_LEVELS = ['L1', 'L2', 'L3'] as const;
export type PiiLevel = (typeof PII_LEVELS)[number];

export interface PiiMeta {
  readonly level: PiiLevel;
  readonly categories: readonly string[];
  readonly sourceSpan?: Span | undefined;
}

/**
 * PII 类型标注（AST 层）
 * 语法：@pii(L2, email) Text
 */
export interface TypePii extends AstNode {
  readonly kind: 'TypePii';
  readonly baseType: Type;
  readonly sensitivity: PiiSensitivityLevel;
  readonly category: PiiDataCategory;
  span: Span;
}

export interface TypeName extends Base.BaseTypeName<Span> {
  span: Span;
}

export interface TypeVar extends Base.BaseTypeVar<Span> {
  span: Span;
}

export interface EffectVar extends AstNode {
  readonly kind: 'EffectVar';
  readonly name: string;
  span: Span;
}

export interface TypeApp extends Base.BaseTypeApp<Span, Type> {
  span: Span;
}

export interface Maybe extends Base.BaseMaybe<Span, Type> {
  span: Span;
}

export interface Option extends Base.BaseOption<Span, Type> {
  span: Span;
}

export interface Result extends Base.BaseResult<Span, Type> {
  span: Span;
}

export interface List extends Base.BaseList<Span, Type> {
  span: Span;
}

export interface Map extends Base.BaseMap<Span, Type> {
  span: Span;
}

export interface FuncType extends Base.BaseFuncType<Span, Type> {
  readonly effectParams?: readonly EffectVar[];
  readonly declaredEffects?: readonly (EffectEnum | EffectVar)[];
  span: Span;
}

// Core IR types (distinct from CNL AST)
export namespace Core {
  export type CoreNode = Base.BaseNode<Origin>;

  export interface Module extends Base.BaseModule<Origin, Declaration> {}

  export interface Import extends Base.BaseImport<Origin> {}

  export interface Data extends Base.BaseData<Origin, Type> {
    readonly fields: readonly Field[];
  }

  // Core IR 约束类型
  export interface ConstraintRequired {
    readonly kind: 'Required';
  }

  export interface ConstraintRange {
    readonly kind: 'Range';
    readonly min?: number;
    readonly max?: number;
  }

  export interface ConstraintPattern {
    readonly kind: 'Pattern';
    readonly regexp: string;
  }

  export type Constraint = ConstraintRequired | ConstraintRange | ConstraintPattern;

  export interface Field extends Base.BaseField<Type> {
    /** CNL 约束列表 */
    readonly constraints?: readonly Constraint[];
  }

  export interface Enum extends Base.BaseEnum<Origin> {}

  export interface Func extends Base.BaseFunc<Origin, readonly EffectEnum[], Type> {
    readonly ret: Type;
    readonly effects: readonly EffectEnum[];
    readonly body: Block;
    readonly params: readonly Parameter[];
    readonly effectParams?: readonly string[];
    readonly declaredEffects?: readonly (EffectEnum | EffectVar)[];
    /** 标记返回类型是否为推断得出（用于诊断和文档生成） */
    readonly retTypeInferred?: boolean;
    readonly piiLevel?: PiiSensitivityLevel;
    readonly piiCategories?: readonly string[];
  }

  export interface Parameter extends Base.BaseParameter<Type> {
    /** CNL 约束列表 */
    readonly constraints?: readonly Constraint[];
    /** 标记类型是否为推断得出（用于诊断和文档生成） */
    readonly typeInferred?: boolean;
  }

  export interface Block extends Base.BaseBlock<Origin, Statement> {}

  export type Declaration = Import | Data | Enum | Func;

  export interface Start extends Base.BaseStart<Origin, Expression> {}

  export interface Wait extends Base.BaseWait<Origin> {}

  export interface Scope extends Base.BaseScope<Origin, Statement> {}

  export interface Workflow
    extends Base.BaseWorkflow<Origin, Step, RetryPolicy, Timeout> {
    readonly effectCaps: EffectCaps;
  }

  export interface Step extends Base.BaseStep<Origin, Block> {
    readonly effectCaps: EffectCaps;
  }

  export interface RetryPolicy extends Base.BaseRetryPolicy {}

  export interface Timeout extends Base.BaseTimeout {}

  export type Statement =
    | Let
    | Set
    | Return
    | If
    | Match
    | Scope
    | Start
    | Wait
    | Workflow;

  export interface Let extends Base.BaseLet<Origin, Expression> {}

  export interface Set extends Base.BaseSet<Origin, Expression> {}

  export interface Return extends Base.BaseReturn<Origin, Expression> {}

  export interface If extends Base.BaseIf<Origin, Expression, Block> {}

  export interface Match extends Base.BaseMatch<Origin, Expression, Case> {}

  export interface Case extends Base.BaseCase<Origin, Pattern, Return | Block> {}

  export type Pattern = PatNull | PatCtor | PatName | PatInt;

  export interface PatNull extends Base.BasePatternNull<Origin> {}

  export interface PatCtor extends Base.BasePatternCtor<Origin, Pattern> {}

  export interface PatName extends Base.BasePatternName<Origin> {}

  export interface PatInt extends Base.BasePatternInt<Origin> {}

  export type Expression =
    | Name
    | Bool
    | Int
    | Long
    | Double
    | String
    | Null
    | Call
    | Construct
    | Ok
    | Err
    | Some
    | None
    | Lambda
    | Await;

  export interface Name extends Base.BaseName<Origin> {}

  export interface Bool extends Base.BaseBool<Origin> {}

  export interface Int extends Base.BaseInt<Origin> {}

  export interface Long extends Base.BaseLong<Origin> {}

  export interface Double extends Base.BaseDouble<Origin> {}

  export interface String extends Base.BaseString<Origin> {}

  export interface Null extends Base.BaseNull<Origin> {}

  export interface Call extends Base.BaseCall<Origin, Expression> {}

  export interface Lambda extends Base.BaseLambda<Origin, Type, Block> {
    readonly ret: Type;
    readonly captures?: readonly string[];
  }

  export interface Construct extends Base.BaseConstruct<Origin, ConstructField> {}

  export interface ConstructField extends Base.BaseConstructField<Expression> {}

  export interface Ok extends Base.BaseOk<Origin, Expression> {}

  export interface Err extends Base.BaseErr<Origin, Expression> {}

  export interface Some extends Base.BaseSome<Origin, Expression> {}

  export interface None extends Base.BaseNone<Origin> {}

  export interface Await extends Base.BaseAwait<Origin, Expression> {}

  // Extended with generics (preview)
  export type Type =
    | TypeName
    | Maybe
    | Option
    | Result
    | List
    | Map
    | TypeApp
    | TypeVar
    | EffectVar
    | FuncType
    | PiiType;

  /**
   * PII 类型（Core IR 层）
   * 用于运行时 PII 数据流跟踪和污点分析
   */
  export interface PiiType extends CoreNode {
    readonly kind: 'PiiType';
    readonly baseType: Type;
    readonly sensitivity: PiiSensitivityLevel;
    readonly category: PiiDataCategory;
  }

  export interface TypeName extends Base.BaseTypeName<Origin> {}

  export interface TypeVar extends Base.BaseTypeVar<Origin> {}

  export interface EffectVar extends CoreNode {
    readonly kind: 'EffectVar';
    readonly name: string;
  }

  export interface TypeApp extends Base.BaseTypeApp<Origin, Type> {}

  export interface Maybe extends Base.BaseMaybe<Origin, Type> {}

  export interface Option extends Base.BaseOption<Origin, Type> {}

  export interface Result extends Base.BaseResult<Origin, Type> {}

  export interface List extends Base.BaseList<Origin, Type> {}

  export interface Map extends Base.BaseMap<Origin, Type> {}

  export interface FuncType extends Base.BaseFuncType<Origin, Type> {
    readonly effectParams?: readonly string[];
    readonly declaredEffects?: readonly (EffectEnum | string)[];
  }
}
