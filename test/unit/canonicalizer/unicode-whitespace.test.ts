// 词法空白只认 ASCII（aster-cloud/aster-lang-ts#348）。
//
// 规则（与 aster-lang-core Canonicalizer + AsterLexer 对齐）：
//   1. 词法空白只有 U+0020 与 \t（\t 先展开成两个空格），换行只有 \n、\r、\r\n。
//   2. 规范化时「去行尾空白」「去标点前空白」按 Java `\s` 的 ASCII 集合 [ \t\n\x0B\f\r] 判断，
//      「清空只含空白的行」「整行注释」按 [ \t] 判断；U+00A0、U+2000–U+200A、U+202F、U+205F、
//      U+1680、U+2028/2029、U+FEFF（非开头）等 Unicode 空白一律保留给词法器，报 E050。
//   3. zh-CN 的全角转半角把 U+3000 换成 U+0020（字符串字面量外），所以 zh-CN 里 U+3000 照常是空白；
//      其余词法表里 U+3000 同样报 E050。
//   4. 字符串字面量与注释里的任何空白原样保留、不报错。
//
// 此前 ts 在行尾 / 只含空白的行 / 标点前 / 整行注释前 / 只含空白的源码上用 JS `\s`（含 Unicode 空白）
// 把这些字符吞掉，于是同一份源码 ts（编辑器 / LSP）编译通过、Java（生产 aster-api）报 E050。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { DiagnosticError } from '../../../src/diagnostics/diagnostics.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

/** 第一条解析错误的 [码, 行, 列]；通过时为 'ok'。 */
function firstError(source: string, lexicon: Lexicon): 'ok' | [string, number, number] {
  try {
    const parsed = parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon);
    const d = parsed.diagnostics.find(x => x.severity === 'error');
    return d ? [d.code, d.span.start.line, d.span.start.col] : 'ok';
  } catch (e) {
    if (e instanceof DiagnosticError) {
      const d = e.diagnostic;
      return [d.code, d.span.start.line, d.span.start.col];
    }
    throw e;
  }
}

/** 不是词法空白的 Unicode 空白（JS `\s` 命中、Java ASCII `\s` 不命中）。 */
const NON_ASCII_SPACES: ReadonlyArray<readonly [string, string]> = [
  ['U+00A0', '\u00A0'], ['U+1680', '\u1680'], ['U+2000', '\u2000'], ['U+2001', '\u2001'],
  ['U+2002', '\u2002'], ['U+2003', '\u2003'], ['U+2004', '\u2004'], ['U+2005', '\u2005'],
  ['U+2006', '\u2006'], ['U+2007', '\u2007'], ['U+2008', '\u2008'], ['U+2009', '\u2009'],
  ['U+200A', '\u200A'], ['U+2028', '\u2028'], ['U+2029', '\u2029'], ['U+202F', '\u202F'],
  ['U+205F', '\u205F'], ['U+FEFF', '\uFEFF'],
];

/** 每个词法表一份合法源码模板；`{X}` 为插入位置，缺省为空串。 */
const TEMPLATES: ReadonlyArray<readonly [string, Lexicon, (at: Record<string, string>) => string]> = [
  ['en-US', EN_US, at => [
    `Module t.ws.`, `${at.L ?? ''}`, `${at.P ?? ''}# a b`,
    `Rule f given x as Int${at.M ?? ''}, produce Text${at.K ?? ''}:`,
    `  Let y be x plus 1${at.D ?? ''}.${at.E ?? ''}`, `  Return "a${at.S ?? ' '}b".`, `${at.Z ?? ''}`,
  ].join('\n')],
  ['zh-CN', ZH_CN, at => [
    `模块 测试.空白。`, `${at.L ?? ''}`, `${at.P ?? ''}# 甲 乙`,
    `规则 计算 给定 数量 作为 整数${at.M ?? ''}，产出 文本${at.K ?? ''}：`,
    `  令 总数 定义为 数量 加上 1${at.D ?? ''}。${at.E ?? ''}`, `  返回 「甲${at.S ?? ' '}乙」。`, `${at.Z ?? ''}`,
  ].join('\n')],
  ['de-DE', DE_DE, at => [
    `Modul t.ws.`, `${at.L ?? ''}`, `${at.P ?? ''}# a b`,
    `Regel f gegeben x als Ganzzahl${at.M ?? ''}, liefert Text${at.K ?? ''}:`,
    `  sei y gleich x plus 1${at.D ?? ''}.${at.E ?? ''}`, `  gib zurueck "a${at.S ?? ' '}b".`, `${at.Z ?? ''}`,
  ].join('\n')],
  ['hi-IN', HI_IN, at => [
    `मॉड्यूल t।`, `${at.L ?? ''}`, `${at.P ?? ''}# a b`,
    `नियम f दिया गया राशि रूप में पूर्णांक${at.M ?? ''}, उत्पन्न पाठ${at.K ?? ''}:`,
    `  मानें y हो राशि जोड़ 1${at.D ?? ''}।${at.E ?? ''}`, `  लौटाएं "a${at.S ?? ' '}b"।`, `${at.Z ?? ''}`,
  ].join('\n')],
];

/** 位置 → [占位符, 期望的报错行]。 */
const REJECT_POSITIONS: ReadonlyArray<readonly [string, string, number]> = [
  ['只含该字符的空行', 'L', 2],
  ['整行注释之前', 'P', 3],
  ['逗号之前', 'M', 4],
  ['冒号之前', 'K', 4],
  ['句末符之前', 'D', 5],
  ['行尾', 'E', 5],
  ['文件末尾（最后一个换行之后）', 'Z', 7],
];

describe('词法空白只认 ASCII（aster-lang-ts#348）', () => {
  for (const [lexName, lexicon, tpl] of TEMPLATES) {
    describe(lexName, () => {
      it('模板本身合法', () => assert.equal(firstError(tpl({}), lexicon), 'ok'));

      for (const [name, ch] of NON_ASCII_SPACES) {
        // 开头的 U+FEFF 是 BOM（两引擎都跳过），只含它的源码见下方 BOM 用例
        if (ch !== '\uFEFF') {
          it(`只含 ${name} 的源码报 E050（1:1）`, () => {
            assert.deepEqual(firstError(`${ch}\n`, lexicon), ['E050', 1, 1]);
            assert.deepEqual(firstError(ch, lexicon), ['E050', 1, 1]);
          });
        }
        for (const [where, key, line] of REJECT_POSITIONS) {
          // U+FEFF 只在文件开头算 BOM；其余位置它只是普通字符
          it(`${name} 在${where}报 E050（第 ${line} 行）`, () => {
            const got = firstError(tpl({ [key]: ch }), lexicon);
            assert.ok(Array.isArray(got), `应报错，实际通过`);
            assert.deepEqual(got.slice(0, 2), ['E050', line]);
          });
        }
        it(`${name} 在字符串字面量内照常通过`, () => assert.equal(firstError(tpl({ S: ch }), lexicon), 'ok'));
      }

      it('U+3000 与 Unicode 空白在注释正文里照常通过', () => {
        const src = tpl({}).replace('# a b', '# a\u3000\u00A0\u2028b').replace('# 甲 乙', '# 甲\u3000\u00A0乙');
        assert.equal(firstError(src, lexicon), 'ok');
      });

      for (const [name, ch] of [['VT', '\u000B'], ['FF', '\u000C']] as const) {
        // Java `\s` 含 \x0B \f：行尾与标点前照常去掉（只含它们的行不清空，词法器报 E050）
        it(`${name} 在行尾与句末符、逗号、冒号之前照常去掉`, () => {
          for (const key of ['E', 'D', 'M', 'K']) {
            assert.equal(firstError(tpl({ [key]: ch }), lexicon), 'ok', `位置 ${key}`);
          }
        });
        it(`只含 ${name} 的行报 E050`, () => {
          assert.deepEqual(firstError(tpl({ L: ch }), lexicon), ['E050', 2, 1]);
        });
      }
    });
  }

  describe('U+3000（表意空格）', () => {
    it('zh-CN 在字符串外换成半角空格：各位置照常通过', () => {
      const [, , tpl] = TEMPLATES[1]!;
      for (const key of ['L', 'P', 'M', 'K', 'D', 'E', 'Z']) {
        assert.equal(firstError(tpl({ [key]: '\u3000' }), ZH_CN), 'ok', `位置 ${key}`);
      }
      assert.equal(firstError('\u3000\n', ZH_CN), 'ok');
      assert.equal(firstError('模块\u3000测试。\n\n规则\u3000计算，产出\u3000整数：\n\u3000\u3000返回\u30001。\n', ZH_CN), 'ok');
    });

    for (const [lexName, lexicon, tpl] of TEMPLATES.filter(([n]) => n !== 'zh-CN')) {
      it(`${lexName} 不做全角转半角：U+3000 在 token 之间、行尾、只含它的源码都报 E050`, () => {
        assert.deepEqual(firstError('\u3000\n', lexicon), ['E050', 1, 1]);
        for (const [, key, line] of REJECT_POSITIONS) {
          const got = firstError(tpl({ [key]: '\u3000' }), lexicon);
          assert.ok(Array.isArray(got));
          assert.deepEqual(got.slice(0, 2), ['E050', line], `位置 ${key}`);
        }
      });
    }
  });

  it('开头的 U+FEFF 仍是 BOM：跳过、不报错', () => {
    assert.equal(firstError('\uFEFFModule t.ws.\n', EN_US), 'ok');
    assert.equal(firstError('\uFEFF', EN_US), 'ok');
  });

  it('ASCII 空白（空格、\\t、\\r\\n）行为不变', () => {
    assert.equal(firstError('Module t.ws.  \r\n \t \r\n\r\nRule f, produce Int:\t\r\n  Return 1 .  \r\n', EN_US), 'ok');
    assert.equal(firstError(' \t\n', EN_US), 'ok');
  });

  it('只含该字符的空行：canonicalize 原样保留 U+00A0，不再清空', () => {
    assert.equal(canonicalize('Module a.\n\u00A0\nRule f, produce Int:\n  Return 1.\u00A0\n', EN_US),
      'Module a.\n\u00A0\nRule f, produce Int:\n  Return 1.\u00A0\n');
  });
});
