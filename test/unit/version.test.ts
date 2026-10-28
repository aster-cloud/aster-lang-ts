/**
 * 工具链分量版本常量单元测试（ADR 0051）
 *
 * 测试目标：
 * 1. 三个分量常量的值与 ADR 0051 §7 一致（cloud 据此组装 toolchainId）
 * 2. 常量同时从 browser 与 Node 两个入口导出，且与模块内定义为同一值
 */

import test from 'node:test';
import assert from 'node:assert';
import * as version from '../../src/version.js';
import * as indexEntry from '../../src/index.js';
import * as browserEntry from '../../src/browser.js';

test('toolchainId 分量常量', async (t) => {
  await t.test('取值与 ADR 0051 一致', () => {
    assert.strictEqual(version.RESOLVER_VERSION, 1);
    assert.strictEqual(version.CASEFOLD_VERSION, '15.1');
    assert.strictEqual(version.CORE_IR_ABI, '1.1');
  });

  await t.test('index 入口导出三个常量', () => {
    assert.strictEqual(indexEntry.RESOLVER_VERSION, 1);
    assert.strictEqual(indexEntry.CASEFOLD_VERSION, '15.1');
    assert.strictEqual(indexEntry.CORE_IR_ABI, '1.1');
  });

  await t.test('browser 入口导出三个常量', () => {
    assert.strictEqual(browserEntry.RESOLVER_VERSION, 1);
    assert.strictEqual(browserEntry.CASEFOLD_VERSION, '15.1');
    assert.strictEqual(browserEntry.CORE_IR_ABI, '1.1');
  });
});
