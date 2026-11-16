/**
 * CLI 版本与引擎标识（信封 `meta.cliVersion` / `meta.engine`、`version` 子命令）。
 *
 * 单文件 bundle 由 esbuild `define` 注入 `__ASTER_CLI_VERSION__`；dist 形态从包根 `package.json` 读取
 * （`dist/src/policy-package/` 向上三级）。不把 package.json 作为 JSON 模块 import：那会让 tsc 在 dist 下
 * 再输出一份 package.json，改变 Node 对 dist 内文件的包边界判定。
 */
import { readFileSync } from 'node:fs';
import { CORE_IR_ABI, CASEFOLD_VERSION, RESOLVER_VERSION } from '../version.js';

declare const __ASTER_CLI_VERSION__: string | undefined;

/** 信封中的引擎标识。 */
export const ENGINE = 'aster-lang-ts-interpreter';

let cached: string | undefined;

/** `@aster-cloud/aster-lang-ts` 的版本。 */
export function cliVersion(): string {
  if (cached !== undefined) return cached;
  if (typeof __ASTER_CLI_VERSION__ === 'string') return (cached = __ASTER_CLI_VERSION__);
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
  return (cached = pkg.version);
}

/** `version` 子命令的 toolchainId：本 CLI 编译 / 读取 Core IR 所用的工具链分量（ADR 0051 §7 的分量名）。 */
export function toolchainId(): string {
  return `abi=${CORE_IR_ABI};ts=${cliVersion()};resolver=${RESOLVER_VERSION};casefold=${CASEFOLD_VERSION}`;
}
