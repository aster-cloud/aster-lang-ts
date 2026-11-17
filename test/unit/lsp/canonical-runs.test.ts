/**
 * 规范化段的原文位置由探针证明（canonical-runs.ts）：证明不了时给 undefined，不猜位置。
 * recanonicalize 用可控的假规范化器，直接构造「同形词被删」「行间串扰」「抛错」等情形。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { proveRunSources, sameWordUnder } from '../../../src/lsp/canonical-runs.js';
import { literalMacroRuns } from '../../../src/frontend/canonicalizer.js';

const same = sameWordUnder((w) => w);
/** 假规范化器：删掉后面紧跟另一个词的 `a`（冠词），其余原样 */
const dropArticles = (s: string): string => s.replace(/\ba (?=[\p{L}_])/gu, '');

describe('proveRunSources', () => {
  it('★被删的同形词不算：`Return a a.` 的段 a 对应第二个 a', () => {
    const src = 'Return a a.';
    const can = dropArticles(src);
    assert.equal(can, 'Return a.');
    assert.deepEqual(proveRunSources(src, can, dropArticles, [{ line: 1, col: 7 }], same), [[9, 10]]);
  });

  it('多行：只有出错的行逐个探测，其余行一次证明', () => {
    const src = 'x a\nReturn a a.\nb a';
    const can = dropArticles(src);
    const found = proveRunSources(src, can, dropArticles, [{ line: 1, col: 2 }, { line: 2, col: 7 }, { line: 3, col: 2 }], same);
    assert.deepEqual(found, [[2, 3], [13, 14], [18, 19]]);
  });

  it('目标不在段起点、规范化行数不符、规范化抛错时一律 undefined', () => {
    assert.deepEqual(proveRunSources('ab c', 'ab c', (s) => s, [{ line: 1, col: 1 }], same), [undefined]);
    assert.deepEqual(proveRunSources('a\nb', 'a b', (s) => s, [{ line: 1, col: 0 }], same), [undefined]);
    const boom = (): string => { throw new Error('x'); };
    assert.deepEqual(proveRunSources('a', 'a', boom, [{ line: 1, col: 0 }], same), [undefined]);
  });

  it('★本行文字来自别处（探针没出现在本行）时不予证明', () => {
    // 假规范化器：第二行总是第一行的副本，第二行原文的词从不进入输出
    const copy = (s: string): string => {
      const [l1] = s.split('\n');
      return `${l1}\n${l1}`;
    };
    assert.deepEqual(proveRunSources('a\na', 'a\na', copy, [{ line: 2, col: 0 }], same), [undefined]);
  });

  it('★哪个候选都证明不了时不选（不猜）', () => {
    // 假规范化器：相邻重复词只留一个——任一处换成探针后不再重复，段数总对不上
    const dedupe = (s: string): string => s.replace(/\b(\w+) \1\b/g, '$1');
    assert.equal(dedupe('x x'), 'x');
    assert.deepEqual(proveRunSources('x x', 'x', dedupe, [{ line: 1, col: 0 }], same), [undefined]);
  });
});

describe('proveRunSources：同一行同形候选数不受轮数上限影响', () => {
  it('★一行 30 组 `a a` 共 60 个候选：每段都对应各组的第二个 a', () => {
    const src = `Return ${Array.from({ length: 30 }, () => 'a a').join(', ')}.`;
    const can = dropArticles(src);
    const targets = [...can.matchAll(/\ba\b/g)].map((m) => ({ line: 1, col: m.index }));
    assert.equal(targets.length, 30);
    const found = proveRunSources(src, can, dropArticles, targets, same);
    const seconds = [...src.matchAll(/a a/g)].map((m) => [m.index + 2, m.index + 3]);
    assert.deepEqual(found, seconds);
  });

  // 假规范化器：删掉紧挨句号的 ` a`——被删的是同形词里靠后的那个，对齐假设（先跳过靠前的）必然猜错，
  // 只能逐个候选单独探测；12 个候选需要 12 轮，超过旧实现的 8 轮上限
  const dropLast = (s: string): string => s.replace(/ a(?=\.)/g, '');

  it('★对齐假设猜错时逐个探测，轮数不设上限：12 个同形候选全部证明', () => {
    const src = `x ${Array.from({ length: 12 }, () => 'a').join(' ')}.`;
    const can = dropLast(src);
    const targets = [...can.matchAll(/\ba\b/g)].map((m) => ({ line: 1, col: m.index }));
    assert.equal(targets.length, 11);
    const found = proveRunSources(src, can, dropLast, targets, same);
    assert.deepEqual(found, [...src.matchAll(/\ba\b/g)].slice(0, 11).map((m) => [m.index, m.index + 1]));
  });

  it('★探测预算耗尽时证明不了的一律 undefined（不猜、不截断成部分结果后冒充完整）', () => {
    const src = 'x a a.';
    const can = dropLast(src);
    assert.equal(can, 'x a.');
    const targets = [{ line: 1, col: 2 }];
    assert.deepEqual(proveRunSources(src, can, dropLast, targets, same, 0), [undefined]);
    assert.deepEqual(proveRunSources(src, can, dropLast, targets, same, src.length), [undefined]);
    assert.deepEqual(proveRunSources(src, can, dropLast, targets, same, 2 * src.length), [[2, 3]]);
  });
});

describe('literalMacroRuns', () => {
  it('按折叠键命中完整标识符，字符串内不算，偏移为 UTF-16', () => {
    const literals = new Map([['greeting', 'hi']]);
    const text = '😀 Greeting "greeting" greetings greeting.';
    const runs = literalMacroRuns(text, literals, { open: '"', close: '"' });
    assert.deepEqual(runs.map((r) => [r.offset, r.text, r.value]), [
      [text.indexOf('Greeting'), 'Greeting', 'hi'],
      [text.lastIndexOf('greeting'), 'greeting', 'hi'],
    ]);
  });
});
