/* eslint-disable */
/**
 * 本文件由 scripts/generate-core-ir-types.ts 从 shared/core-ir.v2.schema.json 生成，请勿手改。
 * Core IR v2 的字段契约（ADR 0055）；Core.* 类型须与这里的类型双向可赋值。
 */

/**
 * 顶层声明。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Decl".
 */
export type IrDecl = IrImport | IrData | IrEnum | IrFunc;
/**
 * 所有 JSON 整数的承载类型（ADR 0055 §3）：与 Java int / Integer 一致，落在 CanonicalJson 的 safe integer 范围内。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Int32".
 */
export type IrInt32 = number;
/**
 * 类型表达式。所有类型节点都带 origin（ADR 0055 #17）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Type".
 */
export type IrType =
  | IrTypeName
  | IrTypeVar
  | IrTypeApp
  | IrResult
  | IrMaybe
  | IrOption
  | IrList
  | IrMap
  | IrFuncType
  | IrPiiType;
/**
 * 字段 / 形参约束（ADR 0055 #4）。与其它带 kind 的节点一样必带 origin（#17）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Constraint".
 */
export type IrConstraint = IrRequired | IrRange | IrPattern;
/**
 * 规范十进制串（ADR 0055 §5）：无指数、无前导零、无尾随零，小数部分全零时省略小数点；不存在 "-0"。由 lowering 从源码字面量经任意精度十进制求出。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "CanonicalDecimal".
 */
export type IrCanonicalDecimal = string;
/**
 * 授权型具体效应名（小写）。pure、async 与未知名都不授权任何效应，lowering 不把它们写入 effects。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "BuiltinEffect".
 */
export type IrBuiltinEffect = 'io' | 'cpu';
/**
 * Func.effects 中的效应变量名：任意大小写下都不是保留效应名。它是否已在 effectParams 中声明由不变式检查（undeclared-effect-var）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "EffectVarName".
 */
export type IrEffectVarName = string;
/**
 * 语句。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Stmt".
 */
export type IrStmt = IrLet | IrSet | IrReturn | IrIf | IrMatch | IrScope | IrBlock | IrStart | IrWait | IrWorkflow;
/**
 * 表达式。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Expr".
 */
export type IrExpr =
  | IrName
  | IrBool
  | IrInt
  | IrLong
  | IrDouble
  | IrDecimal
  | IrString
  | IrNull
  | IrOk
  | IrErr
  | IrSome
  | IrNone
  | IrConstruct
  | IrCall
  | IrLambda
  | IrAwait
  | IrIfExpr
  | IrListLit;
/**
 * 匹配模式。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Pat".
 */
export type IrPat = IrPatNull | IrPatCtor | IrPatName | IrPatInt;
/**
 * 匹配分支体：Return 或 Block。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "CaseBody".
 */
export type IrCaseBody = IrReturn | IrBlock;
/**
 * 只用于 Timeout.milliseconds（Java long）：safe integer 范围，仍以 JSON number 承载。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "SafeInt".
 */
export type IrSafeInt = number;
/**
 * 保留的效应名：内建效应 io、cpu，以及不授权的 pure、async（core EffectChecker 中 async 是 pure 的废弃别名）。效应参数名按 ASCII 大小写不敏感比较不得落入此集合，由 validateCoreIrInvariants 检查（effect-param-shadows-builtin）；EffectVarName 的 pattern 与此集合同步。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "ReservedEffectName".
 */
export type IrReservedEffectName = 'io' | 'cpu' | 'pure' | 'async';

/**
 * 编译单元（根节点）。schemaVersion 是整数 2（ADR 0055 #1、§5）；name 在源码没有模块头时为 null；profile 是 ADR 0046 治理档案 id，未声明为 null。
 */
export interface IrModule {
  readonly kind: 'Module';
  readonly schemaVersion: 2;
  readonly name: string | null;
  readonly profile: string | null;
  readonly decls: readonly IrDecl[];
  readonly origin: IrOrigin;
}
/**
 * 导入（ADR 0055 #2）：path 为点分模块路径，alias 为绑定名（未写别名为 null），version 为钉住的模块版本（未钉住为 null）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Import".
 */
export interface IrImport {
  readonly kind: 'Import';
  readonly path: string;
  readonly alias: string | null;
  readonly version: IrInt32 | null;
  readonly origin: IrOrigin;
}
/**
 * 源码范围（ADR 0055 #17）：每个带 kind 的节点都必带且非 null（含约束元素）。written / role 是 ADR 0051 的原写法与解析角色，未改写时为 null。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Origin".
 */
export interface IrOrigin {
  readonly file: string | null;
  readonly start: IrPosition;
  readonly end: IrPosition;
  readonly written: string | null;
  readonly role:
    | 'TYPE_DECL'
    | 'FIELD_DECL'
    | 'MEMBER_DECL'
    | 'FUNC_DECL'
    | 'TYPE'
    | 'FIELD_REF'
    | 'MEMBER_REF'
    | 'FUNC_REF'
    | 'VALUE_REF'
    | 'LOCAL'
    | null;
}
/**
 * 源码位置，行列号均从 1 开始（值域只按 Int32 约束）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Position".
 */
export interface IrPosition {
  readonly line: IrInt32;
  readonly col: IrInt32;
}
/**
 * 数据类型声明。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Data".
 */
export interface IrData {
  readonly kind: 'Data';
  readonly name: string;
  readonly fields: readonly IrField[];
  readonly origin: IrOrigin;
}
/**
 * Data 字段。constraints 是源码约束（ADR 0055 #4）；typeInferred 为 true 表示 type 只是推断出的占位（#9）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Field".
 */
export interface IrField {
  readonly name: string;
  readonly type: IrType;
  readonly annotations: readonly IrAnnotation[];
  readonly constraints: readonly IrConstraint[];
  readonly typeInferred: boolean;
}
/**
 * 具名类型。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "TypeName".
 */
export interface IrTypeName {
  readonly kind: 'TypeName';
  readonly name: string;
  readonly origin: IrOrigin;
}
/**
 * 类型变量。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "TypeVar".
 */
export interface IrTypeVar {
  readonly kind: 'TypeVar';
  readonly name: string;
  readonly origin: IrOrigin;
}
/**
 * 类型应用。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "TypeApp".
 */
export interface IrTypeApp {
  readonly kind: 'TypeApp';
  readonly base: string;
  readonly args: readonly IrType[];
  readonly origin: IrOrigin;
}
/**
 * 结果类型。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Result".
 */
export interface IrResult {
  readonly kind: 'Result';
  readonly ok: IrType;
  readonly err: IrType;
  readonly origin: IrOrigin;
}
/**
 * 可空类型。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Maybe".
 */
export interface IrMaybe {
  readonly kind: 'Maybe';
  readonly type: IrType;
  readonly origin: IrOrigin;
}
/**
 * 选项类型。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Option".
 */
export interface IrOption {
  readonly kind: 'Option';
  readonly type: IrType;
  readonly origin: IrOrigin;
}
/**
 * 列表类型。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "List".
 */
export interface IrList {
  readonly kind: 'List';
  readonly type: IrType;
  readonly origin: IrOrigin;
}
/**
 * 映射类型。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Map".
 */
export interface IrMap {
  readonly kind: 'Map';
  readonly key: IrType;
  readonly val: IrType;
  readonly origin: IrOrigin;
}
/**
 * 函数类型。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "FuncType".
 */
export interface IrFuncType {
  readonly kind: 'FuncType';
  readonly params: readonly IrType[];
  readonly ret: IrType;
  readonly origin: IrOrigin;
}
/**
 * PII 类型包装。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "PiiType".
 */
export interface IrPiiType {
  readonly kind: 'PiiType';
  readonly baseType: IrType;
  readonly sensitivity: string;
  readonly category: string;
  readonly origin: IrOrigin;
}
/**
 * 注解（ADR 0055 #3）：args 是有序数组，保持源码顺序，无参为 []。同一注解内参数名唯一由不变式检查。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Annotation".
 */
export interface IrAnnotation {
  readonly name: string;
  readonly args: readonly IrAnnotationArg[];
}
/**
 * 注解参数。位置参数按出现顺序命名为 $0、$1…（序号只在位置参数之间计数），具名参数用其名字；value 只能是 string / Int32 / boolean。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "AnnotationArg".
 */
export interface IrAnnotationArg {
  readonly name: string;
  readonly value: string | boolean | IrInt32;
}
/**
 * 必填约束。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Required".
 */
export interface IrRequired {
  readonly kind: 'Required';
  readonly origin: IrOrigin;
}
/**
 * 范围约束：min / max 是规范十进制串，至少一个非 null。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Range".
 */
export interface IrRange {
  readonly kind: 'Range';
  readonly min: IrCanonicalDecimal | null;
  readonly max: IrCanonicalDecimal | null;
  readonly origin: IrOrigin;
}
/**
 * 正则约束（源码 matching "…"）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Pattern".
 */
export interface IrPattern {
  readonly kind: 'Pattern';
  readonly regexp: string;
  readonly origin: IrOrigin;
}
/**
 * 枚举声明。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Enum".
 */
export interface IrEnum {
  readonly kind: 'Enum';
  readonly name: string;
  readonly variants: readonly string[];
  readonly origin: IrOrigin;
}
/**
 * 函数 / 规则。typeParams 只列源码声明的类型参数（#10）；effects 只含授权型具体效应 io / cpu（小写）与已声明的效应变量，按首次声明顺序、不重复；pure、async 与未知名不写入（#5、#6）；inputRefs 是 v2 唯一可空的列表，null 表示未计算、[] 表示已计算且不读任何输入，合法状态由不变式检查（#12）。没有 piiLevel / piiCategories（#8）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Func".
 */
export interface IrFunc {
  readonly kind: 'Func';
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly params: readonly IrParam[];
  readonly ret: IrType;
  readonly retTypeInferred: boolean;
  readonly annotations: readonly IrAnnotation[];
  readonly retAnnotations: readonly IrAnnotation[];
  readonly effects: readonly (IrBuiltinEffect | IrEffectVarName)[];
  readonly effectParams: readonly string[];
  readonly effectCaps: readonly string[];
  readonly effectCapsExplicit: boolean;
  readonly inputRefs: readonly string[] | null;
  readonly body: IrBlock;
  readonly origin: IrOrigin;
}
/**
 * 函数与 Lambda 的形参，字段与 Field 相同。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Param".
 */
export interface IrParam {
  readonly name: string;
  readonly type: IrType;
  readonly annotations: readonly IrAnnotation[];
  readonly constraints: readonly IrConstraint[];
  readonly typeInferred: boolean;
}
/**
 * 代码块。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Block".
 */
export interface IrBlock {
  readonly kind: 'Block';
  readonly statements: readonly IrStmt[];
  readonly origin: IrOrigin;
}
/**
 * 变量绑定。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Let".
 */
export interface IrLet {
  readonly kind: 'Let';
  readonly name: string;
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * 名称引用。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Name".
 */
export interface IrName {
  readonly kind: 'Name';
  readonly name: string;
  readonly origin: IrOrigin;
}
/**
 * 布尔字面量。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Bool".
 */
export interface IrBool {
  readonly kind: 'Bool';
  readonly value: boolean;
  readonly origin: IrOrigin;
}
/**
 * 32 位整数字面量。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Int".
 */
export interface IrInt {
  readonly kind: 'Int';
  readonly value: IrInt32;
  readonly origin: IrOrigin;
}
/**
 * 64 位整数字面量，以十进制字符串承载。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Long".
 */
export interface IrLong {
  readonly kind: 'Long';
  readonly value: string;
  readonly origin: IrOrigin;
}
/**
 * 浮点字面量（ADR 0055 #18）：规范十进制串，不经二进制浮点。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Double".
 */
export interface IrDouble {
  readonly kind: 'Double';
  readonly value: IrCanonicalDecimal;
  readonly origin: IrOrigin;
}
/**
 * Decimal 字面量（ADR 0025）：canonical 十进制字符串。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Decimal".
 */
export interface IrDecimal {
  readonly kind: 'Decimal';
  readonly value: string;
  readonly origin: IrOrigin;
}
/**
 * 字符串字面量。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "String".
 */
export interface IrString {
  readonly kind: 'String';
  readonly value: string;
  readonly origin: IrOrigin;
}
/**
 * null 字面量。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Null".
 */
export interface IrNull {
  readonly kind: 'Null';
  readonly origin: IrOrigin;
}
/**
 * Result 成功分支。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Ok".
 */
export interface IrOk {
  readonly kind: 'Ok';
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * Result 错误分支。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Err".
 */
export interface IrErr {
  readonly kind: 'Err';
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * Option 有值分支。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Some".
 */
export interface IrSome {
  readonly kind: 'Some';
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * Option 无值。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "None".
 */
export interface IrNone {
  readonly kind: 'None';
  readonly origin: IrOrigin;
}
/**
 * 构造表达式。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Construct".
 */
export interface IrConstruct {
  readonly kind: 'Construct';
  readonly typeName: string;
  readonly fields: readonly IrFieldInit[];
  readonly origin: IrOrigin;
}
/**
 * Construct 的字段初始化。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "FieldInit".
 */
export interface IrFieldInit {
  readonly name: string;
  readonly expr: IrExpr;
}
/**
 * 调用。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Call".
 */
export interface IrCall {
  readonly kind: 'Call';
  readonly target: IrExpr;
  readonly args: readonly IrExpr[];
  readonly origin: IrOrigin;
}
/**
 * Lambda（ADR 0055 #13、#14）：返回类型字段名为 ret；captures 恒输出。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Lambda".
 */
export interface IrLambda {
  readonly kind: 'Lambda';
  readonly params: readonly IrParam[];
  readonly ret: IrType;
  readonly body: IrBlock;
  readonly captures: readonly string[];
  readonly origin: IrOrigin;
}
/**
 * 等待异步结果。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Await".
 */
export interface IrAwait {
  readonly kind: 'Await';
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * 表达式级条件（ADR 0019 G2b）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "IfExpr".
 */
export interface IrIfExpr {
  readonly kind: 'IfExpr';
  readonly cond: IrExpr;
  readonly thenE: IrExpr;
  readonly elseE: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * 列表字面量。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "ListLit".
 */
export interface IrListLit {
  readonly kind: 'ListLit';
  readonly elements: readonly IrExpr[];
  readonly origin: IrOrigin;
}
/**
 * 赋值。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Set".
 */
export interface IrSet {
  readonly kind: 'Set';
  readonly name: string;
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * 返回。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Return".
 */
export interface IrReturn {
  readonly kind: 'Return';
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * 条件语句：没有 else 分支时 elseBlock 为 null。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "If".
 */
export interface IrIf {
  readonly kind: 'If';
  readonly cond: IrExpr;
  readonly thenBlock: IrBlock;
  readonly elseBlock: IrBlock | null;
  readonly origin: IrOrigin;
}
/**
 * 模式匹配。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Match".
 */
export interface IrMatch {
  readonly kind: 'Match';
  readonly expr: IrExpr;
  readonly cases: readonly IrCase[];
  readonly origin: IrOrigin;
}
/**
 * 匹配分支。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Case".
 */
export interface IrCase {
  readonly kind: 'Case';
  readonly pattern: IrPat;
  readonly body: IrCaseBody;
  readonly origin: IrOrigin;
}
/**
 * null 模式。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "PatNull".
 */
export interface IrPatNull {
  readonly kind: 'PatNull';
  readonly origin: IrOrigin;
}
/**
 * 构造器 / 枚举变体模式（ADR 0055 #15、#16）：0 参变体为 args:[]；没有 names。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "PatCtor".
 */
export interface IrPatCtor {
  readonly kind: 'PatCtor';
  readonly typeName: string;
  readonly args: readonly IrPat[];
  readonly origin: IrOrigin;
}
/**
 * 绑定模式，只用于绑定（#16）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "PatName".
 */
export interface IrPatName {
  readonly kind: 'PatName';
  readonly name: string;
  readonly origin: IrOrigin;
}
/**
 * 整数模式。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "PatInt".
 */
export interface IrPatInt {
  readonly kind: 'PatInt';
  readonly value: IrInt32;
  readonly origin: IrOrigin;
}
/**
 * 作用域。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Scope".
 */
export interface IrScope {
  readonly kind: 'Scope';
  readonly statements: readonly IrStmt[];
  readonly origin: IrOrigin;
}
/**
 * 启动异步任务。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Start".
 */
export interface IrStart {
  readonly kind: 'Start';
  readonly name: string;
  readonly expr: IrExpr;
  readonly origin: IrOrigin;
}
/**
 * 等待异步任务。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Wait".
 */
export interface IrWait {
  readonly kind: 'Wait';
  readonly names: readonly string[];
  readonly origin: IrOrigin;
}
/**
 * 工作流（kind 为小写 workflow）：未声明重试 / 超时时 retry / timeout 为 null。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Workflow".
 */
export interface IrWorkflow {
  readonly kind: 'workflow';
  readonly steps: readonly IrStep[];
  readonly effectCaps: readonly string[];
  readonly retry: IrRetryPolicy | null;
  readonly timeout: IrTimeout | null;
  readonly origin: IrOrigin;
}
/**
 * 工作流步骤（kind 为小写 step）：没有补偿块时 compensate 为 null。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Step".
 */
export interface IrStep {
  readonly kind: 'step';
  readonly name: string;
  readonly body: IrBlock;
  readonly compensate: IrBlock | null;
  readonly dependencies: readonly string[];
  readonly effectCaps: readonly string[];
  readonly origin: IrOrigin;
}
/**
 * 重试策略。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "RetryPolicy".
 */
export interface IrRetryPolicy {
  readonly maxAttempts: IrInt32;
  readonly backoff: 'exponential' | 'linear';
}
/**
 * 超时（毫秒）。
 *
 * This interface was referenced by `IrModule`'s JSON-Schema
 * via the `definition` "Timeout".
 */
export interface IrTimeout {
  readonly milliseconds: IrSafeInt;
}
