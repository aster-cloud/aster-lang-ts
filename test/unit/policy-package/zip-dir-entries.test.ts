import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { PackageError } from '../../../src/policy-package/errors.js';
import { readZip } from '../../../src/policy-package/zip.js';

// zip 目录条目规则（README「zip 规则」）：只有 `<root>/` 去掉根后可以为空；目录条目同样校验大小、CRC 与 deflate 消耗字节。
interface Entry {
  readonly name: string;
  readonly data?: Buffer;
  readonly method?: 0 | 8;
  /** 压缩数据之后追加的字节（仍计入 csize） */
  readonly trailing?: Buffer;
  readonly crc?: number;
  readonly usize?: number;
}

/** 最小的确定性 zip 写出器（本地头带大小、无 extra、无注释）。 */
function zip(entries: readonly Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const method = e.method ?? 0;
    const body = Buffer.concat([method === 8 ? deflateRawSync(data) : data, e.trailing ?? Buffer.alloc(0)]);
    const name = Buffer.from(e.name, 'utf8');
    const crc = e.crc ?? crc32(data);
    const usize = e.usize ?? data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(usize, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

const integrity = (entries: readonly Entry[]): void =>
  assert.throws(() => readZip(zip(entries)), (e: unknown) => e instanceof PackageError && e.code === 'PKG_INTEGRITY' && e.stage === 'read');

const file = { name: 'r/a.txt', data: Buffer.from('hi') };

test('合法：根目录条目、子目录条目、stored 与 deflate 的空目录条目都只校验不进文件表', () => {
  const files = readZip(zip([{ name: 'r/' }, { name: 'r/d/' }, { name: 'r/e/', method: 8 }, file]));
  assert.deepEqual([...files.keys()], ['a.txt']);
});

test('去掉根与末尾斜杠后为空的只能是 <root>/', () => {
  integrity([{ name: 'r//' }, file]);
  integrity([{ name: 'r/d//' }, file]);
});

test('目录条目同样校验声明大小、CRC 与 deflate 已消耗字节', () => {
  integrity([{ name: 'r/d/', crc: 1 }, file]);
  integrity([{ name: 'r/d/', data: Buffer.from('x'), usize: 0 }, file]);
  integrity([{ name: 'r/d/', method: 8, trailing: Buffer.from([0]) }, file]);
  integrity([{ name: 'r/d/', data: Buffer.from('x') }, file]);
});
