/**
 * 由 Core IR v2 schema（shared/core-ir.v2.schema.json）生成两个入库文件：
 * - src/core/core-ir-v2.generated.ts：字段契约的 TS 类型；
 * - src/core/core-ir-v2.schema.generated.ts：schema 本身的 TS 常量，供 readCoreIr 校验用
 *   （用 TS 模块而非 JSON 导入，与 controls-registry.data.ts 同理：避免浏览器与 Node ESM 的
 *   JSON 导入差异，也不必把 shared/ 打进 npm 包）。
 *
 * 用法：`pnpm run build && node dist/scripts/generate-core-ir-types.js`（改 schema 副本后运行）。
 * 生成物提交入库；test/unit/core/core-ir-schema-parity.test.ts 重新生成并要求逐字节相同。
 *
 * schema 的联合类型（Decl、Type、Stmt、Expr、Pat、Constraint、CaseBody）为了让校验错误
 * 落到具体字段上，写成「enum 限定 kind + allOf 中按 kind 的 if / then」。json-schema-to-typescript
 * 不理解 if / then，生成前先把这类联合改写为等价的 `oneOf: [$ref…]`（只影响类型生成，
 * 校验仍用原 schema）。为了不遮蔽 TS 全局类型（String、Map、List、Set、Option 等），所有
 * 具名类型统一加 `Ir` 前缀；所有属性与数组都输出为 readonly，与 Core.* 的只读约定一致。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

type SchemaNode = Record<string, unknown>;

/** 生成物文件头。 */
const BANNER = `/**
 * 本文件由 scripts/generate-core-ir-types.ts 从 shared/core-ir.v2.schema.json 生成，请勿手改。
 * Core IR v2 的字段契约（ADR 0055）；Core.* 类型须与这里的类型双向可赋值。
 */`;

/** 若某个 $defs 是「enum kind + if / then 分派」的联合，返回其分支 $ref 列表。 */
function dispatchRefs(def: SchemaNode): string[] | undefined {
  const allOf = def['allOf'];
  if (!Array.isArray(allOf) || allOf.length === 0) return undefined;
  const refs: string[] = [];
  for (const branch of allOf as SchemaNode[]) {
    const then = branch['then'] as SchemaNode | undefined;
    if (branch['if'] === undefined || typeof then?.['$ref'] !== 'string') return undefined;
    refs.push(then['$ref']);
  }
  return refs;
}

/** 把 `#/$defs/X` 引用改为 `#/definitions/X`（生成器只在 definitions 下解析引用）。 */
function retargetRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(retargetRefs);
  if (node === null || typeof node !== 'object') return node;
  const out: SchemaNode = {};
  for (const [key, value] of Object.entries(node as SchemaNode)) {
    out[key] = key === '$ref' && typeof value === 'string'
      ? value.replace('#/$defs/', '#/definitions/')
      : retargetRefs(value);
  }
  return out;
}

/**
 * 生成用 schema：根节点直接取 Module 定义，其余 $defs 放进 definitions；
 * if / then 联合改写为 oneOf，其余定义原样保留。
 */
export function toGeneratorSchema(schema: SchemaNode): SchemaNode {
  const defs = schema['$defs'] as Record<string, SchemaNode>;
  const definitions: Record<string, SchemaNode> = {};
  for (const [name, def] of Object.entries(defs)) {
    // Module 就是根节点本身，不再重复放进 definitions（否则会多出一个 IrModule1）。
    if (name === 'Module') continue;
    const refs = dispatchRefs(def);
    const base = refs === undefined
      ? def
      : { description: def['description'], oneOf: refs.map(ref => ({ $ref: ref })) };
    definitions[name] = { ...base, title: `Ir${name}` };
  }
  const root = retargetRefs({ ...defs['Module'], definitions }) as SchemaNode;
  return { ...root, title: 'IrModule' };
}

/** 生成器输出改为只读：属性加 readonly，`X[]` 改为 `readonly X[]`。 */
function makeReadonly(source: string): string {
  return source
    .replace(/^( {2,})(\w+):/gm, '$1readonly $2:')
    .replace(/: \(([^()]+)\)\[\]/g, ': readonly ($1)[]')
    .replace(/: (\w+)\[\]/g, ': readonly $1[]');
}

/** 从 schema 对象渲染出生成文件的完整内容。 */
export async function renderCoreIrTypes(schema: SchemaNode): Promise<string> {
  const body = await compile(toGeneratorSchema(schema) as JSONSchema, 'Module', {
    bannerComment: BANNER,
    additionalProperties: false,
    unreachableDefinitions: true,
    declareExternallyReferenced: true,
    format: true,
    style: { singleQuote: true, printWidth: 120 },
  });
  return makeReadonly(body);
}

/** 渲染 schema 常量模块。 */
export function renderCoreIrSchemaModule(schema: SchemaNode): string {
  return `/**
 * 本文件由 scripts/generate-core-ir-types.ts 从 shared/core-ir.v2.schema.json 生成，请勿手改。
 * Core IR v2 JSON Schema（ADR 0055 §3）的内置副本，与 shared/ 中的副本深度相等。
 */
export const CORE_IR_V2_SCHEMA: Readonly<Record<string, unknown>> = ${JSON.stringify(schema, null, 2)};
`;
}

/** schema 副本路径与生成物路径（相对仓根）。 */
export const CORE_IR_SCHEMA_PATH = join('shared', 'core-ir.v2.schema.json');
export const CORE_IR_TYPES_PATH = join('src', 'core', 'core-ir-v2.generated.ts');
export const CORE_IR_SCHEMA_MODULE_PATH = join('src', 'core', 'core-ir-v2.schema.generated.ts');

async function main(): Promise<void> {
  const root = process.cwd();
  const schema = JSON.parse(readFileSync(join(root, CORE_IR_SCHEMA_PATH), 'utf8')) as SchemaNode;
  writeFileSync(join(root, CORE_IR_TYPES_PATH), await renderCoreIrTypes(schema));
  writeFileSync(join(root, CORE_IR_SCHEMA_MODULE_PATH), renderCoreIrSchemaModule(schema));
  console.log(`已生成 ${CORE_IR_TYPES_PATH}、${CORE_IR_SCHEMA_MODULE_PATH}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
