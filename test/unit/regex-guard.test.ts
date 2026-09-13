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

  await t.test('★相邻量词歧义也必须拒绝（嵌套量词检查抓不到它）', () => {
    // ★这个缺口由独立审查者发现，我已复现：
    //   `hasNestedQuantifier` 只看「被量词修饰的**分组**」，
    //   而歧义**不需要分组**——两个相邻、匹配同一原子的量词即可产生
    //   2^n 种切分，后缀失配时全部被穷举。
    //
    //   实测（守卫改前全部 ACCEPTED）：
    //     a*a*a*a*a*a*a*a*a*a*b   16→292ms 20→361ms 22→808ms 24→1705ms（每 +2 翻倍）
    //     a+a+a+a+a+a+a+a+b       同样指数
    //
    //   ★TS 侧**没有看门狗兜底**（Java 的 replaceAllWithTimeout 有），
    //   单线程 JS 下这就是无限挂死。
    for (const evil of [
      'a*a*a*a*a*a*a*a*a*a*b',
      'a+a+a+a+a+a+a+a+b',
      '\\d*\\d*x',
      '[ab]*[ab]*c',
      'a{1,}a{1,}b',
      // ★以下三条是独立审查者找出的绕过（第一版全部 ACCEPTED，实测 24 字符
      //   输入 1720ms / 1720ms / 640ms，与已修的 a*a*b 同级）。
      //   根因：readQuantifiedAtom 遇 `(` 直接 return null 并注释「交给
      //   hasNestedQuantifier」，但后者只看**分组内部**有无量词——
      //   `(a)*(a)*` 两侧内部都没有，于是**无人负责**。
      '(a)*(a)*b',
      '(?:a)*(?:a)*b',
      'a*?a*?b',
    ]) {
      const result = compileGuardedRegex(evil, '');
      assert.strictEqual(result.ok, false, `相邻量词模式 ${evil} 未被拒绝`);
      if (!result.ok) {
        assert.match(result.error, /adjacent ambiguous quantifier/i);
      }
    }
  });

  await t.test('★合法模式不得被相邻量词检查误伤（误伤比漏网更糟）', () => {
    // 反向守卫：守卫收得过紧会**静默丢掉**用户的合法 overlay 规则，
    // 那比漏掉一个 ReDoS 更难发现。
    //
    // ★`a*b*c`（不同原子）、`a*a`/`aa*`（只有一个量词）都必须通过。
    // 实证：扫了两仓 79 条**生产**词典正则，零误伤。
    for (const ok of [
      'a*b*c', '\\d+\\w+', '[a-z]+[0-9]*', '(ab)+c', 'a+b',
      '\\bfoo\\b', 'greater\\s+than', '[\\p{L}]+', 'x{2,5}y',
      'a*a', 'aa*', '\\s+\\S+', '^(#{1,6})\\s',
      // ★反向：不同原子的相邻量词、含分组的合法模式不得被误伤
      '(a)(b)*c', '(?:ab)*(?:cd)*e', 'a*?b*?c',
    ]) {
      const result = compileGuardedRegex(ok, ok.includes('p{') ? 'u' : '');
      assert.strictEqual(result.ok, true,
        `合法模式 ${ok} 被误伤：${result.ok ? '' : result.error}`);
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
