/**
 * zh-CN 函数头语法糖 `规则 名（参数）：`（aster-lang-ts#236）。
 *
 * 变换器输出须与 Java 逐字一致：chinese-function-syntax-parity.json 由 aster-lang-locales 的
 * ChineseFunctionSyntaxTransformerTest.FuzzSource 生成输入、Java 变换器（含字符串分段）给出期望输出。
 * 经完整编译管线后，括号写法的参数与返回类型须与 `给定 … 作为 …` 写法相同。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyTransformers } from '../../../src/frontend/transformers.js';
import { compile } from '../../../src/browser.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';

const ZH_QUOTES = { open: '「', close: '」' };
// 编译后从 dist/test/unit/canonicalizer 运行：上溯 4 级到仓库根
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PARITY = JSON.parse(
  readFileSync(join(repoRoot, 'test', 'fixtures', 'chinese-function-syntax-parity.json'), 'utf8'),
) as Array<[string, string]>;
const rewrite = (source: string): string =>
  applyTransformers(source, ['chinese-function-syntax'], ZH_QUOTES);

function header(source: string): unknown {
  const result = compile(source, { lexicon: ZH_CN });
  assert.ok(result.success, `应能编译：${JSON.stringify(result.parseErrors ?? result)}`);
  const func = result.core!.decls[0] as { params: unknown; ret: unknown };
  return { params: func.params, ret: func.ret };
}

describe('chinese-function-syntax 变换器（与 Java 逐字一致）', () => {
  const cases: Array<[string, string]> = [
    ['规则 greet(name: Text):', 'Rule greet given name: Text :'],
    ['规则 hello():', 'Rule hello :'],
    ['  规则 greet(name: Text):', '  Rule greet given name: Text :'],
    ['规则 add(a: Int, b: Int):', 'Rule add given a: Int, b: Int :'],
    ['规则 计算（甲: 整数）：', 'Rule 计算 given 甲: 整数 ：'],
    ['规则 你好（）：', 'Rule 你好 ：'],
    ['规则 计算（甲: 整数):', 'Rule 计算 given 甲: 整数 :'],
    ['规则　折扣（甲 作为 整数）：', 'Rule 折扣 given 甲 作为 整数 ：'],
    ['规则 折扣（甲 作为 整数，乙 作为 整数），产出 整数：', 'Rule 折扣 given 甲 作为 整数，乙 作为 整数 ，产出 整数：'],
    ['\n  \n规则 折扣（甲 作为 整数）：\n', '\n  \nRule 折扣 given 甲 作为 整数 ：\n'],
    ['令 x 为 10', '令 x 为 10'],
  ];
  for (const [input, expected] of cases) {
    it(JSON.stringify(input), () => assert.equal(rewrite(input), expected));
  }

  it('参数跨行时照旧重排：首尾换行被 trim 掉', () => {
    assert.equal(rewrite('规则 折扣（\n  甲 作为 整数）：'), 'Rule 折扣 given 甲 作为 整数 ：');
  });

  it('★Java 生成的随机夹具逐条字节一致（含 NEL、U+2028/2029、NBSP、BOM、CRLF）', () => {
    assert.ok(PARITY.length >= 400);
    const diffs = PARITY.filter(([input, expected]) => rewrite(input) !== expected);
    assert.deepEqual(diffs, []);
  });

  it('字符串字面量内的函数头（含自成一行的多行字符串）不改写', () => {
    assert.equal(
      rewrite('规则 doc(x: Text):\n  返回 「\n规则 fake(y: Int):\n」。'),
      'Rule doc given x: Text :\n  返回 「\n规则 fake(y: Int):\n」。',
    );
  });

  it('★大量空白行或未闭合函数头时耗时线性（防正则二次回溯）', () => {
    // 旧的 Java 模式在这两类输入上分别约 54 秒与 10 秒；5 秒上限留足并行负载余量。
    const blank = ' \n'.repeat(64_000);
    const unclosed = '规则 a(\n'.repeat(16_000);
    const start = Date.now();
    assert.equal(rewrite(blank), blank);
    assert.equal(rewrite(unclosed), unclosed);
    // 末尾有右括号时不走截断捷径，仍须线性。
    assert.equal(rewrite(`${blank})`), `${blank})`);
    assert.ok(rewrite(`${unclosed})`).startsWith('Rule a given '));
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5_000, `线性实现应在 5 秒内完成，实际 ${elapsed} ms`);
  });
});

describe('zh-CN 编译管线接受括号函数头', () => {
  const body = '\n  返回 甲。\n';
  it('全角括号多参数并带产出类型，与 给定 写法的 Core 函数头相同', () => {
    assert.deepEqual(
      header(`模块 测试。\n\n规则 折扣（甲 作为 整数，乙 作为 整数），产出 整数：${body}`),
      header(`模块 测试。\n\n规则 折扣 给定 甲 作为 整数，乙 作为 整数，产出 整数：${body}`),
    );
  });

  it('半角括号单参数', () => {
    assert.deepEqual(
      header(`模块 测试。\n\n规则 折扣(甲 作为 整数):${body}`),
      header(`模块 测试。\n\n规则 折扣 给定 甲 作为 整数：${body}`),
    );
  });

  it('无参数', () => {
    const result = compile('模块 测试。\n\n规则 你好（）：\n  返回 1。\n', { lexicon: ZH_CN });
    assert.ok(result.success, JSON.stringify(result.parseErrors));
  });

  it('字符串内容不受影响', () => {
    const result = compile('模块 测试。\n\n规则 折扣（甲 作为 整数）：\n  返回 「规则 假（乙）：」。\n', { lexicon: ZH_CN });
    assert.ok(result.success, JSON.stringify(result.parseErrors));
  });
});
