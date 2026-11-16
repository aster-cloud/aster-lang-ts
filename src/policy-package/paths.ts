/**
 * 包内路径规则与体积上限（README「路径规则」「zip 规则」「体积上限」）。
 */

/** zip 文件本身、解压后单条 / 累计、目录形态单文件 / 累计的上限。 */
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
/** `manifest.json` 上限（超出为 manifest 阶段的 PKG_INVALID_MANIFEST）。 */
export const MAX_MANIFEST_BYTES = 1024 * 1024;
/** `manifest.sig.json` 上限（超出为 signature 阶段的 PKG_SIGNATURE）。 */
export const MAX_SIG_BYTES = 64 * 1024;
/** `--input` 上限（超出为 input 阶段的 INPUT_INVALID）。 */
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;

/** 不列入 `files[]` 的三个元文件。 */
export const META_FILES: ReadonlySet<string> = new Set(['manifest.json', 'manifest.sig.json', 'SHA256SUMS']);

const PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*(?![\s\S])/;

/** 包内相对路径（`files[].path` 与 zip 去掉根之后的条目名共用）：段只含 `[A-Za-z0-9._-]`，无 `.` / `..` 段。 */
export function isPackagePath(p: string): boolean {
  return PATH.test(p) && !p.split('/').some((s) => s === '.' || s === '..');
}

/** zip 根目录段：非空、NFC、不是 `.` / `..`、不含 `/`、`\` 与控制字符（C0、DEL、C1）；含义不校验，可以是非 ASCII。 */
export function isSafeZipRoot(r: string): boolean {
  return r.length > 0 && r !== '.' && r !== '..' && r === r.normalize('NFC') && !/[/\\\u0000-\u001f\u007f-\u009f]/.test(r);
}

/** 按 UTF-8 字节序比较两个字符串（`files[]` 排序与 `SHA256SUMS` 行序）。 */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
