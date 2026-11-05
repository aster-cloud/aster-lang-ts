/**
 * 函数返回类型按每条返回路径检查（aster-lang-ts#283，与 aster-lang-core#239 同步）。
 *
 * 曾经只比较函数体块的单一结果类型：无 Otherwise 的 If 里的提前 Return 不与声明返回类型比对，
 * 且 E003 的 span 为整个函数体（编辑器标在第 1 行）。现在每条 Return 都按可赋值规则
 * （Unknown / 按名推断 / Int → Float、Decimal 拓宽放行）与声明类型比较，E003 落在该 Return 行。
 * 夹具 test/fixtures/return-paths/return-paths-fixtures.json 与 core 仓同一份，errors 为 [code, 1 起行号]。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileAndTypecheck, EN_US } from '../../../src/browser.js';

interface Fixture { name: string; source: string; success: boolean; errors: [string, number][] }
interface Diag { severity?: string; code: string; span?: { start: { line: number } } }

const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'test', 'fixtures', 'return-paths', 'return-paths-fixtures.json'), 'utf8'),
);

function errorsOf(source: string): [string, number][] {
  const r = compileAndTypecheck(source, { lexicon: EN_US });
  return [...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? []), ...(r.typeErrors ?? [])]
    .map((d) => d as Diag)
    .filter((d) => d.severity === 'error' || d.severity === undefined)
    .map((d): [string, number] => [d.code, d.span?.start.line ?? -1]);
}

describe('#283 每条返回路径与声明返回类型比对（共享夹具）', () => {
  for (const fx of FIXTURES) {
    it(fx.name, () => {
      const errors = errorsOf(fx.source);
      assert.equal(errors.length === 0, fx.success, `success 不符：${JSON.stringify(errors)}`);
      assert.deepEqual(errors, fx.errors);
    });
  }
});

describe('#283 其他返回路径', () => {
  it('Match 分支中的错误 Return 报 E003 于该行', () => {
    const src =
      'Module m.\nRule r given x as Int, produce Int:\n  Match x:\n    When 1, Return "one".\n    When n, Return 0.\n';
    const e3 = errorsOf(src).filter(([c]) => c === 'E003');
    assert.deepEqual(e3.map(([, l]) => l), [4]);
  });

  it('If…Otherwise 两支类型不同：E008 与 E003 都有行号（不落在第 1 行）', () => {
    const src =
      'Module m.\nRule r given x as Int, produce Int:\n  If x greater than 1\n    Return 1.\n  Otherwise\n    Return "a".\n';
    const errs = errorsOf(src);
    assert.ok(errs.some(([c]) => c === 'E008'), JSON.stringify(errs));
    assert.ok(errs.some(([c, l]) => c === 'E003' && l === 6), JSON.stringify(errs));
    assert.ok(errs.every(([, l]) => l > 1), JSON.stringify(errs));
  });

  it('workflow step 内的 Return 是 step 结果，不与规则声明类型比较', () => {
    const src =
      'Module m.\nRule r given n as Int, produce Int. It performs io:\n  workflow:\n' +
      '    step first:\n      Return ok of n.\n  .\n  Return n.\n';
    assert.deepEqual(errorsOf(src), []);
  });

  it('lambda 内的 Return 不与外层规则的声明类型比较', () => {
    const src =
      'Module m.\nRule r given x as Int, produce Int:\n  Let f be function with s as Text, produce Text:\n    Return s.\n  Return 0.\n';
    assert.deepEqual(errorsOf(src), []);
  });
});
