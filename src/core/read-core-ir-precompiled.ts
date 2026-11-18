/**
 * Core IR v2 严格读入的 Workers 版本：与 {@link readCoreIr} 同一流程、同一 schema、同一 ajv 选项，
 * 只是第 ② 步改用构建前预编译的校验函数（`core-ir-v2.validator.generated.ts`，ajv standalone），
 * 运行时不调用 `new Function`，可在 Cloudflare Workers 等禁止动态生成代码的环境使用（ADR 0059 修订 3 P2-R7）。
 * 两者接受与拒绝的输入相同，由 test/unit/core/read-core-ir.test.ts 对同一批夹具交叉断言。
 */
import type { IrModule } from './core-ir-v2.generated.js';
import { validate } from './core-ir-v2.validator.generated.js';
import { readCoreIrWith, type CoreIrSchemaValidator } from './read-core-ir-base.js';

export { CoreIrFormatError, CORE_IR_SCHEMA_VERSION, type CoreIrFormatCode } from './read-core-ir-base.js';

/** 严格读入 Core IR v2 JSON（预编译校验函数）；任何一步不通过都抛 CoreIrFormatError。 */
export function readCoreIrPrecompiled(json: string): IrModule {
  return readCoreIrWith(json, validate as CoreIrSchemaValidator);
}
