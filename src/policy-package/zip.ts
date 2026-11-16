/**
 * 包格式 v1 的 zip 读取（README「zip 规则」，ADR 0059 修订 2 R5）。
 *
 * 只在内存解压、从不写盘。调用方先按 `stat` 判 64 MiB 再把整个文件读入；这里**同时解析中央目录与本地头并要求二者一致**：
 * 只用流式读取（fflate `Unzip`、`java.util.zip.ZipInputStream`）看不到中央目录，「`unzip` 看到的」与「CLI 执行的」就可能不同。
 * deflate 条目用 `node:zlib` `inflateRawSync` 以「声明大小 + 1」为输出上限解压（README「zip 规则」）：
 * 单条实际字节超过声明大小、或累计超过 64 MiB 即失败，炸弹在占满内存之前就被截住。
 *
 * 全部失败都是 read 阶段的 `PKG_INTEGRITY`。与参照实现 `scripts/lib/package-v1/reference-check.mjs` 的 `readZip` 同一判定。
 */
import { crc32, inflateRawSync } from 'node:zlib';
import { fail } from './errors.js';
import { isPackagePath, isSafeZipRoot, MAX_PACKAGE_BYTES } from './paths.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_DESCRIPTOR = 0x08074b50;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

interface CentralEntry {
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly csize: number;
  readonly usize: number;
  readonly nameBytes: Buffer;
  readonly extra: Buffer;
  readonly offset: number;
}

const bad = (why: string): never => fail('read', 'PKG_INTEGRITY', why);

/** 解析中央目录（EOCD 必须恰在末尾：无注释、无尾随字节；单卷；无 ZIP64；非空）。 */
function readCentralDirectory(buf: Buffer): { entries: CentralEntry[]; cdOff: number } {
  if (buf.length < 22 || buf.readUInt32LE(buf.length - 22) !== SIG_EOCD) bad('EOCD 不在文件末尾（有注释、尾随字节或不是 zip）');
  const e = buf.length - 22;
  const count = buf.readUInt16LE(e + 10);
  const cdSize = buf.readUInt32LE(e + 12);
  const cdOff = buf.readUInt32LE(e + 16);
  if (buf.readUInt16LE(e + 4) !== 0 || buf.readUInt16LE(e + 6) !== 0 || buf.readUInt16LE(e + 8) !== count) bad('多卷 zip');
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) bad('ZIP64');
  if (cdOff + cdSize !== e) bad('中央目录与 EOCD 之间有间隙');
  if (count === 0) bad('空 zip');
  const entries: CentralEntry[] = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > e || buf.readUInt32LE(p) !== SIG_CENTRAL) bad('中央目录损坏');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen + extraLen + commentLen > e) bad('中央目录损坏');
    entries.push({
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      nameBytes: buf.subarray(p + 46, p + 46 + nameLen),
      extra: buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen),
      offset: buf.readUInt32LE(p + 42),
    });
    if (commentLen !== 0) bad('条目注释');
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== e) bad('中央目录长度不符');
  return { entries, cdOff };
}

/** extra field 中出现 ZIP64（0x0001）即失败；其他 extra 忽略。 */
function rejectZip64Extra(extra: Buffer): void {
  for (let k = 0; k + 4 <= extra.length; k += 4 + extra.readUInt16LE(k + 2)) {
    if (extra.readUInt16LE(k) === 0x0001) bad('ZIP64 extra');
  }
}

/** 条目名：合法 UTF-8；含非 ASCII 时必须置位 11。 */
function decodeName(bytes: Buffer, flags: number): string {
  let s: string;
  try {
    s = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return bad('条目名不是合法 UTF-8');
  }
  if (/[^\u0000-\u007f]/.test(s) && (flags & FLAG_UTF8) === 0) bad('非 ASCII 条目名未置 UTF-8 标志');
  return s;
}

/**
 * 解压一个 deflate 条目：输出上限为 limit + 1（超出即失败，zlib 在到达上限时停止，不会先产出全部结果）；
 * 压缩数据必须恰好是一个完整的 deflate 流——最终块之后、`csize` 之内还有字节即失败
 * （`engine.bytesWritten` 是已消耗的输入字节数；fflate 不公开该计数，不能用来实现这条）。
 */
function inflateBounded(raw: Uint8Array, limit: number, name: string): Uint8Array {
  let result: { buffer: Buffer; engine: { bytesWritten: number } };
  try {
    // chunkSize 取输出上限：合法条目一次分配恰好够用的缓冲，不产生「多块拼接」的临时拷贝
    const chunkSize = Math.max(64, limit + 1);
    result = inflateRawSync(raw, { maxOutputLength: limit + 1, chunkSize, info: true }) as unknown as typeof result;
  } catch {
    return bad(`解压失败或超过声明大小 / 64 MiB：${name}`);
  }
  if (result.engine.bytesWritten !== raw.length) bad(`deflate 流之后有多余字节：${name}`);
  return result.buffer;
}

/**
 * 读取内存中的 zip，返回「去掉唯一根目录之后的路径 → 字节」。目录条目校验后忽略。
 * `buf` 的长度已由调用方按 `stat` 限制在 64 MiB 内，这里再判一次以防直接调用。
 */
export function readZip(buf: Buffer): Map<string, Uint8Array> {
  if (buf.length > MAX_PACKAGE_BYTES) bad('zip 超过 64 MiB');
  const { entries: cds, cdOff } = readCentralDirectory(buf);
  const out = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let at = 0;
  let budget = MAX_PACKAGE_BYTES;
  let root: string | null = null;
  for (const cd of cds) {
    // 本地头按中央目录顺序紧密排列：首个在偏移 0，最后一个条目之后紧接中央目录
    if (cd.offset !== at || at + 30 > cdOff || buf.readUInt32LE(at) !== SIG_LOCAL) bad('本地头位置与中央目录不符（或有前置字节）');
    const flags = buf.readUInt16LE(at + 6);
    const method = buf.readUInt16LE(at + 8);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    if (at + 30 + nameLen + extraLen > cdOff) bad('本地头越过中央目录');
    const nameBytes = buf.subarray(at + 30, at + 30 + nameLen);
    const extra = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + extraLen);
    if (flags !== cd.flags || method !== cd.method || !nameBytes.equals(cd.nameBytes)) bad('本地头与中央目录不一致（标志 / 方法 / 名字）');
    if ((flags & ~(FLAG_DESCRIPTOR | FLAG_UTF8)) !== 0) bad('不支持的通用标志位（加密等）');
    rejectZip64Extra(extra);
    rejectZip64Extra(cd.extra);
    if (cd.csize === 0xffffffff || cd.usize === 0xffffffff) bad('ZIP64 大小');
    if (method !== 0 && method !== 8) bad(`不支持的压缩方法 ${method}`);
    const descriptor = (flags & FLAG_DESCRIPTOR) !== 0;
    if (descriptor && method !== 8) bad('存储条目不得使用数据描述符');
    const lcrc = buf.readUInt32LE(at + 14);
    const lcs = buf.readUInt32LE(at + 18);
    const lus = buf.readUInt32LE(at + 22);
    const headerMismatch = descriptor ? lcrc !== 0 || lcs !== 0 || lus !== 0 : lcrc !== cd.crc || lcs !== cd.csize || lus !== cd.usize;
    if (headerMismatch) bad('本地头与中央目录不一致（crc / 大小）');
    const dataAt = at + 30 + nameLen + extraLen;
    let next = dataAt + cd.csize;
    if (descriptor) {
      if (next + 16 > cdOff || buf.readUInt32LE(next) !== SIG_DESCRIPTOR) bad('缺少带签名的数据描述符');
      const same = buf.readUInt32LE(next + 4) === cd.crc && buf.readUInt32LE(next + 8) === cd.csize && buf.readUInt32LE(next + 12) === cd.usize;
      if (!same) bad('数据描述符与中央目录不一致');
      next += 16;
    }
    if (next > cdOff) bad('条目越过中央目录');

    const name = decodeName(nameBytes, flags);
    const slash = name.indexOf('/');
    const r = slash < 0 ? name : name.slice(0, slash);
    root ??= r;
    if (r !== root || slash < 0 || !isSafeZipRoot(r)) bad(`条目不在唯一的安全根目录下：${name}`);
    const rest = name.slice(slash + 1);
    const isDir = rest === '' || rest.endsWith('/');
    const rel = isDir ? rest.slice(0, -1) : rest;
    // 去掉根与末尾斜杠后只有 `<root>/` 本身可以为空（`<root>//` 之类失败）
    if (rel === '' ? rest !== '' : !isPackagePath(rel)) bad(`条目路径不合法：${name}`);
    if (seen.has(name)) bad(`重复条目 ${name}`);
    seen.add(name);

    // 目录条目与文件条目走同一组逐条检查（解压、实际大小 = 声明大小、CRC、deflate 已消耗字节 = csize），只是不放进文件表
    if (isDir && cd.usize !== 0) bad('目录条目带数据');
    const raw = buf.subarray(dataAt, dataAt + cd.csize);
    const data = method === 0 ? raw : inflateBounded(raw, Math.min(cd.usize, budget), name);
    if (data.length !== cd.usize) bad(`实际大小与声明不符：${name}`);
    if (data.length > budget) bad('累计解压超过 64 MiB');
    budget -= data.length;
    if (crc32(data) !== cd.crc) bad(`CRC 不符：${name}`);
    if (!isDir) out.set(rel, data);
    at = next;
  }
  if (at !== cdOff) bad('最后一个条目与中央目录之间有多余字节');
  return out;
}
