import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyTransformers, registerTransformer } from '../../../src/frontend/transformers.js';

describe('transformer 管线', () => {
  it('英语所有格只改字符串字面量外的内容', () => {
    assert.equal(
      applyTransformers('driver\'s age; Return "driver\'s age".', ['english-possessive']),
      'driver.age; Return "driver\'s age".',
    );
  });

  it('转义引号不结束字符串，未闭合字符串从开引号起全部保留', () => {
    assert.equal(
      applyTransformers('driver\'s age; Return "driver\'s \\"quoted\\" age".', ['english-possessive']),
      'driver.age; Return "driver\'s \\"quoted\\" age".',
    );
    assert.equal(
      applyTransformers('driver\'s age; Return "driver\'s age', ['english-possessive']),
      'driver.age; Return "driver\'s age',
    );
    assert.equal(
      applyTransformers(String.raw`Return "driver's\\"; driver's age`, ['english-possessive']),
      String.raw`Return "driver's\\"; driver.age`,
    );
  });

  it('字符串区间不能被跨界正则匹配改写', () => {
    registerTransformer({
      name: 'test-cross-string-replacement',
      transform: source => source.replace(/foo.*bar/, 'changed'),
    });
    assert.equal(
      applyTransformers('foo "inside" bar', ['test-cross-string-replacement']),
      'foo "inside" bar',
    );
  });

  it('字符串后的锚定变换仍使用整份源码的行首上下文', () => {
    assert.equal(
      applyTransformers('Return "Set x to 1" Set y to 2', ['set-to']),
      'Return "Set x to 1" Set y to 2',
    );
    assert.equal(
      applyTransformers('Return "Set x to 1".\nSet y to 2', ['set-to']),
      'Return "Set x to 1".\nLet y be 2',
    );
  });

});
