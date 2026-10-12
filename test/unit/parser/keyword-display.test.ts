/**
 * @module test/unit/parser/keyword-display.test
 *
 * keyword-display 的单元契约：只做「规范关键词 → locale 拼写」的查表，
 * 非关键词与英文一律原样返回。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { kw, kwq } from '../../../src/parser/keyword-display.js';
import { KW } from '../../../src/config/semantic.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';

describe('keyword-display', () => {
  it('zh 下规范关键词显示为 zh 拼写', () => {
    assert.strictEqual(kw({ lexicon: ZH_CN }, KW.RETURN), '返回');
    assert.strictEqual(kwq({ lexicon: ZH_CN }, KW.THEN), "'那么'");
  });

  it('无 lexicon 或 en-US 时返回英文原文（含句首大写的 enText）', () => {
    assert.strictEqual(kw({}, KW.RULE, 'Rule'), 'Rule');
    assert.strictEqual(kw({ lexicon: EN_US }, KW.RULE, 'Rule'), 'Rule');
    assert.strictEqual(kwq({ lexicon: EN_US }, KW.RETURN), "'return'");
  });

  it('不是关键词的文本原样返回', () => {
    assert.strictEqual(kw({ lexicon: ZH_CN }, 'exponential'), 'exponential');
  });
});
