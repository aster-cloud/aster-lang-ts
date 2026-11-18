/**
 * Core IR v2 严格读入的公共流程（ADR 0055 §5），与 Java `CoreIrJson.read` 同一契约。
 *
 * 流程固定为：① 解析 JSON，先单独检查 `/schemaVersion`（缺失、非整数或不为 2 都报
 * `unsupported_schema_version`，不依赖校验器报出的路径）；② 对输入做 JSON Schema 2020-12 校验；
 * ③ 执行 `validateCoreIrInvariants`。②③ 失败报 `invalid_request`，并带上问题列表。
 * ts 的 IR 是普通对象，没有 Jackson 那样的「严格绑定」一步，schema 的 `additionalProperties:false`
 * 已覆盖未知字段。
 *
 * 第 ② 步的校验函数由调用方提供：Node 侧（`read-core-ir.ts`）首次使用时由 ajv 编译；Workers 等禁止动态生成代码的
 * 环境（`read-core-ir-precompiled.ts`）用构建前预编译的同一 schema、同一选项的函数。本模块不依赖 ajv。
 */
import type { IrModule } from './core-ir-v2.generated.js';
import { validateCoreIrInvariants, type CoreIrProblem } from './serialize-core-ir.js';

/** 读入失败的分类，与 Java `CoreIrFormatException.code()` 取值相同。 */
export type CoreIrFormatCode = 'unsupported_schema_version' | 'invalid_request';

/** 读入失败。`problems` 为 schema（code 恒为 `schema`）或不变式问题，版本错误时为空。 */
export class CoreIrFormatError extends Error {
  constructor(
    public readonly code: CoreIrFormatCode,
    message: string,
    public readonly problems: readonly CoreIrProblem[] = [],
  ) {
    super(message);
    this.name = 'CoreIrFormatError';
  }
}

/** 本实现读写的唯一 schema 版本。 */
export const CORE_IR_SCHEMA_VERSION = 2;

/** schema 校验函数的最小形状（ajv 的 ValidateFunction 与预编译函数都满足）。 */
export interface CoreIrSchemaValidator {
  (data: unknown): boolean;
  errors?: readonly { readonly instancePath: string }[] | null;
}

/** 用给定的 schema 校验函数严格读入 Core IR v2 JSON；任何一步不通过都抛 CoreIrFormatError。 */
export function readCoreIrWith(json: string, validate: CoreIrSchemaValidator): IrModule {
  let tree: unknown;
  try {
    tree = JSON.parse(json);
  } catch (e) {
    throw new CoreIrFormatError('invalid_request', `Core IR 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  checkSchemaVersion(tree);
  if (!validate(tree)) {
    // 不同校验器报告的路径不同，跨引擎只比较 code
    const problems = (validate.errors ?? []).map(e => ({ path: e.instancePath, code: 'schema' }));
    throw new CoreIrFormatError('invalid_request', 'Core IR 不符合 v2 schema', problems);
  }
  const module = tree as IrModule;
  const problems = validateCoreIrInvariants(module);
  if (problems.length > 0) {
    throw new CoreIrFormatError('invalid_request', 'Core IR 违反 v2 不变式', problems);
  }
  return module;
}

/** 第 ① 步：`/schemaVersion` 必须是整数 2（字符串 "2" 也是类型错误）。 */
function checkSchemaVersion(tree: unknown): void {
  const version = tree !== null && typeof tree === 'object' && !Array.isArray(tree)
    ? (tree as Record<string, unknown>)['schemaVersion']
    : undefined;
  if (version !== CORE_IR_SCHEMA_VERSION) {
    throw new CoreIrFormatError(
      'unsupported_schema_version',
      `不支持的 Core IR schemaVersion：${version === undefined ? '缺失' : JSON.stringify(version)}，只接受整数 ${CORE_IR_SCHEMA_VERSION}`,
    );
  }
}
