import type { Core } from '../types.js';

/**
 * 「类型未在源码中声明」的查询（ADR 0055 #9：typeInferred 是 Core IR v2 的恒输出字段）。
 *
 * `Define X has a, b.` 这类字段没有 `as <Type>`，降级时 `type` 按命名推断填入，构造器检查继续沿用
 * 推断类型；但成员访问时类型检查器要把它当作动态值（Unknown），与 Java BaseTypeChecker 对点号名
 * 一律给 Unknown 的语义对齐。名称解析 R2（ADR 0051 §4、裁决 R31）只把声明类型当作类型来源。
 * v1 用旁路表携带这一事实以免改变 IR；v2 起它就是 IR 字段，这里只读字段。
 */

/** 字段是否在源码中未声明类型。 */
export function isFieldTypeInferred(field: Core.Field): boolean {
  return field.typeInferred;
}

/** lambda 参数是否在源码中未声明类型。 */
export function isLambdaParamTypeInferred(param: Core.Parameter): boolean {
  return param.typeInferred;
}
