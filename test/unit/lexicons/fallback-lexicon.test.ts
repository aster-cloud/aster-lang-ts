/**
 * FallbackLexicon 单元测试
 *
 * 测试目标：
 * 1. target 缺失的 keyword 自动从 en-US fallback 取值
 * 2. target 有提供的 keyword 优先（target 覆盖 fallback）
 * 3. target 提供空串视为"未提供"，仍走 fallback
 * 4. punctuation / canonicalization / messages 透传 target（不走 fallback）
 * 5. id / name / direction 透传 target
 * 6. isFallbackLexicon 类型守卫正确识别已装饰对象
 * 7. en-US 自身不应被 wrap（registry 层职责，但工厂应接受任意 target/fallback）
 * 8. 空 target / fallback 抛错
 * 9. overlay 字段（typeInferenceRules 等）仅在 target 提供时存在
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFallbackLexicon,
  isFallbackLexicon,
  FallbackLexicon,
} from '../../../src/config/lexicons/fallback-lexicon.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { SemanticTokenKind } from '../../../src/config/token-kind.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

describe('FallbackLexicon', () => {
  test('target 缺失的 keyword 自动从 fallback 取值', () => {
    // 构造一个只提供少量 keyword 的 sparse target
    const sparse: Lexicon = {
      ...ZH_CN,
      keywords: {
        ...ZH_CN.keywords,
        [SemanticTokenKind.MODULE_DECL]: '模块',
        // 故意把 FUNC_GIVEN 清空，验证 fallback 兜底
        [SemanticTokenKind.FUNC_GIVEN]: '',
      },
    };

    const wrapped = createFallbackLexicon(sparse, EN_US);

    // sparse 提供的：使用 sparse 值
    assert.equal(wrapped.keywords[SemanticTokenKind.MODULE_DECL], '模块');
    // sparse 留空：使用 en-US 兜底
    assert.equal(
      wrapped.keywords[SemanticTokenKind.FUNC_GIVEN],
      EN_US.keywords[SemanticTokenKind.FUNC_GIVEN],
    );
  });

  test('target 覆盖 fallback（同 key 不同值）', () => {
    const zhWrapped = createFallbackLexicon(ZH_CN, EN_US);
    // ZH_CN 的 MODULE_DECL 是中文 keyword，不应被 en-US 覆盖
    assert.equal(
      zhWrapped.keywords[SemanticTokenKind.MODULE_DECL],
      ZH_CN.keywords[SemanticTokenKind.MODULE_DECL],
    );
  });

  test('id / name / direction 透传 target', () => {
    const wrapped = createFallbackLexicon(ZH_CN, EN_US);
    assert.equal(wrapped.id, ZH_CN.id);
    assert.equal(wrapped.name, ZH_CN.name);
    assert.equal(wrapped.direction, ZH_CN.direction);
  });

  test('punctuation / canonicalization / messages 透传 target', () => {
    const wrapped = createFallbackLexicon(ZH_CN, EN_US);
    assert.strictEqual(wrapped.punctuation, ZH_CN.punctuation);
    assert.strictEqual(wrapped.canonicalization, ZH_CN.canonicalization);
    assert.strictEqual(wrapped.messages, ZH_CN.messages);
  });

  test('isFallbackLexicon 类型守卫正确识别已装饰对象', () => {
    const wrapped = createFallbackLexicon(ZH_CN, EN_US);
    assert.equal(isFallbackLexicon(wrapped), true);
    assert.equal(isFallbackLexicon(EN_US), false);
    assert.equal(isFallbackLexicon(ZH_CN), false);
  });

  test('空 target 抛错', () => {
    assert.throws(
      () => createFallbackLexicon(null as unknown as Lexicon, EN_US),
      /target required/,
    );
  });

  test('空 fallback 抛错', () => {
    assert.throws(
      () => createFallbackLexicon(ZH_CN, null as unknown as Lexicon),
      /fallback required/,
    );
  });

  test('FallbackLexicon 历史 API 兼容（new + 函数调用）', () => {
    // 用 new 调用
    const a = new FallbackLexicon(ZH_CN, EN_US);
    assert.equal(isFallbackLexicon(a), true);
    assert.equal(a.id, ZH_CN.id);

    // 直接函数调用
    const b = FallbackLexicon(ZH_CN, EN_US);
    assert.equal(isFallbackLexicon(b), true);
    assert.equal(b.id, ZH_CN.id);
  });

  test('合并后的 keywords 是只读 frozen', () => {
    const wrapped = createFallbackLexicon(ZH_CN, EN_US);
    assert.equal(Object.isFrozen(wrapped.keywords), true);
  });

  test('overlay 字段仅在 target 提供时存在', () => {
    // 构造一个没有 typeInferenceRules 的 target
    const noOverlay: Lexicon = {
      ...ZH_CN,
    };
    // 删除 overlay 字段
    delete (noOverlay as { typeInferenceRules?: unknown }).typeInferenceRules;
    delete (noOverlay as { inputGenerationRules?: unknown }).inputGenerationRules;
    delete (noOverlay as { diagnosticMessages?: unknown }).diagnosticMessages;
    delete (noOverlay as { diagnosticHelp?: unknown }).diagnosticHelp;

    const wrapped = createFallbackLexicon(noOverlay, EN_US);

    // 字段未挂载（hasOwnProperty 为 false）
    assert.equal(
      Object.prototype.hasOwnProperty.call(wrapped, 'typeInferenceRules'),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(wrapped, 'inputGenerationRules'),
      false,
    );
  });
});
