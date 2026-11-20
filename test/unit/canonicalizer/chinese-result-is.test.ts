/**
 * zh-CN `结果为 X` → `Return X`（aster-lang-ts#357 第 4 行、#362 第 4 项）。
 *
 * Java 侧先把 `结果为` 译成 `the result is`，再由 core `result-is` 在行首与逗号之后改写成 `Return`；本引擎的
 * `chinese-result-is` 在同样两处改写，经完整编译管线后与 `返回 X` 的 Core 相同。空白只认 ASCII 空格、tab 与 U+3000，不跨行。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyTransformers } from '../../../src/frontend/transformers.js';
import { compile } from '../../../src/browser.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';

const rewrite = (source: string): string => applyTransformers(source, ['chinese-result-is'], { open: '「', close: '」' });

/** 去掉 origin 后的 Core（两种写法的源码列不同）。 */
function core(source: string): unknown {
  const result = compile(source, { lexicon: ZH_CN });
  assert.ok(result.success, `应能编译：${JSON.stringify(result.parseErrors ?? result)}`);
  return JSON.parse(JSON.stringify(result.core, (k, v) => (k === 'origin' ? undefined : v)));
}

const HEAD = '模块 p。\n\n规则 f 给定 x 作为 整数，产出 整数：\n';

describe('chinese-result-is 变换器', () => {
  const cases: Array<[string, string]> = [
    ['结果为 42', 'Return 42'],
    ['  结果为 x + y', '  Return x + y'],
    ['\t结果为\tx', '\tReturn x'],
    ['\u3000\u3000结果为\u3000x', '\u3000\u3000Return x'],
    ['    当 1, 结果为 2', '    当 1, Return 2'],
    ['    当 1,结果为 2', '    当 1,Return 2'],
    ['\n\n  结果为 x', '\n\n  Return x'],
  ];
  for (const [input, expected] of cases) {
    it(JSON.stringify(input), () => assert.equal(rewrite(input), expected));
  }

  it('其他 Unicode 空白、VT、FF 与换行不当空白，不改写（aster-lang-locales#147）', () => {
    for (const input of ['结果为\u00A0x', '结果为\u2003x', '结果为\u000Bx', '结果为\fx', '结果为\nx', '\u00A0结果为 x', '当 1,\u2003结果为 2']) {
      assert.equal(rewrite(input), input, JSON.stringify(input));
    }
  });

  it('只在行首与逗号之后改写；紧贴标识符或在字符串里不改写', () => {
    for (const input of ['返回 甲结果为 x', '结果为x', '返回 「结果为 X」', '令 y 为 结果为 x']) {
      assert.equal(rewrite(input), input, JSON.stringify(input));
    }
  });
});

describe('zh-CN 编译管线接受 结果为', () => {
  it('语句：与 返回 的 Core 相同（ASCII 空格、tab、U+3000）', () => {
    const expected = core(`${HEAD}  返回 x。\n`);
    for (const ws of [' ', '\t', '\u3000']) assert.deepEqual(core(`${HEAD}  结果为${ws}x。\n`), expected, JSON.stringify(ws));
  });

  it('Match 分支：逗号之后与块内都与 返回 相同', () => {
    const expected = core(`${HEAD}  匹配于 x：\n    当 1，返回 2。\n    当 y，返回 3。\n`);
    assert.deepEqual(core(`${HEAD}  匹配于 x：\n    当 1，结果为 2。\n    当 y，结果为 3。\n`), expected);
    assert.deepEqual(
      core(`${HEAD}  匹配于 x：\n    当 1，\n      结果为 2。\n    当 y，\n      结果为 3。\n`),
      core(`${HEAD}  匹配于 x：\n    当 1，\n      返回 2。\n    当 y，\n      返回 3。\n`),
    );
  });

  it('结果为 之后是 NBSP 时报 E050', () => {
    const result = compile(`${HEAD}  结果为\u00A0x。\n`, { lexicon: ZH_CN });
    assert.equal(result.success, false);
    assert.equal(result.parseErrors?.[0]?.code, 'E050');
  });
});
