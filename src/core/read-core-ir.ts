/**
 * Core IR v2 严格读入（ADR 0055 §5），与 Java `CoreIrJson.read` 同一契约；流程见 `read-core-ir-base.ts`。
 *
 * ajv 在编译 schema 时用 `new Function` 生成校验代码，不适合浏览器 / Workers 入口，
 * 所以本模块与 `serialize-core-ir.ts` 分开，只给 CLI 等 Node 侧读方使用；
 * Workers 内改用 `read-core-ir-precompiled.ts`（同一 schema、同一选项的预编译函数）。
 */
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import type { IrModule } from './core-ir-v2.generated.js';
import { CORE_IR_V2_SCHEMA } from './core-ir-v2.schema.generated.js';
import { readCoreIrWith } from './read-core-ir-base.js';

export { CoreIrFormatError, CORE_IR_SCHEMA_VERSION, type CoreIrFormatCode } from './read-core-ir-base.js';

let validator: ValidateFunction | undefined;

/** schema 校验器：首次使用时编译，之后复用。选项须与 scripts/generate-core-ir-types.ts 的 CORE_IR_AJV_OPTIONS 相同。 */
function schemaValidator(): ValidateFunction {
  validator ??= new Ajv2020({ allErrors: true, strict: true }).compile(CORE_IR_V2_SCHEMA);
  return validator;
}

/** 严格读入 Core IR v2 JSON；任何一步不通过都抛 CoreIrFormatError。 */
export function readCoreIr(json: string): IrModule {
  return readCoreIrWith(json, schemaValidator());
}
