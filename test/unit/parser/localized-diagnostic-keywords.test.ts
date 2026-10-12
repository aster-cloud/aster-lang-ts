/**
 * @module test/unit/parser/localized-diagnostic-keywords.test
 *
 * 语法诊断里的**关键词槽位**用作者所写语言的拼写；用户的名字原样保留。
 *
 * 背景：parseWithLexicon 先把 zh/de 关键词翻译成英文 token 再解析，报错文案若写死
 * 英文关键词，作者看到的是从未写过的 'return'。修复在构造诊断时按上下文 lexicon
 * 显示关键词（parser/keyword-display）。本文件锁住三件事：
 *   1. 关键词槽位回译——同一条消息里的**每一个**关键词都回译（不是只改第一个）；
 *   2. 用户名字不被改写——类型名 Profile / Pattern 与规范关键词 profile / pattern 同形，
 *      必须保持原样（曾经的事后整句替换会把它改成「档案」「模式」）；
 *   3. en-US 文案逐字不变。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

function messages(src: string, lexicon: Lexicon): string {
  const tokens = lex(canonicalize(src, lexicon), lexicon);
  return parseWithLexicon(tokens, lexicon).diagnostics.map(d => d.message).join(' | ');
}

const ZH_HEADER = '模块 m。\n\n';

describe('语法诊断关键词槽位本地化', () => {
  it('zh：同一条消息里的两个关键词都回译', () => {
    const msg = messages(ZH_HEADER + '规则 r 给定 x 作为 整数 产出 整数：\n  如果 x 小于 0 那么 x。\n  返回 x。', ZH_CN);
    assert.strictEqual(msg, "Expected '返回' after '那么'");
  });

  it('de：同一错误用德语关键词', () => {
    const k = DE_DE.keywords;
    const src = [
      `${k.MODULE_DECL} m.`,
      '',
      `${k.FUNC_TO} r ${k.FUNC_GIVEN} x ${k.IMPORT_ALIAS} ${k.INT_TYPE}, ${k.FUNC_PRODUCE} ${k.INT_TYPE}:`,
      `  ${k.IF} x < 0 ${k.THEN} x.`,
      `  ${k.RETURN} x.`,
    ].join('\n');
    assert.strictEqual(messages(src, DE_DE), `Expected '${k.RETURN}' after '${k.THEN}'`);
  });

  it('en：文案逐字不变', () => {
    const msg = messages('Module m.\n\nRule r given x as Int, produce Int:\n  If x less than 0 then x.\n  Return x.', EN_US);
    assert.strictEqual(msg, "Expected 'return' after 'then'");
  });
});

describe('各关键词槽位（zh 逐条锁住，en 逐字不变）', () => {
  const ZH_RULE = ZH_HEADER + '规则 r 给定 x 作为 整数 产出 整数：\n';
  const EN_RULE = 'Module m.\n\nRule r given x as Int, produce Int:\n';
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    // [说明, zh 源码, 期望的完整报错]
    ['else 分支（KW.ELSE 与 EN_US 的 Otherwise 拼写不同，须按语义种类查）',
      ZH_RULE + '  如果 x 小于 0 那么 返回 1 否则 x。\n  返回 x。',
      "Expected '返回' or '如果' after '否则'"],
    ['Let … be',
      ZH_RULE + '  令 y x。\n  返回 y。',
      "Use '定义为' in bindings: '令 x 定义为 ...'."],
    ['表达式 if 缺 else',
      ZH_RULE + '  返回 如果 x 小于 0 那么 1。',
      "Expected '否则' in if-expression (否则 is mandatory for expression-level if)"],
    ['match 分支缺 When',
      ZH_RULE + '  匹配于 x：\n    1，返回 1。\n  返回 x。',
      "Expected '当' (若...为 pattern requires '为' after '若')"],
    ['约束 at 后缺 least/most（zh 里 at least 是单个词，给出完整本地写法）',
      ZH_HEADER + '定义 P 包含 score 作为 整数 at foo 3。',
      "此处需要 '至少' 或 '至多'"],
    ['约束 at least 后缺数值',
      ZH_HEADER + '定义 P 包含 score 作为 整数 至少。',
      "约束 '至少' 后需要数值"],
  ];
  for (const [label, src, expected] of cases) {
    it(`zh：${label}`, () => {
      assert.strictEqual(messages(src, ZH_CN), expected);
    });
  }

  it('en：else 分支与 at 修饰词文案逐字不变', () => {
    assert.strictEqual(
      messages(EN_RULE + '  If x less than 0 then Return 1 otherwise x.\n  Return x.', EN_US),
      "Expected 'return' or 'if' after 'else'");
    assert.strictEqual(
      messages('Module m.\n\nDefine P with score as Int at foo 3.', EN_US),
      "'at' 后需要 'least' 或 'most'");
  });
});

describe('用户名字不被当作关键词改写', () => {
  // 类型名与规范关键词同形：profile（档案）/ pattern（模式）
  for (const [typeName, wouldBe] of [['Profile', '档案'], ['Pattern', '模式']] as const) {
    it(`zh：类型名 ${typeName} 原样保留，句中关键词照常回译`, () => {
      const msg = messages(
        ZH_HEADER + `定义 ${typeName} 包含 score 作为 整数。\n\n规则 r 给定 x 作为 整数 产出 ${typeName}：\n  返回 ${typeName}(x)。`,
        ZH_CN,
      );
      assert.ok(msg.includes(`Cannot construct '${typeName}'`), msg);
      assert.ok(!msg.includes(wouldBe), `类型名不应被改写成「${wouldBe}」：${msg}`);
      // 后半句的 with / set to / and 是关键词槽位，应显示 zh 拼写
      assert.ok(msg.includes(`'${typeName} 包含 <field> 将 设为 <value> 并且 ...'`), msg);
    });
  }

  it('en：同一构造错误文案逐字不变', () => {
    const msg = messages('Module m.\n\nDefine Profile with score as Int.\n\nRule r given x as Int, produce Profile:\n  Return Profile(x).', EN_US);
    assert.strictEqual(
      msg,
      "Cannot construct 'Profile' with positional arguments. Use named fields instead: 'Profile with <field> set to <value> and ...'",
    );
  });
});
