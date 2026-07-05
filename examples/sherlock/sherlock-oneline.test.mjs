// 《斑点带子案》单行化变体测试（ADR 0028 显式块分隔符）。
// 跑法（先 pnpm build）：node --test examples/sherlock/sherlock-oneline.test.mjs
//
// 钉住：
//   ① 单行化显式块（毕 收尾）与缩进块编译到**同一 Core IR**（单行化无损语义）
//   ② 真决策：不同线索导出不同结论
//   ③ 缺省 lexicon（无 blockDelimiters）下「毕」是标识符——但单行显式块源码会 parse 失败
//      （证明「毕」的块结束语义确实来自 blockDelimiters 配置，非巧合）

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, ZH_CN, initializeAllBundledLexicons } from '../../dist/src/browser.js';
import { SemanticTokenKind as K } from '../../dist/src/config/token-kind.js';

initializeAllBundledLexicons();
const DOMAIN = 'sherlock-oneline';
const ALIASES = {
  [K.MODULE_DECL]: ['探案笔记'], [K.FUNC_TO]: ['推断'], [K.FUNC_GIVEN]: ['已知'],
  [K.IF]: ['若'], [K.RETURN]: ['凶手即'], [K.AND]: ['且'],
};
const WITH_BI = { ...ZH_CN, id: DOMAIN, name: '福尔摩斯', blockDelimiters: { end: ['毕'] }, aliases: ALIASES };
const NO_BI = { ...ZH_CN, id: DOMAIN, name: '福尔摩斯', aliases: ALIASES };

// 函数体单行化（显式块，毕 收尾）
const oneLine =
  '探案笔记 斑点带子案。\n'
  + '推断 揪出真凶 已知 铃绳通风口，保险箱藏毒蛇，唯继父可入密室，产出：'
  + '若 铃绳通风口 且 保险箱藏毒蛇 then 凶手即 "继父罗伊洛特" '
  + 'else 若 唯继父可入密室 then 凶手即 "继父罗伊洛特" '
  + 'else 凶手即 "疑点未清"。毕';
// 缩进块（同逻辑）
const indented =
  '探案笔记 斑点带子案。\n'
  + '推断 揪出真凶 已知 铃绳通风口，保险箱藏毒蛇，唯继父可入密室，产出：\n'
  + '  若 铃绳通风口 且 保险箱藏毒蛇 then 凶手即 "继父罗伊洛特"\n'
  + '  else 若 唯继父可入密室 then 凶手即 "继父罗伊洛特"\n'
  + '  else 凶手即 "疑点未清"。';

const stripOrigin = (core) => JSON.stringify(core, (k, v) => (k === 'origin' ? undefined : v));

describe('《斑点带子案》单行化变体（ADR 0028 显式块）', () => {
  test('① 单行化显式块 ≡ 缩进块 Core IR', () => {
    const co = compile(oneLine, { lexicon: WITH_BI, domain: DOMAIN, tenantId: DOMAIN });
    const ci = compile(indented, { lexicon: WITH_BI, domain: DOMAIN, tenantId: DOMAIN });
    assert.equal(co.success, true, JSON.stringify(co.parseErrors));
    assert.equal(ci.success, true, JSON.stringify(ci.parseErrors));
    assert.equal(stripOrigin(co.core), stripOrigin(ci.core));
  });

  test('② 真决策：不同线索导出不同结论', () => {
    const c = compile(oneLine, { lexicon: WITH_BI, domain: DOMAIN, tenantId: DOMAIN });
    const rule = c.core.decls[0].name;
    const r1 = evaluate(c.core, rule, { 铃绳通风口: true, 保险箱藏毒蛇: true, 唯继父可入密室: true });
    const r3 = evaluate(c.core, rule, { 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: false });
    assert.equal(r1.value, '继父罗伊洛特');
    assert.equal(r3.value, '疑点未清');
    assert.notEqual(r1.value, r3.value);
  });

  test('③ 无 blockDelimiters 时单行显式块 parse 失败（块结束语义来自配置）', () => {
    // 「毕」在无 blockDelimiters 时是普通标识符，单行源码无缩进块结构 → 应 parse 失败。
    // 证明单行化能成立确实靠 blockDelimiters.end 配置，而非源码巧合。
    const c = compile(oneLine, { lexicon: NO_BI, domain: DOMAIN, tenantId: DOMAIN });
    assert.equal(c.success, false);
  });
});
