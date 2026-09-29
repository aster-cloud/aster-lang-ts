import fs from 'node:fs';
import * as path from 'node:path';

/** 生成目录标记文件：存在即表示该目录内容由本工具产出，可放心整目录重建。 */
export const GENERATED_MARKER = '.aster-generated';

/**
 * 清空并重建代码生成的目标目录。
 *
 * `--out` 由用户任意指定，直接 `rmSync(recursive)` 意味着写错成 `~`、项目根或
 * 任何数据目录都会被递归删除。只在「不可能误删用户数据」的形态下静默重建：
 * 目录位于 cwd 之内（且不是 cwd 本身），并且为空或带有上一次生成留下的标记；
 * 其余形态一律要求调用方显式传 force。返回解析后的绝对路径。
 */
export function prepareOutDir(outDir: string, force: boolean, cwd: string = process.cwd()): string {
  const abs = path.resolve(cwd, outDir);
  if (fs.existsSync(abs)) {
    if (!force && !isSafeToRebuild(abs, cwd)) {
      throw new Error(
        `拒绝清空 ${abs}：目录不在当前工作目录内，或含有非本工具生成的内容。确认无误请加 --force。`
      );
    }
    fs.rmSync(abs, { recursive: true });
  }
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, GENERATED_MARKER), '');
  return abs;
}

function isSafeToRebuild(abs: string, cwd: string): boolean {
  const root = path.resolve(cwd);
  const inside = abs !== root && abs.startsWith(root + path.sep);
  if (!inside || !fs.statSync(abs).isDirectory()) return false;
  const entries = fs.readdirSync(abs);
  return entries.length === 0 || entries.includes(GENERATED_MARKER);
}
