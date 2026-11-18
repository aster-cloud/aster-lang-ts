/**
 * 生成 ts 引擎的导出 builtin 白名单 `src/policy-package/export-builtins.json`（ADR 0059 P1 T10 的 ts 一半，
 * 修订 3 P2-R7；aster-api 导出检查 E732 在 target=node 时读它）。
 *
 * 口径（P1 计划 T10「白名单口径」）：
 *   - `names` = 解释器 `BUILTIN_ARITY` 的键 ∪ `BUILTIN_OPS` ∪ `NAMED_BUILTIN_OPS` 中值非 null 的键（即排除 `await`），
 *     按 UTF-16 码元升序（全部为 ASCII，与码点序相同）、无重复；
 *   - `aliases` = `CALL_TARGET_BUILTIN_ALIASES`（小写单词别名 → 规范名；与引擎调用时 `callTargetBuiltin` 的归一相同）；
 *   - `engine` = `aster-lang-ts-interpreter`。
 * 文件是规范 JSON（键升序、无空白）加一个换行，与 aster-lang-truffle `aster/truffle/export-builtins.json` 同形。
 *
 * 用法：`pnpm run build && node dist/scripts/generate-export-builtins.js`（改了上述任一张表后运行并提交）。
 * test/unit/policy-package/export-builtins.test.ts 重新计算并要求逐字节相同。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILTIN_OPS, CALL_TARGET_BUILTIN_ALIASES, NAMED_BUILTIN_OPS } from '../src/config/semantic.js';
import { canonicalJson } from '../src/core/canonical-json.js';
import { BUILTIN_ARITY } from '../src/core/interpreter.js';
import { ENGINE } from '../src/policy-package/cli-version.js';

/** 白名单文件相对仓根的路径。 */
export const EXPORT_BUILTINS_PATH = join('src', 'policy-package', 'export-builtins.json');

/** 白名单文件的形状。 */
export interface ExportBuiltins {
  readonly aliases: Readonly<Record<string, string>>;
  readonly engine: string;
  readonly names: readonly string[];
}

/** 按口径从引擎源码表计算白名单。 */
export function computeExportBuiltins(): ExportBuiltins {
  const named = Object.entries(NAMED_BUILTIN_OPS).filter(([, op]) => op !== null).map(([name]) => name);
  const names = [...new Set([...Object.keys(BUILTIN_ARITY), ...BUILTIN_OPS, ...named])].sort();
  return { aliases: { ...CALL_TARGET_BUILTIN_ALIASES }, engine: ENGINE, names };
}

/** 白名单文件的完整字节内容（规范 JSON + 换行）。 */
export function renderExportBuiltins(): string {
  return `${canonicalJson(computeExportBuiltins())}\n`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(join(process.cwd(), EXPORT_BUILTINS_PATH), renderExportBuiltins());
  console.log(`已生成 ${EXPORT_BUILTINS_PATH}`);
}
