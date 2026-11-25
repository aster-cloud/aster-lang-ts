/**
 * 规范化分段扫描 opaqueRanges（ADR 0064 N2）：语义与逐字符扫描逐项一致，且只在开引号 / 反引号处落脚。
 *
 * ★守的缺陷：E1 给 segmentString、normalizeQuoteDelimiters 与变换器的 transformOutsideStrings /
 * replaceOutsideStrings 每个字符都加了一次反引号判断。普通运行几乎无感，但 CI 跑的是 c8 覆盖率，
 * 每个分支块都要计数——「关键词密集的源码必须在绝对预算内完成」从 ~340ms 涨到 ~515ms（本机），
 * CI 上 1146ms 超出 800ms 预算。改成正则跳到下一个特殊字符后本机覆盖率下 ~120ms。
 * 墙钟断言受机器与并发影响，这里另用正则 exec 次数做确定性的守卫。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { charClassRegex, escapeClose, opaqueRanges } from '../../../src/frontend/name-escape.js';
import type { OpaqueRange } from '../../../src/frontend/name-escape.js';

/** 参照实现：E1 合入时的逐字符扫描（transformers.replaceOutsideStrings 的原写法）。 */
function referenceRanges(source: string, pairs: ReadonlyMap<string, string>): OpaqueRange[] {
  const isEscaped = (i: number): boolean => {
    let slashes = 0;
    for (let k = i - 1; k >= 0 && source[k] === '\\'; k--) slashes++;
    return slashes % 2 === 1;
  };
  const ranges: OpaqueRange[] = [];
  let inString = false;
  let start = -1;
  let expectedClose = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    const escape = inString || ch !== '`' ? -1 : escapeClose(source, i);
    if (escape > 0) {
      ranges.push({ start: i, end: escape + 1, escape: true, closed: true });
      i = escape;
    } else if (inString && ch === expectedClose && !isEscaped(i)) {
      ranges.push({ start, end: i + 1, escape: false, closed: true });
      inString = false;
    } else if (!inString && pairs.has(ch) && !isEscaped(i)) {
      start = i;
      expectedClose = pairs.get(ch)!;
      inString = true;
    }
  }
  if (inString) ranges.push({ start, end: source.length, escape: false, closed: false });
  return ranges;
}

const EN = new Map([['"', '"'], ['“', '”']]);
const ZH = new Map([['「', '」'], ['"', '"'], ['“', '”']]);

describe('opaqueRanges 语义', () => {
  it('名字转义、字符串、未闭合反引号与被转义的引号', () => {
    assert.deepEqual(opaqueRanges('a `b` c', EN), [{ start: 2, end: 5, escape: true, closed: true }]);
    assert.deepEqual(opaqueRanges('a "x `y` z" b', EN), [{ start: 2, end: 11, escape: false, closed: true }]);
    // 未闭合（同行没有下一个反引号）的反引号是普通字符，其后的字符串照常识别
    assert.deepEqual(opaqueRanges('a `b\n"c"', EN), [{ start: 5, end: 8, escape: false, closed: true }]);
    assert.deepEqual(opaqueRanges('a \\"b" c', EN), [{ start: 5, end: 8, escape: false, closed: false }]);
    assert.deepEqual(opaqueRanges('「a\\」b」', ZH), [{ start: 0, end: 6, escape: false, closed: true }]);
    assert.deepEqual(opaqueRanges('', EN), []);
  });

  it('多码元的开引号从不匹配（与逐字符比较一致）', () => {
    assert.deepEqual(opaqueRanges('a <<b>> "c"', new Map([['<<', '>>'], ['"', '"']])),
      [{ start: 8, end: 11, escape: false, closed: true }]);
  });

  it('随机输入与逐字符参照实现逐项一致', () => {
    const atoms = ['a', ' ', '\n', '\r', '"', '“', '”', '「', '」', '`', '\\', '\\\\', '`x`', '.'];
    let seed = 7;
    const rnd = (m: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % m;
    };
    for (let n = 0; n < 5000; n++) {
      let src = '';
      for (let j = 1 + rnd(24); j > 0; j--) src += atoms[rnd(atoms.length)];
      for (const pairs of [EN, ZH]) {
        assert.deepEqual(opaqueRanges(src, pairs), referenceRanges(src, pairs), JSON.stringify(src));
      }
    }
  });
});

describe('opaqueRanges 不逐字符走普通文本', () => {
  it('正则只在开引号 / 反引号处落脚：exec 次数 = 特殊字符数 + 1，与文本长度无关', () => {
    // EN 的开引号正则：字符集 = 开引号 + 反引号（与 openerRegex 同一缓存键）
    const re = charClassRegex('"“`');
    let calls = 0;
    const exec = re.exec;
    re.exec = function (this: RegExp, s: string) {
      calls++;
      return exec.call(this, s);
    };
    try {
      const plain = 'If a is greater than b. '.repeat(20000);
      calls = 0;
      assert.deepEqual(opaqueRanges(plain, EN), []);
      assert.equal(calls, 1, '无引号的长文本只应 exec 一次（直接找不到）——逐字符扫描退回了');

      const mixed = 'If `a` is "x". '.repeat(1000);
      calls = 0;
      assert.equal(opaqueRanges(mixed, EN).length, 2000);
      // 每段 2 处落脚（反引号对、字符串开引号；闭引号走 indexOf），末尾 1 次找不到
      assert.equal(calls, 2001);
    } finally {
      re.exec = exec;
    }
  });
});
