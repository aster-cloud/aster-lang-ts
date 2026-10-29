/**
 * 由 aster-lang-locales 的 Unicode 15.1 简单折叠数据（C+S）生成 TS 常量表。
 *
 * 用法：在仓库根目录执行 `pnpm run build && node dist/scripts/generate-casefold.js`。
 * 仅在升级折叠数据时运行；生成物提交入库，构建与测试不依赖兄弟仓库。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface CasefoldSource {
  readonly version: string;
  readonly map: Readonly<Record<string, string>>;
}

const root = process.cwd();
const sourcePath = join(root, '..', 'aster-lang-locales', 'casefold', 'casefold-15.1.json');
const outputPath = join(root, 'src', 'config', 'lexicons', 'identifiers', 'casefold-table.generated.ts');

const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as CasefoldSource;

// 源文件的键按字典序排列，这里按码点数值排序保证输出稳定。
const entries = Object.entries(source.map)
  .map(([from, to]) => [parseInt(from, 16), parseInt(to, 16)] as const)
  .sort((a, b) => a[0] - b[0]);

const hex = (cp: number): string => '0x' + cp.toString(16).toUpperCase().padStart(4, '0');
const lines = entries.map(([from, to]) => `  [${hex(from)}, ${hex(to)}],`);

const content = `/**
 * 本文件由 scripts/generate-casefold.ts 生成，请勿手工修改。
 * 数据来源：aster-lang-locales/casefold/casefold-15.1.json（Unicode ${source.version} CaseFolding.txt 的 C+S 状态）。
 */

/** 折叠表对应的 Unicode 版本，须与 toolchainId 的 casefold 分量一致。 */
export const CASEFOLD_VERSION = '${source.version}';

/** 码点 → 简单折叠后的码点；未出现的码点折叠为自身。 */
export const CASEFOLD_TABLE: ReadonlyMap<number, number> = new Map<number, number>([
${lines.join('\n')}
]);
`;

writeFileSync(outputPath, content);
console.log(`已生成 ${entries.length} 条折叠映射 -> ${outputPath}`);
