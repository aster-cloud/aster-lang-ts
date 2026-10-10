/**
 * lossless 模式的 reflow：只整理记号之间的空白，不得改动字符串字面量、注释正文与语句结构。
 * LSP 默认格式化即 lossless + reflow，任何改动都会直接改写用户源码。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCstLossless } from '../../src/cst/cst_builder.js';
import { printCNLFromCst, printRangeFromCst } from '../../src/cst/cst_printer.js';
import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';

// 编译后从 dist/test/unit 运行：上溯 3 级到仓库根
const goldenDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'lossless', 'golden');

const reflow = (src: string): string => printCNLFromCst(buildCstLossless(src), { reflow: true });

function coreJson(src: string): string {
  const result = parse(lex(canonicalize(src)));
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join('; '));
  return JSON.stringify(lowerModule(result.ast), (k, v) => (k === 'origin' ? undefined : v));
}

describe('lossless reflow 只动记号之间的空白', () => {
  test('标点前同行空白、行尾空白、`. :` 与多余结尾换行被整理', () => {
    const src = 'Module m .  \n\nRule r given a as Int , produce Int . :  \n  Return a .\n\n\n';
    assert.equal(reflow(src), 'Module m.\n\nRule r given a as Int, produce Int:\n  Return a.\n');
  });

  test('字符串字面量原样保留', () => {
    const src = 'Module m.\n\nRule r, produce Text:\n  Return "Hi , there . : ! ?" .\n';
    assert.equal(reflow(src), 'Module m.\n\nRule r, produce Text:\n  Return "Hi , there . : ! ?".\n');
  });

  test('注释正文原样保留（只去行尾空白）', () => {
    const src = '// 注释 , 带空格 .   \nModule m.  // 行尾 : 注释\n';
    assert.equal(reflow(src), '// 注释 , 带空格 .\nModule m.  // 行尾 : 注释\n');
  });

  test('独占一行的句点（workflow 结束）不被拉到上一行', () => {
    const src = ['Module m.', '', 'Rule run, produce. It performs io:', '  workflow:', '    step only:',
      '      Return ok of 1.', '', '  .', ''].join('\n');
    assert.equal(reflow(src), src);
  });

  test('区间格式化同样不改字符串', () => {
    const src = 'Module m.\n\nRule r, produce Text:\n  Return "a , b" .\n';
    const cst = buildCstLossless(src);
    const start = src.indexOf('Return');
    assert.equal(printRangeFromCst(cst, start, src.length, { reflow: true }), 'Return "a , b".\n');
  });
});

describe('lossless golden', () => {
  const inputs = readdirSync(goldenDir).filter((f) => f.endsWith('.in.aster')).sort();
  for (const file of inputs) {
    test(file, () => {
      const src = readFileSync(join(goldenDir, file), 'utf8');
      const expected = readFileSync(join(goldenDir, file.replace(/\.in\.aster$/, '.out.aster')), 'utf8');
      assert.equal(printCNLFromCst(buildCstLossless(src)), src, '无 reflow 时须逐字节还原');
      // 与 scripts/test-lossless-golden 同一比较口径：忽略结尾空白与 CRLF
      const norm = (t: string): string => t.replace(/\r\n/g, '\n').replace(/\s+$/, '');
      assert.equal(norm(reflow(src)), norm(expected));
      assert.equal(coreJson(expected), coreJson(src), 'reflow 前后 Core IR 须相同');
    });
  }
});
