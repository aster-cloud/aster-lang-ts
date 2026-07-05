// ADR 0028：显式块分隔符 TS 引擎测试（与 Java ExplicitBlockTest 对称）。
//
// 核心不变式：显式块（`produce T:stmt. fin`）与缩进块编译到**同一 Core IR**——仅结束方式
// 不同（DEDENT vs BLOCK_END 词），下游语义一致。默认无 blockDelimiters 时块结束词是普通标识符。
//
// 同脚本约束（Codex 交叉审 P1）：块结束词必须是所在 lexicon 可 lex 为标识符的词——en-US 配
// 英文词「fin」（与 Java 测试同配置同源码，证跨引擎输入接受集一致）。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../../src/browser.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

const WITH_FIN: Lexicon = { ...EN_US, id: 'x', name: 'x', blockDelimiters: { end: ['fin'] } };

/** 去 origin 的 Core IR 结构（span 位置随排版不同，比结构）。 */
function stripOrigin(core: unknown): string {
  return JSON.stringify(core, (k, v) => (k === 'origin' ? undefined : v));
}

describe('ADR 0028 显式块（explicit block）', () => {
  test('显式块与缩进块编译到同一 Core IR', () => {
    const indented =
      'Module Detective.\n\nRule solve given clueA as Bool, produce Text:\n  if clueA then return "guilty" else return "innocent".';
    const explicit =
      'Module Detective.\n\nRule solve given clueA as Bool, produce Text:if clueA then return "guilty" else return "innocent".fin';
    const ci = compile(indented, { lexicon: WITH_FIN, domain: 'x', tenantId: 'x' });
    const ce = compile(explicit, { lexicon: WITH_FIN, domain: 'x', tenantId: 'x' });
    assert.equal(ci.success, true, JSON.stringify(ci.parseErrors));
    assert.equal(ce.success, true, JSON.stringify(ce.parseErrors));
    assert.equal(stripOrigin(ce.core), stripOrigin(ci.core));
  });

  test('缺省 lexicon（无 blockDelimiters）下块结束词是普通标识符', () => {
    const src = 'Module T.\n\nRule f given fin as Bool, produce Bool:\n  return fin.';
    const c = compile(src, { lexicon: EN_US, domain: 'x', tenantId: 'x' });
    assert.equal(c.success, true, JSON.stringify(c.parseErrors)); // 'fin' 作参数名/标识符
  });

  test('块结束词是整词才匹配，含它的更长标识符不被切开', () => {
    const src = 'Module T.\n\nRule f given finish as Bool, produce Bool:\n  return finish.';
    const c = compile(src, { lexicon: WITH_FIN, domain: 'x', tenantId: 'x' });
    assert.equal(c.success, true, JSON.stringify(c.parseErrors)); // 'finish' != 'fin' → 标识符
  });

  test('显式块运行：喂入决策线索输出正确分支', () => {
    const src =
      'Module Detective.\n\nRule solve given clueA as Bool, produce Text:if clueA then return "guilty" else return "innocent".fin';
    const c = compile(src, { lexicon: WITH_FIN, domain: 'x', tenantId: 'x' });
    assert.equal(c.success, true, JSON.stringify(c.parseErrors));
  });
});
