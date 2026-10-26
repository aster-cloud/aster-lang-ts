/**
 * @module config/lexicons/identifiers/casefold
 *
 * 名称比较使用的规范化与折叠：NFC 之后逐码点应用 Unicode 15.1 简单折叠（C+S）。
 * 不使用宿主的 toLowerCase()，以保证 TS 与 Java 两个引擎结果一致。
 */
import { CASEFOLD_TABLE } from './casefold-table.generated.js';

/** Unicode NFC 规范化。 */
export function nfc(s: string): string {
  return s.normalize('NFC');
}

/** 折叠键：NFC(逐码点折叠(NFC(s)))。末尾再做 NFC，使折叠键对 NFC 闭合，可直接作为规范 JSON 的键。 */
export function foldKey(s: string): string {
  let out = '';
  for (const ch of nfc(s)) {
    const cp = ch.codePointAt(0)!;
    const mapped = CASEFOLD_TABLE.get(cp);
    out += mapped === undefined ? ch : String.fromCodePoint(mapped);
  }
  return nfc(out);
}

/** 按码点（等价于 UTF-8 字节序）比较字符串；JS 默认比较按 UTF-16 单元，对增补平面字符不正确。 */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const ra = ia.next();
    const rb = ib.next();
    if (ra.done || rb.done) return ra.done === rb.done ? 0 : ra.done ? -1 : 1;
    const ca = ra.value.codePointAt(0)!;
    const cb = rb.value.codePointAt(0)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}
