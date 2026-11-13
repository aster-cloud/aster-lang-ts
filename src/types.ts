// Core type definitions for Aster CNL

import { Effect as EffectEnum } from './config/semantic.js';
import type { ErrorCode } from './diagnostics/error_codes.js';
import type * as Base from './types/base.js';
import type * as V2 from './core/core-ir-v2.generated.js';

export interface Position {
  readonly line: number;
  readonly col: number;
}

export interface Span {
  readonly start: Position;
  readonly end: Position;
}

// Optional file-backed origin info; used for IR provenance and logs
// Core IR v2 的 origin（Core.Origin）三个可空字段恒输出为 null；它可以赋给这里的宽松形态。
export interface Origin {
  readonly file?: string | null;
  readonly start: Position;
  readonly end: Position;
  /** ADR 0051：源码原写法，仅在与规范名不同时写入 */
  readonly written?: string | null;
  /** ADR 0051：该写法按哪种角色解析，与 written 同时出现 */
  readonly role?: ResolvedRole | null;
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

/** 注解参数值（ADR 0055 #3）：字符串、Int32 整数或布尔；浮点、Long 与 null 在解析期报 E067。 */
export type AnnotationValue = string | number | boolean;

export interface AnnotationArg {
  readonly name: string;
  readonly value: AnnotationValue;
}

export interface Annotation {
  readonly name: string;
  readonly args?: readonly AnnotationArg[];
}

export interface Token {
  readonly kind: TokenKind;
  readonly value: string | number | boolean | null | CommentValue;
  readonly start: Position;
  readonly end: Position;
  readonly channel?: 'trivia';
  /**
   * 关键词翻译前的原始源值（仅当本 token 由非英文关键词翻译而来时设置）。
   * 非英文词法包下，用户标识符可能与某 CNL 关键词的词同形而被翻译层翻译（甚至拆成
   * 多 token）。在【标识符位置】，parser 可借本字段还原原始单词作为标识符——与 EN
   * 路径的 nameIdent 软关键词容忍机制对齐。
   */
  readonly originalValue?: string;
  /**
   * 当本 token 由【单源词翻译成多目标词】（如 zh `结果`→`result of`）拆分而来时，
   * 标记同一翻译单元的目标 token 数（≥2），仅设在该单元【首个】token 上。parser 在
   * 标识符位置还原 originalValue 后，据此跳过整组拆分 token。
   */
  readonly transUnitLen?: number;
  /** 数值字面量（INT / FLOAT / LONG）的源码原文（ADR 0055 §5），用于精确求出规范十进制串与诊断。 */
  readonly raw?: string;
}

export enum TokenKind {
  EOF = 'EOF',
  NEWLINE = 'NEWLINE',
  INDENT = 'INDENT',
  DEDENT = 'DEDENT',
  // ADR 0028：显式块结束词（如「毕」）。dialect reserved closer——只在启用了
  // lexicon.blockDelimiters.end 的方言里产生，让函数体块可脱离缩进、以显式词收尾。
  BLOCK_END = 'BLOCK_END',
  DOT = 'DOT',
  COLON = 'COLON',
  COMMA = 'COMMA',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  EQUALS = 'EQUALS',
  EQ = 'EQ',
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
  DECIMAL = 'DECIMAL',
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

/**
 * 名称解析角色（ADR 0051）。R1/R2 写入 AST 标识符节点的 `resolved.role`，
 * 表示该写法在当前位置按哪种角色解析。`VALUE_REF`（§5 值位置单段名）只出现在未解析诊断中：
 * 解析成功时记录命中层的具体角色。
 */
export type ResolvedRole =
  | 'TYPE_DECL'
  | 'FIELD_DECL'
  | 'MEMBER_DECL'
  | 'FUNC_DECL'
  | 'TYPE'
  | 'FIELD_REF'
  | 'MEMBER_REF'
  | 'FUNC_REF'
  | 'VALUE_REF'
  | 'LOCAL';

/**
 * 名称解析结果：`written` 为源码原写法，`canonical` 为规范名。
 * 节点自身的 name 字段保持原写法不变，下游以 canonical 产出 Core。
 */
export interface Resolved {
  readonly canonical: string;
  readonly role: ResolvedRole;
  readonly written: string;
}

/** 携带名称解析结果的 AST 节点（R1/R2 写入，解析前缺省）。 */
export interface Resolvable {
  readonly resolved?: Resolved;
}

export interface Module extends Base.BaseModule<Span, Declaration> {
  span: Span;
  /**
   * ADR 0051：`Type X as …` 类型别名的原写法名（按出现顺序）。仅存在于 AST，供名称解析
   * 作为 TYPE_DECL；别名不产出 Core 声明（与 Java 一致）。无别名时省略。
   */
  readonly typeAliases?: readonly string[];
  /**
   * `Type X as …` 的完整声明（别名目标类型与声明 span），与 typeAliases 同序同长。
   * 格式化器据此重新输出别名，名称解析据此把 E807 报在别名声明上。无别名时省略。
   */
  readonly typeAliasDecls?: readonly TypeAliasDecl[];
  /** R1 对 typeAliases 的 TYPE_DECL 解析结果，与 typeAliases 同长（解析前缺省） */
  readonly resolvedTypeAliases?: readonly Resolved[];
}

/** 类型别名声明 `Type Score as Int.`：只存在于 AST，不产出 Core 声明（与 Java 一致）。 */
export interface TypeAliasDecl {
  /** 别名原写法名 */
  readonly name: string;
  /** 别名目标类型 */
  readonly type: Type;
  /** 整条声明（`Type` 至句点）的位置 */
  readonly span: Span;
}

export interface Import extends Base.BaseImport<Span> {
  span: Span;
}

export interface Data extends Resolvable, Base.BaseData<Span, Type> {
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
  /** 最小值字面量原文（ADR 0055 §5：IR 中的规范十进制串由它求出，不经 number） */
  readonly minRaw?: string;
  /** 最大值字面量原文 */
  readonly maxRaw?: string;
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

export interface Field extends Resolvable, Base.BaseField<Type> {
  /** CNL 约束列表 */
  readonly constraints?: readonly Constraint[];
  /** 标记类型是否为推断得出（用于诊断和文档生成） */
  readonly typeInferred?: boolean;
  span: Span;
}

export interface Enum extends Resolvable, Base.BaseEnum<Span> {
  span: Span;
  /** R30+ audit P1：LSP / 诊断需要枚举名的精确 span。 */
  readonly nameSpan?: Span;
  /** R30+ audit P1：每个 variant 的精确 span，与 variants 数组同长。 */
  readonly variantSpans?: readonly Span[];
  /** ADR 0051：每个 variant 的 MEMBER_DECL 解析结果，与 variants 数组同长。 */
  readonly resolvedVariants?: readonly Resolved[];
}

export interface Func extends Resolvable, Base.BaseFunc<Span, readonly string[], Type> {
  readonly retType: Type;
  readonly annotations?: readonly Annotation[];
  /** 标记返回类型是否为推断得出（用于诊断和文档生成） */
  readonly retTypeInferred?: boolean;
  readonly body: Block | null;
  readonly params: readonly Parameter[];
  readonly effectParams?: readonly string[];
  /** R30+ audit P1：函数名 span，用于 LSP go-to-definition + rename refactor。 */
  readonly nameSpan?: Span;
  span: Span;
}

export interface Parameter extends Resolvable, Base.BaseParameter<Type> {
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

export interface Let extends Resolvable, Base.BaseLet<Span, Expression> {
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

export interface PatternCtor extends Resolvable, Base.BasePatternCtor<Span, Pattern> {
  /** 各绑定名的 span，与 names 同长（解析器写入；IR 中每个绑定 PatName 的 origin 取自它） */
  readonly nameSpans?: readonly Span[];
  span: Span;
}

export interface PatternName extends Resolvable, Base.BasePatternName<Span> {
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
  | Decimal
  | String
  | Null
  | Call
  | Construct
  | Ok
  | Err
  | Some
  | None
  | Lambda
  | Await
  | IfExpr
  | ListLit;

export interface Await extends Base.BaseAwait<Span, Expression> {
  span: Span;
}

/** 表达式级 if（ADR 0019 G2b，surface AST）。 */
export interface IfExpr extends Base.BaseIfExpr<Span, Expression> {
  span: Span;
}

/** 列表字面量（ADR 0024 C0，surface AST）。 */
export interface ListLit extends Base.BaseListLit<Span, Expression> {
  span: Span;
}

export interface Name extends Resolvable, Base.BaseName<Span> {
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
  /** 字面量原文（ADR 0055 §5）：IR 的 Double.value 由它经任意精度十进制求出，不经 number */
  readonly raw?: string;
  span: Span;
}

/** Decimal 字面量（ADR 0025，canonical 十进制字符串值）。 */
export interface Decimal extends Base.BaseDecimal<Span> {
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

export interface Construct extends Resolvable, Base.BaseConstruct<Span, ConstructField> {
  span: Span;
}

export interface ConstructField extends Resolvable, Base.BaseConstructField<Expression> {
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

export interface TypeName extends Resolvable, Base.BaseTypeName<Span> {
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

export interface TypeApp extends Resolvable, Base.BaseTypeApp<Span, Type> {
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
/**
 * Core IR v2（ADR 0055）的 TS 类型：全部是 `core/core-ir-v2.generated.ts`（由 v2 JSON Schema 生成）
 * 的别名，因此与 schema 逐字段一致（`test/types/core-ir-v2.test-d.ts` 断言双向相等）。
 * 名称沿用 v1 的 Core.* 以保持调用方不变：Pattern = Pat、Statement = Stmt、Expression = Expr、
 * Parameter = Param、ConstructField = FieldInit。
 */
export namespace Core {
  export type Origin = V2.IrOrigin;
  export type Module = V2.IrModule;
  export type Declaration = V2.IrDecl;
  export type Import = V2.IrImport;
  export type Data = V2.IrData;
  export type Field = V2.IrField;
  export type Enum = V2.IrEnum;
  export type Func = V2.IrFunc;
  export type Parameter = V2.IrParam;
  export type Annotation = V2.IrAnnotation;
  export type AnnotationArg = V2.IrAnnotationArg;

  export type Constraint = V2.IrConstraint;
  export type ConstraintRequired = V2.IrRequired;
  export type ConstraintRange = V2.IrRange;
  export type ConstraintPattern = V2.IrPattern;

  export type Statement = V2.IrStmt;
  export type Block = V2.IrBlock;
  export type Scope = V2.IrScope;
  export type Let = V2.IrLet;
  export type Set = V2.IrSet;
  export type Return = V2.IrReturn;
  export type If = V2.IrIf;
  export type Match = V2.IrMatch;
  export type Case = V2.IrCase;
  export type Start = V2.IrStart;
  export type Wait = V2.IrWait;
  export type Workflow = V2.IrWorkflow;
  export type Step = V2.IrStep;
  export type RetryPolicy = V2.IrRetryPolicy;
  export type Timeout = V2.IrTimeout;

  export type Pattern = V2.IrPat;
  export type PatNull = V2.IrPatNull;
  export type PatCtor = V2.IrPatCtor;
  export type PatName = V2.IrPatName;
  export type PatInt = V2.IrPatInt;

  export type Expression = V2.IrExpr;
  export type Name = V2.IrName;
  export type Bool = V2.IrBool;
  export type Int = V2.IrInt;
  export type Long = V2.IrLong;
  export type Double = V2.IrDouble;
  /** Decimal 字面量（ADR 0025，canonical 十进制字符串值）。 */
  export type Decimal = V2.IrDecimal;
  export type String = V2.IrString;
  export type Null = V2.IrNull;
  export type Call = V2.IrCall;
  export type Construct = V2.IrConstruct;
  export type ConstructField = V2.IrFieldInit;
  export type Ok = V2.IrOk;
  export type Err = V2.IrErr;
  export type Some = V2.IrSome;
  export type None = V2.IrNone;
  export type Lambda = V2.IrLambda;
  export type Await = V2.IrAwait;
  /** 表达式级 if（ADR 0019 G2b）。 */
  export type IfExpr = V2.IrIfExpr;
  /** 列表字面量（ADR 0024 C0）。 */
  export type ListLit = V2.IrListLit;

  export type Type = V2.IrType;
  export type TypeName = V2.IrTypeName;
  export type TypeVar = V2.IrTypeVar;
  export type TypeApp = V2.IrTypeApp;
  export type Maybe = V2.IrMaybe;
  export type Option = V2.IrOption;
  export type Result = V2.IrResult;
  export type List = V2.IrList;
  export type Map = V2.IrMap;
  export type FuncType = V2.IrFuncType;
  /** PII 类型（运行时 PII 数据流跟踪与污点分析）。 */
  export type PiiType = V2.IrPiiType;

  /** 任意带 kind 与 origin 的 Core 节点。 */
  export type CoreNode = { readonly kind: string; readonly origin: Origin };
}

/**
 * 类型检查器内部的类型代数（不是 IR）。类型检查会合成大量不来自源码的类型（`Unknown`、推断结果、
 * 内置签名），它们没有源码位置；函数类型还携带效应参数与声明效应。因此这里的 origin 可缺，
 * 并多出 `EffectVar`。IR 的 `Core.Type` 是它的子类型，可以直接传入；反方向不成立——类型检查器
 * 不向 IR 写类型。
 */
export namespace Ty {
  type At = { readonly origin?: Core.Origin };
  export type TypeName = At & { readonly kind: 'TypeName'; readonly name: string };
  export type TypeVar = At & { readonly kind: 'TypeVar'; readonly name: string };
  export type EffectVar = At & { readonly kind: 'EffectVar'; readonly name: string };
  export type TypeApp = At & { readonly kind: 'TypeApp'; readonly base: string; readonly args: readonly Type[] };
  export type Maybe = At & { readonly kind: 'Maybe'; readonly type: Type };
  export type Option = At & { readonly kind: 'Option'; readonly type: Type };
  export type List = At & { readonly kind: 'List'; readonly type: Type };
  export type Result = At & { readonly kind: 'Result'; readonly ok: Type; readonly err: Type };
  export type Map = At & { readonly kind: 'Map'; readonly key: Type; readonly val: Type };
  export type FuncType = At & {
    readonly kind: 'FuncType';
    readonly params: readonly Type[];
    readonly ret: Type;
    readonly effectParams?: readonly string[];
    readonly declaredEffects?: readonly string[];
  };
  export type PiiType = At & {
    readonly kind: 'PiiType';
    readonly baseType: Type;
    readonly sensitivity: string;
    readonly category: string;
  };
  export type Type = TypeName | TypeVar | EffectVar | TypeApp | Maybe | Option | List | Result | Map | FuncType | PiiType;
}
