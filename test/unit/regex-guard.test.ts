/**
 * regex-guard.ts 单元测试 (#24 — ReDoS guard)
 *
 * 验证：
 * 1. 恶意的 nested-quantifier 模式被拒绝并返回错误
 * 2. 过长的模式被拒绝
 * 3. 合法模式仍可正常编译
 * 4. 无效正则语法返回错误而非抛出
 * 5. overlay-loader 在加载恶意 overlay 规则时跳过该规则
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  compileGuardedRegex,
  MAX_PATTERN_LENGTH,
} from '../../src/config/lexicons/regex-guard.js';
import { loadTypeInferenceRules } from '../../src/config/lexicons/overlay-loader.js';

test('regex-guard 测试套件', async (t) => {
  await t.test('拒绝 nested-quantifier ReDoS 模式 (a+)+', () => {
    const result = compileGuardedRegex('(a+)+', 'g');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /nested quantifier|ReDoS/i);
    }
  });

  await t.test('拒绝 (a*)* / (.*)+ 等病态形状', () => {
    for (const evil of ['(a*)*', '(.*)+', '((ab)+)+', '(a|aa)+']) {
      const result = compileGuardedRegex(evil, '');
      assert.strictEqual(result.ok, false, `expected ${evil} to be rejected`);
    }
  });

  await t.test('拒绝过长模式', () => {
    const longPattern = 'a'.repeat(MAX_PATTERN_LENGTH + 1);
    const result = compileGuardedRegex(longPattern, '');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /too long/i);
    }
  });

  await t.test('合法模式正常编译', () => {
    const result = compileGuardedRegex('\\bhello\\b', 'gi');
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.regex instanceof RegExp);
      assert.strictEqual(result.regex.test('say HELLO now'), true);
    }
  });

  await t.test('无效正则语法返回错误，不抛出', () => {
    const result = compileGuardedRegex('(unclosed', '');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /invalid regular expression/i);
    }
  });

  await t.test('overlay-loader 跳过恶意 type-inference 规则', () => {
    const rules = loadTypeInferenceRules({
      version: 1,
      rules: [
        { pattern: '(a+)+', type: 'Int', priority: 1 },
        { pattern: '\\bage\\b', type: 'Int', priority: 2 },
      ],
    });
    // 恶意的 (a+)+ 被跳过，只保留合法规则
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0]!.type, 'Int');
    assert.strictEqual(rules[0]!.pattern.test('age'), true);
  });
});
