/**
 * 类型推断共享类型定义
 *
 * 独立于 parser 层，供 parser/type-inference 与推断命名规则表（parser/naming-rules）共同使用。
 */

/** 基础类型名称 */
export type PrimitiveTypeName = 'Text' | 'Int' | 'Float' | 'Bool' | 'DateTime';
