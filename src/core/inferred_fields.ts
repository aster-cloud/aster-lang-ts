import type { Core } from '../types.js';

/**
 * 「未声明类型的 data 字段」旁路表（Core IR 之外的元数据）。
 *
 * 背景：`Define X has a, b.` 这类字段没有 `as <Type>`，降级时 `type` 按命名推断填入，
 * 构造器检查继续沿用推断类型；但成员访问时类型检查器要把它当作动态值（Unknown），
 * 与 Java BaseTypeChecker 对点号名一律给 Unknown 的语义对齐。
 *
 * 为什么不放进 Core IR：`Core.Field` 会被序列化进 golden 与 TS↔Java IR 指纹，
 * 新增字段会改变 IR、破坏跨引擎一致性。因此用按对象身份索引的 WeakSet 携带该事实：
 * - 由 `lowerModule` 在构造 Core 字段时登记，类型检查器只读查询；
 * - 不参与 JSON 序列化，IR、golden、指纹均不变；
 * - WeakSet 不阻止 GC，Core 模块释放后条目自动消失；
 * - 不经过 lowerModule 的 Core（如从 JSON 反序列化）查不到标记，退回按 `type` 检查的既有行为。
 *
 * 作用范围仅限点号成员访问（typecheck/expression.ts）。以下两处仍使用按命名推断的 `type`（如 Text），
 * 不查询本表：
 * - `buildFieldTypeMap`（typecheck/pure.ts）：为返回类型推断提供「字段名 → 类型」映射；
 * - Data 构造器模式解构（typecheck/pattern.ts 的 `bindPattern`）：解构出的绑定沿用字段的推断类型。
 */
const inferredFields = new WeakSet<Core.Field>();

/** 登记一个未声明类型的字段（仅供降级阶段调用）。 */
export function markFieldTypeInferred(field: Core.Field): void {
  inferredFields.add(field);
}

/** 字段是否在源码中未声明类型。 */
export function isFieldTypeInferred(field: Core.Field): boolean {
  return inferredFields.has(field);
}

/**
 * 「未声明类型的 lambda 参数」旁路表：Core lambda 参数不携带 typeInferred（加入会改变 IR），
 * 同理以对象身份登记。名称解析 R2（ADR 0051 §4、裁决 R31）只把声明类型当作类型来源，据此视其类型未知。
 */
type LambdaParam = Core.Lambda['params'][number];
const inferredLambdaParams = new WeakSet<LambdaParam>();

/** 登记一个未声明类型的 lambda 参数（仅供降级阶段调用）。 */
export function markLambdaParamTypeInferred(param: LambdaParam): void {
  inferredLambdaParams.add(param);
}

/** lambda 参数是否在源码中未声明类型。 */
export function isLambdaParamTypeInferred(param: LambdaParam): boolean {
  return inferredLambdaParams.has(param);
}
