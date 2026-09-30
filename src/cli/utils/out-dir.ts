import fs from 'node:fs';
import * as path from 'node:path';

/** 生成目录标记文件：存在即表示该目录内容由本工具产出，可放心整目录重建。 */
export const GENERATED_MARKER = '.aster-generated';

/** 约定的构建产物根目录（相对 cwd，已 gitignore）：其下任何目录都视为可重建的产物。 */
const BUILD_ROOT = 'build';

/**
 * 清空并重建代码生成的目标目录。
 *
 * `--out` 由用户任意指定，直接 `rmSync(recursive)` 意味着写错成 `~`、项目根或
 * 任何数据目录都会被递归删除。只在「不可能误删用户数据」的形态下静默重建，
 * 其余形态一律要求调用方显式传 force。返回解析后的绝对路径。
 *
 * 可静默重建的形态（前提：目录位于 cwd 之内且不是 cwd 本身）：
 * - 位于 `cwd/build/` 之下。默认输出目录 `build/jvm-src` 就在其中；标记文件只由本函数
 *   写入，而旧版 `aster jvm` 与 `emit-classfiles` 曾在这里生成源码却不写标记，若坚持
 *   要求标记，升级后第一次运行就会把工具自己的产物当成用户内容拒绝；
 * - 空目录；
 * - 带有上一次生成留下的标记文件。
 */
export function prepareOutDir(outDir: string, force: boolean, cwd: string = process.cwd()): string {
  const abs = path.resolve(cwd, outDir);
  if (fs.existsSync(abs)) {
    const blocker = force ? null : rebuildBlocker(abs, path.resolve(cwd));
    if (blocker) throw new Error(`拒绝清空 ${abs}：${blocker}。确认无误请加 --force。`);
    fs.rmSync(abs, { recursive: true });
  }
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, GENERATED_MARKER), '');
  return abs;
}

/** 不能静默重建时返回原因（错误信息据此区分形态），可以则返回 null。 */
function rebuildBlocker(abs: string, root: string): string | null {
  if (!isStrictlyUnder(abs, root)) return '目录不在当前工作目录之下';
  if (!fs.statSync(abs).isDirectory()) return '路径不是目录';
  if (isStrictlyUnder(abs, path.join(root, BUILD_ROOT))) return null;
  const entries = fs.readdirSync(abs);
  if (entries.length === 0 || entries.includes(GENERATED_MARKER)) return null;
  return `目录缺少生成标记 ${GENERATED_MARKER}，无法确认其内容由本工具生成`;
}

function isStrictlyUnder(abs: string, parent: string): boolean {
  return abs !== parent && abs.startsWith(parent + path.sep);
}
