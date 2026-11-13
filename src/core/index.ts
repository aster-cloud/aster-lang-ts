/**
 * @module core
 *
 * Core IR（中间表示）模块。
 *
 * 包含：
 * - Core IR 构造器 (Core)
 * - Core IR 遍历器 (DefaultCoreVisitor, CoreVisitor)
 * - Core IR 格式化器 (formatModule)
 * - Core IR v2 规范序列化与严格读入 (serializeCoreIr, readCoreIr，ADR 0055)
 */

export { Core, Effect } from './core_ir.js';
export {
  DefaultCoreVisitor,
  createVisitorContext,
} from './visitor.js';
export type { CoreVisitor, VisitorContext } from './visitor.js';
export { formatModule } from './pretty_core.js';
export { serializeCoreIr, validateCoreIrInvariants } from './serialize-core-ir.js';
export type { CoreIrProblem } from './serialize-core-ir.js';
export { readCoreIr, CoreIrFormatError } from './read-core-ir.js';
export { evaluate, serializeGuestValue } from './interpreter.js';
export type { EvalResult } from './interpreter.js';
