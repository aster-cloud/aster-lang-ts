/**
 * version-utils.ts 单元测试
 *
 * 测试目标：
 * 1. 验证parseVersion能正确解析合法版本号
 * 2. 验证parseVersion对非法版本号返回null
 * 3. 验证satisfies能正确判断版本约束匹配
 * 4. 验证maxSatisfying能返回满足约束的最高版本
 * 5. 验证sortVersions能正确降序排序版本
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  parseVersion,
  satisfies,
  maxSatisfying,
  sortVersions,
} from '../../src/package/version-utils.js';

test('version-utils 测试套件', async (t) => {
  await t.test('parseVersion - 应成功解析合法版本号', () => {
    const result = parseVersion('1.2.3');
    assert.ok(result !== null, '应返回SemVer对象');
    assert.strictEqual(result.major, 1);
    assert.strictEqual(result.minor, 2);
    assert.strictEqual(result.patch, 3);
  });

  await t.test('parseVersion - 应解析带预发布标识的版本', () => {
    const result = parseVersion('2.0.0-beta.1');
    assert.ok(result !== null, '应返回SemVer对象');
    assert.strictEqual(result.major, 2);
    assert.strictEqual(result.minor, 0);
    assert.strictEqual(result.patch, 0);
    assert.deepStrictEqual(result.prerelease, ['beta', 1]);
  });

  await t.test('parseVersion - 应对非法版本返回null', () => {
    const invalidVersions = [
      'invalid',
      '1.2', // 缺少patch版本
      'abc.def.ghi',
      '',
    ];

    for (const version of invalidVersions) {
      const result = parseVersion(version);
      assert.strictEqual(result, null, `"${version}" 应返回null`);
    }
  });

  await t.test('parseVersion - 应接受带v前缀的版本', () => {
    const result = parseVersion('v1.2.3');
    assert.ok(result !== null, '应返回SemVer对象');
    assert.strictEqual(result.major, 1);
    assert.strictEqual(result.minor, 2);
    assert.strictEqual(result.patch, 3);
    assert.strictEqual(result.version, '1.2.3'); // 会自动去掉v前缀
  });

  await t.test('satisfies - 应正确匹配caret约束(^)', () => {
    assert.strictEqual(satisfies('2.1.0', '^2.0.0'), true);
    assert.strictEqual(satisfies('2.9.9', '^2.0.0'), true);
    assert.strictEqual(satisfies('1.9.9', '^2.0.0'), false);
    assert.strictEqual(satisfies('3.0.0', '^2.0.0'), false);
  });

  await t.test('satisfies - 应正确匹配tilde约束(~)', () => {
    assert.strictEqual(satisfies('1.5.4', '~1.5.3'), true);
    assert.strictEqual(satisfies('1.5.9', '~1.5.3'), true);
    assert.strictEqual(satisfies('1.6.0', '~1.5.3'), false);
    assert.strictEqual(satisfies('1.4.9', '~1.5.3'), false);
  });

  await t.test('satisfies - 应正确匹配精确版本', () => {
    assert.strictEqual(satisfies('1.0.0', '1.0.0'), true);
    assert.strictEqual(satisfies('1.0.1', '1.0.0'), false);
  });

  await t.test('satisfies - 应正确匹配范围约束', () => {
    assert.strictEqual(satisfies('1.5.0', '>=1.0.0 <2.0.0'), true);
    assert.strictEqual(satisfies('2.0.0', '>=1.0.0 <2.0.0'), false);
    assert.strictEqual(satisfies('0.9.9', '>=1.0.0 <2.0.0'), false);
  });

  await t.test('maxSatisfying - 应返回满足约束的最高版本', () => {
    const versions = ['1.0.0', '2.1.0', '2.3.5', '3.0.0'];

    assert.strictEqual(maxSatisfying(versions, '^2.0.0'), '2.3.5');
    assert.strictEqual(maxSatisfying(versions, '^1.0.0'), '1.0.0');
    assert.strictEqual(maxSatisfying(versions, '^3.0.0'), '3.0.0');
  });

  await t.test('maxSatisfying - 无匹配版本时应返回null', () => {
    const versions = ['1.0.0', '1.5.0', '1.9.9'];

    assert.strictEqual(maxSatisfying(versions, '^2.0.0'), null);
    assert.strictEqual(maxSatisfying(versions, '^3.0.0'), null);
  });

  await t.test('maxSatisfying - 空数组应返回null', () => {
    assert.strictEqual(maxSatisfying([], '^2.0.0'), null);
  });

  await t.test('sortVersions - 应按降序排列版本', () => {
    const versions = ['1.0.0', '2.1.0', '1.5.0', '3.0.0', '2.0.0'];
    const sorted = sortVersions(versions);

    assert.deepStrictEqual(sorted, ['3.0.0', '2.1.0', '2.0.0', '1.5.0', '1.0.0']);
  });

  await t.test('sortVersions - 应正确排序带预发布标识的版本', () => {
    const versions = ['2.0.0', '2.0.0-beta.1', '2.0.0-alpha', '1.9.9'];
    const sorted = sortVersions(versions);

    // 正式版本 > 预发布版本
    assert.strictEqual(sorted[0], '2.0.0');
    assert.strictEqual(sorted[sorted.length - 1], '1.9.9');
  });

  await t.test('sortVersions - 不应修改原数组', () => {
    const original = ['1.0.0', '2.0.0', '1.5.0'];
    const copy = [...original];

    sortVersions(original);

    assert.deepStrictEqual(original, copy, '原数组不应被修改');
  });

  await t.test('sortVersions - 空数组应返回空数组', () => {
    const sorted = sortVersions([]);
    assert.deepStrictEqual(sorted, []);
  });

  await t.test('sortVersions - 单个版本应返回相同数组', () => {
    const sorted = sortVersions(['1.0.0']);
    assert.deepStrictEqual(sorted, ['1.0.0']);
  });
});
