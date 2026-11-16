/**
 * integrity 阶段（README「检查顺序」integrity 行）。签名通过之后才执行：只有可信的 manifest 才拿来比对载荷。
 *
 *   - `files[]` 每项存在、大小与 SHA-256 相符；包内除三个元文件外没有 `files[]` 以外的文件；
 *   - `SHA256SUMS` 存在且逐字节等于由 `files[]` + `manifest.json` 生成的内容（GNU 格式，按路径 UTF-8 字节序）；
 *   - A 包 `compiled/core.json` 的 SHA-256 = `coreIr.sha256`；`source.sha256` = `policy/policy.aster` 的 SHA-256；
 *   - `tests.probesSha256` = `tests/probes.json` 的 SHA-256；`tests.probes` = 该文件（严格 JSON）中 `probes` 的条数。
 * 失败一律 `PKG_INTEGRITY`。
 */
import { createHash } from 'node:crypto';
import { fail } from './errors.js';
import { compareUtf8, META_FILES } from './paths.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';
import type { LoadedPackage } from './read-package.js';

/** 小写十六进制 SHA-256。 */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const bad = (why: string): never => fail('integrity', 'PKG_INTEGRITY', why);

/** 读取一个必有的载荷文件（manifest schema 已保证它列在 `files[]` 中，integrity 已保证存在）。 */
export function payload(pkg: LoadedPackage, path: string): Uint8Array {
  return pkg.files.get(path) ?? bad(`缺文件 ${path}`);
}

/** 由 `files[]` 与 manifest 字节生成期望的 `SHA256SUMS`。 */
function expectedSums(pkg: LoadedPackage): string {
  const all = new Map<string, Uint8Array>(pkg.manifest.files.map((f) => [f.path, pkg.files.get(f.path)!]));
  all.set('manifest.json', pkg.manifestBytes);
  return [...all.keys()]
    .sort(compareUtf8)
    .map((p) => `${sha256Hex(all.get(p)!)}  ${p}\n`)
    .join('');
}

/** integrity 阶段全部检查。 */
export function verifyIntegrity(pkg: LoadedPackage): void {
  const { manifest } = pkg;
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const b = pkg.files.get(f.path) ?? bad(`缺文件 ${f.path}`);
    if (b.length !== f.size || sha256Hex(b) !== f.sha256) bad(`哈希或大小不符 ${f.path}`);
  }
  for (const p of pkg.files.keys()) {
    if (!listed.has(p) && !META_FILES.has(p)) bad(`多余文件 ${p}`);
  }
  const sums = pkg.files.get('SHA256SUMS') ?? bad('缺 SHA256SUMS');
  if (!Buffer.from(sums.buffer, sums.byteOffset, sums.byteLength).equals(Buffer.from(expectedSums(pkg), 'utf8'))) bad('SHA256SUMS 与 files[] 不一致');
  if (manifest.mode === 'a' && sha256Hex(payload(pkg, 'compiled/core.json')) !== manifest.coreIr.sha256) {
    bad('compiled/core.json 的 SHA-256 ≠ coreIr.sha256');
  }
  if (sha256Hex(payload(pkg, 'policy/policy.aster')) !== manifest.source.sha256) bad('policy/policy.aster 的 SHA-256 ≠ source.sha256');
  const probes = payload(pkg, 'tests/probes.json');
  if (sha256Hex(probes) !== manifest.tests.probesSha256) bad('tests/probes.json 的 SHA-256 ≠ tests.probesSha256');
  let doc: JsonValue;
  try {
    doc = parseStrictJson(probes, { maxDepth: 64, lossless: true });
  } catch (e) {
    return bad(`tests/probes.json 不是严格 JSON：${(e as Error).message}`);
  }
  const list = isJsonObject(doc) ? doc['probes'] : undefined;
  if (!Array.isArray(list) || list.length !== manifest.tests.probes) bad('tests.probes 与 tests/probes.json 的条数不符');
}
