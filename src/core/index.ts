/**
 * @module core
 *
 * Core IR（中间表示）模块。
 *
 * 包含：
 * - Core IR 构造器 (Core)
 * - Core IR 遍历器 (DefaultCoreVisitor, CoreVisitor)
 * - Core IR 格式化器 (formatModule)
 * - Core IR JSON 序列化 (serializeCoreIR, deserializeCoreIR)
 */

export { Core, Effect } from './core_ir.js';
export {
  DefaultCoreVisitor,
  createVisitorContext,
} from './visitor.js';
export type { CoreVisitor, VisitorContext } from './visitor.js';
export { formatModule } from './pretty_core.js';
export {
  serializeCoreIR,
  deserializeCoreIR,
  isValidCoreIRJson,
} from './core_ir_json.js';
export type { CoreIREnvelope } from './core_ir_json.js';
