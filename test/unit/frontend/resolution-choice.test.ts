/**
 * 源码声明表的候选选择（chooseDecl / chooseDeclAcross）：语义与逐项扫描一致，且按表建索引——
 * 重复查找不再逐项读取、折叠整张表（否则名称解析随声明数平方增长，见 #258）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chooseDecl, chooseDeclAcross } from '../../../src/frontend/resolution-choice.js';
import type { Entry } from '../../../src/frontend/resolution-choice.js';

const fn = (written: string, canonical = written): Entry => ({ written, canonical, role: 'FUNC_REF' });
const ty = (written: string, canonical = written): Entry => ({ written, canonical, role: 'TYPE' });

describe('chooseDecl 语义', () => {
  it('精确命中写法或规范名', () => {
    const table = [ty('Fahrer', 'Driver'), fn('pruefe')];
    assert.deepEqual(chooseDecl(table, 'Fahrer'), { kind: 'hit', entry: table[0] });
    assert.deepEqual(chooseDecl(table, 'Driver'), { kind: 'hit', entry: table[0] });
  });

  it('无精确时折叠唯一命中；同层多个规范名即歧义', () => {
    const table = [fn('hoch'), ty('Stufe', 'Level')];
    assert.deepEqual(chooseDecl(table, 'HOCH'), { kind: 'hit', entry: table[0] });
    const clash = [fn('hoch'), ty('Hoch', 'High')];
    assert.deepEqual(chooseDecl(clash, 'hoch'), { kind: 'hit', entry: clash[0] }, '精确优先于折叠');
    assert.deepEqual(chooseDecl(clash, 'HOCH'), { kind: 'ambiguous', candidates: [clash[0], clash[1]] });
  });

  it('NFC：分解形式的写法与组合形式的声明精确命中', () => {
    const table = [fn('prüfe')];
    assert.deepEqual(chooseDecl(table, 'prüfe'), { kind: 'hit', entry: table[0] });
  });

  it('未命中返回 miss', () => {
    assert.equal(chooseDecl([fn('a')], 'b').kind, 'miss');
    assert.equal(chooseDecl([], 'b').kind, 'miss');
  });

  it('声明表追加后查找可见新项（解析中表只追加）', () => {
    const table: Entry[] = [fn('a')];
    assert.equal(chooseDecl(table, 'b').kind, 'miss');
    table.push(fn('b'));
    assert.deepEqual(chooseDecl(table, 'b'), { kind: 'hit', entry: table[1] });
  });

  it('chooseDeclAcross 与拼接后的 chooseDecl 结果相同（含候选顺序）', () => {
    const functions = [fn('hoch'), fn('rate')];
    const types = [ty('Hoch', 'High'), ty('Rate'), ty('Fahrer', 'Driver')];
    for (const w of ['hoch', 'HOCH', 'Rate', 'rate', 'RATE', 'driver', 'Fahrer', 'nichts']) {
      assert.deepEqual(chooseDeclAcross([functions, types], w), chooseDecl([...functions, ...types], w), w);
    }
  });
});

describe('chooseDecl 复杂度', () => {
  it('★同一张表重复查找：不再读取未命中项（索引按表缓存）', () => {
    let reads = 0;
    const counted = (i: number): Entry => ({
      get written() { reads += 1; return `rule${i}`; },
      get canonical() { reads += 1; return `rule${i}`; },
      role: 'FUNC_REF',
    });
    const table = Array.from({ length: 500 }, (_, i) => counted(i));
    chooseDecl(table, 'rule0');
    reads = 0;
    for (let i = 0; i < 100; i++) chooseDecl(table, `rule${i}`);
    // 每次查找只会读到命中的那一项（choose 去重时读规范名），与表长无关
    assert.ok(reads <= 100 * 2, `重复查找读取了 ${reads} 次声明字段`);
  });
});
