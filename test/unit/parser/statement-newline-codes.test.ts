/**
 * 声明头与语句中间的换行与 core 同码同位置（aster-lang-ts#357 第 3 行，ADR 0056 修订 A4 §2，Wave C 裁决 D4）。
 *
 * 声明头：core 的 ANTLR 先试单 token 删除，换行之后同列续写此处可接受的记号报 E061，缩进、空行、文件末或不可接受的记号报 E062；
 * 这些都在共享夹具 shared/parse_diagnostics_parity.json 里与 core 逐例对照。
 *
 * 语句中间：core 报的第一条诊断是 E063，语句关键词之后直接换行时报在关键词处，其余报在换行处。core 的级联里有时还跟一条
 * 非 E063 的诊断（如 `Let y be` ⏎ 在 `be` 处另报 E062），共享夹具「取第一条非 E063」的判定会选中它，所以这几例不进共享夹具，
 * 在这里按 core 的第一条诊断（生产 aster-api 首先报出的那条）断言码与位置。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { DiagnosticError } from '../../../src/diagnostics/diagnostics.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

function firstError(source: string, lexicon: Lexicon = EN_US): { code: string; line: number; col: number; params: unknown } {
  try {
    const parsed = parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon);
    const d = parsed.diagnostics.find((x) => x.severity === 'error');
    assert.ok(d, '应有解析错误');
    return { code: d.code, line: d.span.start.line, col: d.span.start.col, params: d.params };
  } catch (e) {
    if (!(e instanceof DiagnosticError)) throw e;
    const d = e.diagnostic;
    return { code: d.code, line: d.span.start.line, col: d.span.start.col, params: d.params };
  }
}

const HEAD = 'Module m.\n\nRule f given x as Int, produce Int:\n';

describe('语句中间的换行：与 core 第一条诊断同为 E063', () => {
  const cases: Array<[string, string, number, number]> = [
    ['Let y be ⏎ x：报在换行处', `${HEAD}  Let y be\n  x.\n  Return y.\n`, 4, 11],
    ['Let y be 之后文件结束', `${HEAD}  Let y be\n`, 4, 11],
    ['Return f( ⏎ x)：报在换行处', `${HEAD}  Return f(\n  x).\n`, 4, 12],
    ['Return ⏎ x：报在 Return 处', `${HEAD}  Return\n  x.\n`, 4, 3],
    ['Return ⏎ 更深缩进的 x：仍报在 Return 处', `${HEAD}  Return\n    x.\n`, 4, 3],
    ['Let ⏎ y be x：报在 Let 处', `${HEAD}  Let\n  y be x.\n  Return y.\n`, 4, 3],
    ['If ⏎ 条件：报在 If 处', `${HEAD}  If\n  x > 1:\n    Return 1.\n  Return x.\n`, 4, 3],
    ['Match ⏎ x：报在 Match 处', `${HEAD}  Match\n  x:\n    When 1, Return 1.\n  Return x.\n`, 4, 3],
  ];
  for (const [name, source, line, col] of cases) {
    it(name, () => {
      const d = firstError(source);
      assert.deepEqual({ code: d.code, line: d.line, col: d.col }, { code: 'E063', line, col });
      assert.deepEqual(d.params, { token: 'token.newline' });
    });
  }

  it('zh-CN 返回 ⏎ 同样报在 返回 处', () => {
    const d = firstError('模块 m。\n\n规则 f 给定 x 作为 整数，产出 整数：\n  返回\n  x。\n', ZH_CN);
    assert.deepEqual({ code: d.code, line: d.line, col: d.col }, { code: 'E063', line: 4, col: 3 });
  });

  it('续行的二元运算不受影响（运算符之后换行同列续写仍可解析）', () => {
    const parsed = parseWithLexicon(lex(canonicalize(`${HEAD}  Let y be x plus\n  1.\n  Return y.\n`, EN_US), EN_US), EN_US);
    assert.equal(parsed.diagnostics.filter((d) => d.severity === 'error').length, 0);
  });
});

describe('实参表逗号之后的换行：与 core 同码（core 实测）', () => {
  const cases: Array<[string, string]> = [
    ['x).', 'E061'], ['-1).', 'E061'], ['(x)).', 'E061'], ['not x).', 'E061'], ['Foo).', 'E061'],
    ['.', 'E062'], [':', 'E062'], [', x).', 'E062'], [').', 'E062'], ['"a").', 'E062'],
  ];
  for (const [next, code] of cases) {
    it(`换行后同列写 ${next} → ${code}`, () => {
      const d = firstError(`${HEAD}  Return f(x,\n  ${next}\n`);
      assert.deepEqual([d.code, d.line, d.col], [code, 4, 14]);
    });
  }
});

describe('合法的续行不受影响（zh-CN / de-DE）', () => {
  const ok = (source: string, lexicon: Lexicon): void => {
    const parsed = parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon);
    assert.deepEqual(parsed.diagnostics.filter((d) => d.severity === 'error'), []);
  };
  it('zh-CN 运算符之后换行续写', () => {
    ok('模块 m。\n\n规则 f 给定 x 作为 整数，产出 整数：\n  令 y 定义为 x 加上\n  1。\n  返回 y。\n', ZH_CN);
  });
  it('de-DE 运算符之后换行续写', () => {
    ok('Modul m.\n\nRegel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei y gleich x plus\n  1.\n  gib zurueck y.\n', DE_DE);
  });
});

describe('声明头里的换行：E061 / E062 的分界', () => {
  it('同列续写可接受的记号为 E061（参数为 token.newline），否则 E062', () => {
    const e061 = firstError('Module m.\n\nRule f given x as Int\nproduce Int:\n  Return x.\n');
    assert.deepEqual([e061.code, e061.line, e061.col, e061.params], ['E061', 3, 22, { token: 'token.newline' }]);
    const e062 = firstError('Module m.\n\nRule f given x as Int\nReturn x.\n');
    assert.deepEqual([e062.code, e062.line, e062.col], ['E062', 3, 22]);
  });

  it('参数表逗号之后换行写下一个参数（core 只认逗号后接 produce）为 E062', () => {
    const d = firstError('Module m.\n\nRule f given x as Int,\ny as Int, produce Int:\n  Return x.\n');
    assert.deepEqual([d.code, d.line], ['E062', 3]);
  });
});
