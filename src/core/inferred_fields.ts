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
