/**
 * 限定枚举成员 `E.M`：类型检查器与解释器把它视为与裸成员 `M` 相同的类型与值。
 * 名称解析保持写法形态（`Stufe.Hoch` → `Level.High`），E804/E806 的提示也引导用户写 `E.M`，
 * 因此限定写法必须能通过类型检查并求值。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import { evaluate } from '../../../src/core/interpreter.js';
import type { Core } from '../../../src/types.js';

function coreOf(source: string): Core.Module {
  const result = parse(lex(canonicalize(source)));
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === 'error'), []);
  return lowerModule(result.ast);
}

const TIER = 'Module m.\n\nDefine Tier as one of Gold, Silver.\n\n';

const QUALIFIED =
  TIER +
  'Rule pick given t as Tier, produce Tier:\n' +
  '  If t equals to Tier.Gold:\n' +
  '    Return Tier.Silver.\n' +
  '  Return Tier.Gold.\n';

const BARE =
  TIER +
  'Rule pick given t as Tier, produce Tier:\n' +
  '  If t equals to Gold:\n' +
  '    Return Silver.\n' +
  '  Return Gold.\n';

const errors = (ds: readonly { severity: string }[]): unknown[] => ds.filter((d) => d.severity === 'error');

describe('限定枚举成员 E.M', () => {
  it('类型检查通过，与裸成员写法诊断一致', () => {
    assert.deepEqual(errors(typecheckModule(coreOf(QUALIFIED))), []);
    assert.deepEqual(errors(typecheckBrowser(coreOf(QUALIFIED))), []);
    assert.deepEqual(errors(typecheckModule(coreOf(BARE))), []);
  });

  it('E.M 的类型为枚举 E：返回类型不符时照常报错', () => {
    const src = TIER + 'Rule f given x as Int, produce Int:\n  Return Tier.Gold.\n';
    const diags = errors(typecheckModule(coreOf(src)));
    assert.equal(diags.length, 1, JSON.stringify(diags));
  });

  it('不存在的成员与非枚举限定仍报未定义', () => {
    const missing = TIER + 'Rule f given x as Int, produce Tier:\n  Return Tier.Bronze.\n';
    assert.equal(errors(typecheckModule(coreOf(missing))).length, 1);
    const notEnum = TIER + 'Rule f given x as Int, produce Tier:\n  Return Rank.Gold.\n';
    assert.equal(errors(typecheckModule(coreOf(notEnum))).length, 1);
  });

  it('解释器：E.M 求值为与裸成员相同的枚举值', () => {
    const qualified = coreOf(QUALIFIED);
    const bare = coreOf(BARE);
    const gold = { __type: '?', _enum: 'Tier', value: 'Gold', variant: 'Gold', args: [] };
    for (const input of ['Gold', 'Silver']) {
      const arg = { t: { ...gold, value: input, variant: input } };
      const q = evaluate(qualified, 'pick', arg);
      const b = evaluate(bare, 'pick', arg);
      assert.equal(q.success, true, q.error);
      assert.equal(JSON.stringify(q.value), JSON.stringify(b.value));
    }
    const r = evaluate(qualified, 'pick', { t: { ...gold, value: 'Silver', variant: 'Silver' } });
    assert.equal(JSON.stringify(r.value), JSON.stringify(gold));
  });

  it('解释器：局部变量优先于同名枚举的限定访问', () => {
    // 源码语法不允许大写参数名，这里在 Core 上把参数改名为与枚举同名，验证求值顺序
    const src =
      'Module m.\n\nDefine Tier as one of gold, silver.\n\nDefine Box has gold as Int.\n\n' +
      'Rule f given box as Box, produce Int:\n  Return box.gold.\n';
    const core = JSON.parse(JSON.stringify(coreOf(src)).replaceAll('"box"', '"Tier"').replace('"box.gold"', '"Tier.gold"'));
    const r = evaluate(core as Core.Module, 'f', { Tier: { gold: 7 } });
    assert.equal(r.success, true, r.error);
    assert.equal(r.value, 7);
  });
});
