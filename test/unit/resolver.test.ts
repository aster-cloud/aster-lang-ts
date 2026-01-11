/**
 * resolver.ts 单元测试
 */

import test from 'node:test';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import { DependencyResolver, MockPackageRegistry } from '../../src/package/resolver.js';

test('resolver 测试套件', async (t) => {
  await t.test('简单依赖解析应成功且<1秒', () => {
    const resolver = new DependencyResolver(new MockPackageRegistry());
    const start = performance.now();

    const result = resolver.resolve(
      { 'aster.http': '^2.0.0' },
      { maxDepth: 100, timeout: 30_000 }
    );

    const duration = performance.now() - start;
    assert.ok(!(result instanceof Error), '依赖解析应成功');
    assert.strictEqual(result.packages.get('aster.http'), '2.5.0');
    assert.strictEqual(result.packages.get('aster.time'), '1.5.3');
    assert.ok(duration < 1000, `耗时${duration}ms应<1000ms`);
  });

  await t.test('版本冲突应返回错误并报告依赖链', () => {
    const resolver = new DependencyResolver(new MockPackageRegistry());

    const result = resolver.resolve(
      {
        'aster.http': '^3.0.0',
        'aster.sql': '^1.0.0',
      },
      { maxDepth: 100, timeout: 30_000 }
    );

    assert.ok(result instanceof Error, '存在冲突时应返回 Error');
    assert.ok(result.message.includes('VERSION_CONFLICT'), '错误应包含冲突码');
    assert.ok(result.message.includes('aster.time'), '应报告冲突包名');
  });

  await t.test('超时保护应在30秒后返回TIMEOUT错误', () => {
    const resolver = new DependencyResolver(new MockPackageRegistry());

    const result = resolver.resolve(
      { 'deep-package': '^1.0.0' },
      { maxDepth: 100, timeout: 100 }
    );

    assert.ok(result instanceof Error, '长时间解析应返回 Error');
    assert.ok(result.message.includes('TIMEOUT'), '应包含 TIMEOUT 关键字');
  });

  await t.test('超过最大深度100应返回错误', () => {
    const resolver = new DependencyResolver(new MockPackageRegistry());

    const result = resolver.resolve(
      { 'deep-chain': '^1.0.0' },
      { maxDepth: 5, timeout: 30_000 }
    );

    assert.ok(result instanceof Error, '过深依赖链应报错');
    assert.ok(result.message.includes('最大深度'));
  });

  await t.test('包不存在应返回PACKAGE_NOT_FOUND', () => {
    const resolver = new DependencyResolver(new MockPackageRegistry());

    const result = resolver.resolve(
      { 'non-existent-package': '^1.0.0' },
      { maxDepth: 100, timeout: 30_000 }
    );

    assert.ok(result instanceof Error, '缺失包应返回 Error');
    assert.ok(result.message.includes('PACKAGE_NOT_FOUND'));
  });
});
