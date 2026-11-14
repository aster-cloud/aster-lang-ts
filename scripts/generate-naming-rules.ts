/**
 * 由推断命名规则副本（shared/type-inference-naming-rules.json，ADR 0056 §3.2）生成入库文件
 * src/parser/naming-rules.generated.ts：规则表的 TS 常量，供 parser/type-inference.ts 使用
 * （用 TS 模块而非 JSON 导入，与 core-ir-v2.schema.generated.ts 同理：避免浏览器与 Node ESM 的 JSON 导入差异，
 * 也不必把 shared/ 打进 npm 包）。
 *
 * 用法：`pnpm run build && node dist/scripts/generate-naming-rules.js`（改副本后运行）。
 * 生成物提交入库；test/unit/parser/naming-rules-parity.test.ts 重新生成并要求逐字节相同。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 副本路径与生成物路径（相对仓根）。 */
export const NAMING_RULES_PATH = join('shared', 'type-inference-naming-rules.json');
export const NAMING_RULES_MODULE_PATH = join('src', 'parser', 'naming-rules.generated.ts');

export function renderNamingRulesModule(rules: unknown): string {
  return `/**
 * 本文件由 scripts/generate-naming-rules.ts 从 shared/type-inference-naming-rules.json 生成，请勿手改。
 * 推断命名规则（ADR 0056 §3.2）的内置副本，与 shared/ 中的副本深度相等。
 */
import type { NamingRulesTable } from './naming-rules.js';

export const NAMING_RULES: NamingRulesTable = ${JSON.stringify(rules, null, 2)};
`;
}

function main(): void {
  const root = process.cwd();
  const rules = JSON.parse(readFileSync(join(root, NAMING_RULES_PATH), 'utf8')) as unknown;
  writeFileSync(join(root, NAMING_RULES_MODULE_PATH), renderNamingRulesModule(rules));
  console.log(`已生成 ${NAMING_RULES_MODULE_PATH}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
