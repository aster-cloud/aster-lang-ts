/**
 * 类型推断共享类型定义
 *
 * 独立于 parser 层，供 config/lexicons overlay 和 parser/type-inference 共同使用，
 * 避免 config -> parser 循环依赖。
 */

/** 基础类型名称 */
export type PrimitiveTypeName = 'Text' | 'Int' | 'Float' | 'Bool' | 'DateTime';

/**
 * 类型推断规则接口
 */
export interface TypeInferenceRule {
  /** 字段名匹配模式 */
  readonly pattern: RegExp;
  /** 推断的类型 */
  readonly type: PrimitiveTypeName;
  /** 优先级（数值越大优先级越高） */
  readonly priority: number;
}
