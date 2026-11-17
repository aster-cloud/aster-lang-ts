/**
 * 读包：read 阶段 + manifest 阶段（README「包路径」「zip 规则」「体积上限」，ADR 0059 修订 2 R5）。
 *
 * 路径参数指向目录即目录形态、指向普通文件即 zip，与扩展名无关；路径参数本身可以是符号链接（照常解析），
 * 目录内任何位置的符号链接都使读包失败，不跟随。大小先 `stat` 判断，不先读入再判断。
 */
import { lstatSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { fail, PackageError } from './errors.js';
import { checkManifest, type Manifest } from './manifest.js';
import { compareUtf8, MAX_DIR_DEPTH, MAX_PACKAGE_BYTES, MAX_PACKAGE_ENTRIES } from './paths.js';
import { readZip } from './zip.js';

/** 通过 read 与 manifest 两个阶段的包。`files` 的键为包根下的相对路径（含三个元文件）。 */
export interface LoadedPackage {
  readonly manifest: Manifest;
  readonly manifestBytes: Uint8Array;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/**
 * 目录形态（README「包路径」「体积上限」）：每层目录内按名字的 UTF-8 字节序遍历，对每个条目依次——
 * 符号链接 → 失败；子目录 → 先判深度（> 32 失败）、再计入条目数（> 1 024 失败）、然后递归；
 * 普通文件 → 先计入条目数，再判单文件与累计大小（先 stat，不先读入）；其他类型 → 失败。任一项超出立即失败。
 */
function readDirectory(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let count = 0;
  const countEntry = (): void => {
    count += 1;
    if (count > MAX_PACKAGE_ENTRIES) fail('read', 'PKG_INTEGRITY', `条目数超过 ${MAX_PACKAGE_ENTRIES}`);
  };
  const walk = (dir: string, rel: string, depth: number): void => {
    for (const name of readdirSync(dir).sort(compareUtf8)) {
      const abs = join(dir, name);
      const r = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) fail('read', 'PKG_INTEGRITY', `目录内有符号链接 ${r}`);
      if (st.isDirectory()) {
        if (depth + 1 > MAX_DIR_DEPTH) fail('read', 'PKG_INTEGRITY', `目录嵌套超过 ${MAX_DIR_DEPTH} 层：${r}`);
        countEntry();
        walk(abs, r, depth + 1);
        continue;
      }
      if (!st.isFile()) fail('read', 'PKG_INTEGRITY', `不是普通文件 ${r}`);
      countEntry();
      if (st.size > MAX_PACKAGE_BYTES || total + st.size > MAX_PACKAGE_BYTES) fail('read', 'PKG_INTEGRITY', '目录形态超过 64 MiB');
      total += st.size;
      files.set(r, readFileSync(abs));
    }
  };
  walk(root, '', 0);
  return files;
}

/** read 阶段：返回包内全部文件。 */
export function readPackageFiles(path: string): Map<string, Uint8Array> {
  let st: Stats;
  try {
    st = statSync(path);
  } catch {
    return fail('read', 'PKG_INTEGRITY', `包路径不存在或不可读：${path}`);
  }
  try {
    if (st.isDirectory()) return readDirectory(path);
    if (!st.isFile()) return fail('read', 'PKG_INTEGRITY', `包路径既不是目录也不是普通文件：${path}`);
    if (st.size > MAX_PACKAGE_BYTES) return fail('read', 'PKG_INTEGRITY', 'zip 超过 64 MiB');
    return readZip(readFileSync(path));
  } catch (e) {
    if (e instanceof PackageError) throw e;
    return fail('read', 'PKG_INTEGRITY', `读包失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** read → manifest。缺 `manifest.json` 为 read 阶段的 `PKG_INVALID_MANIFEST`。 */
export function readPackage(path: string): LoadedPackage {
  const files = readPackageFiles(path);
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) return fail('read', 'PKG_INVALID_MANIFEST', '包内没有 manifest.json');
  return { manifest: checkManifest(manifestBytes), manifestBytes, files };
}
