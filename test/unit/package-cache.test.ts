/**
 * PackageCache 本地缓存管理器单元测试
 *
 * 覆盖缓存检测、TTL 验证、tarball 解压、完整性验证与过期清理场景。
 */

import test from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { create } from 'tar';
import { PackageCache } from '../../src/package/package-cache.js';
import type { Diagnostic } from '../../src/diagnostics/diagnostics.js';

const TEST_DIR = '/tmp/aster-cache-test';

function isDiagnostic(value: unknown): value is Diagnostic[] {
  return Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' && 'severity' in value[0];
}

test('PackageCache 本地缓存管理器', async (t) => {
  await t.before(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 目录不存在，忽略
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  await t.after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  await t.test('应正确检测缓存存在性（新鲜缓存）', async () => {
    const cacheDir = join(TEST_DIR, 'cache1');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 }); // 1 day

    const packagePath = cache.getCachePath('aster.http', '1.0.0');
    mkdirSync(packagePath, { recursive: true });

    // 创建 manifest.json
    writeFileSync(
      join(packagePath, 'manifest.json'),
      JSON.stringify({ name: 'aster.http', version: '1.0.0' }),
      'utf-8'
    );

    // 创建新鲜的 .cache-metadata.json
    const metadata = {
      cachedAt: Date.now(),
      version: '1.0.0',
    };
    writeFileSync(join(packagePath, '.cache-metadata.json'), JSON.stringify(metadata), 'utf-8');

    const result = cache.isCached('aster.http', '1.0.0');
    assert.strictEqual(result, true, '新鲜缓存应返回 true');
  });

  await t.test('TTL 过期应返回 false', () => {
    const cacheDir = join(TEST_DIR, 'cache2');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 }); // 1 day

    const packagePath = cache.getCachePath('aster.http', '1.0.0');
    mkdirSync(packagePath, { recursive: true });

    writeFileSync(
      join(packagePath, 'manifest.json'),
      JSON.stringify({ name: 'aster.http', version: '1.0.0' }),
      'utf-8'
    );

    // 创建过期的 .cache-metadata.json（2 天前）
    const metadata = {
      cachedAt: Date.now() - 2 * 86400000,
      version: '1.0.0',
    };
    writeFileSync(join(packagePath, '.cache-metadata.json'), JSON.stringify(metadata), 'utf-8');

    const result = cache.isCached('aster.http', '1.0.0');
    assert.strictEqual(result, false, '过期缓存应返回 false');
  });

  await t.test('缺少 manifest.json 应返回 false', () => {
    const cacheDir = join(TEST_DIR, 'cache3');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const packagePath = cache.getCachePath('aster.http', '1.0.0');
    mkdirSync(packagePath, { recursive: true });

    // 只有 .cache-metadata.json，缺少 manifest.json
    const metadata = {
      cachedAt: Date.now(),
      version: '1.0.0',
    };
    writeFileSync(join(packagePath, '.cache-metadata.json'), JSON.stringify(metadata), 'utf-8');

    const result = cache.isCached('aster.http', '1.0.0');
    assert.strictEqual(result, false, '缺少 manifest.json 应返回 false');
  });

  await t.test('应正确返回缓存路径', () => {
    const cacheDir = join(TEST_DIR, 'cache4');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const result = cache.getCachePath('aster.http', '2.1.0');
    const expected = join(cacheDir, 'aster.http', '2.1.0');

    assert.strictEqual(result, expected);
  });

  await t.test('应正确解压 .tar.gz 到缓存', async () => {
    const cacheDir = join(TEST_DIR, 'cache5');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    // 创建测试 tarball
    const tempDir = join(TEST_DIR, 'temp-tarball');
    mkdirSync(tempDir, { recursive: true });

    const manifest = {
      name: 'aster.test',
      version: '1.0.0',
      capabilities: { allow: ['Http'] },
    };
    writeFileSync(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    writeFileSync(join(tempDir, 'index.aster'), 'function main() {}', 'utf-8');

    const tarballPath = join(TEST_DIR, 'test.tar.gz');
    await create(
      {
        file: tarballPath,
        cwd: tempDir,
      },
      ['manifest.json', 'index.aster']
    );

    const result = await cache.addToCache(tarballPath, 'aster.test', '1.0.0');

    assert.ok(!isDiagnostic(result), `应成功解压，实际：${isDiagnostic(result) ? result[0]?.message : 'OK'}`);

    // 验证文件存在
    const cachePath = cache.getCachePath('aster.test', '1.0.0');
    assert.ok(existsSync(join(cachePath, 'manifest.json')), 'manifest.json 应存在');
    assert.ok(existsSync(join(cachePath, 'index.aster')), 'index.aster 应存在');
    assert.ok(existsSync(join(cachePath, '.cache-metadata.json')), '.cache-metadata.json 应存在');
  });

  await t.test('解压后缺少 manifest.json 应返回错误', async () => {
    const cacheDir = join(TEST_DIR, 'cache6');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    // 创建不含 manifest.json 的 tarball
    const tempDir = join(TEST_DIR, 'temp-invalid');
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'index.aster'), 'function main() {}', 'utf-8');

    const tarballPath = join(TEST_DIR, 'invalid.tar.gz');
    await create(
      {
        file: tarballPath,
        cwd: tempDir,
      },
      ['index.aster']
    );

    const result = await cache.addToCache(tarballPath, 'aster.invalid', '1.0.0');

    assert.ok(isDiagnostic(result), '应返回 Diagnostic[]');
    if (isDiagnostic(result)) {
      assert.match(result[0]?.message ?? '', /未找到 manifest\.json/, '错误信息应提示缺少 manifest.json');
    }
  });

  await t.test('validateCache 应验证缓存完整性', async () => {
    const cacheDir = join(TEST_DIR, 'cache7');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const packagePath = cache.getCachePath('aster.http', '2.0.0');
    mkdirSync(packagePath, { recursive: true });

    // 创建合法的 manifest.json
    const manifest = {
      name: 'aster.http',
      version: '2.0.0',
      capabilities: { allow: ['Http'] },
    };
    writeFileSync(join(packagePath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    const result = await cache.validateCache('aster.http', '2.0.0');
    assert.strictEqual(result, true, '合法缓存应通过验证');
  });

  await t.test('validateCache 名称不匹配应返回 false', async () => {
    const cacheDir = join(TEST_DIR, 'cache8');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const packagePath = cache.getCachePath('aster.http', '2.0.0');
    mkdirSync(packagePath, { recursive: true });

    // manifest.json 中的名称不匹配
    const manifest = {
      name: 'aster.other',
      version: '2.0.0',
      capabilities: { allow: ['Http'] },
    };
    writeFileSync(join(packagePath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    const result = await cache.validateCache('aster.http', '2.0.0');
    assert.strictEqual(result, false, '名称不匹配应返回 false');
  });

  await t.test('cleanExpired 应删除过期缓存', async () => {
    const cacheDir = join(TEST_DIR, 'cache9');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 }); // 1 day

    // 创建新鲜缓存
    const freshPath = cache.getCachePath('aster.fresh', '1.0.0');
    mkdirSync(freshPath, { recursive: true });
    writeFileSync(join(freshPath, 'manifest.json'), JSON.stringify({ name: 'aster.fresh' }), 'utf-8');
    const freshMetadata = {
      cachedAt: Date.now(),
      version: '1.0.0',
    };
    writeFileSync(join(freshPath, '.cache-metadata.json'), JSON.stringify(freshMetadata), 'utf-8');

    // 创建过期缓存
    const expiredPath = cache.getCachePath('aster.expired', '1.0.0');
    mkdirSync(expiredPath, { recursive: true });
    writeFileSync(join(expiredPath, 'manifest.json'), JSON.stringify({ name: 'aster.expired' }), 'utf-8');
    const expiredMetadata = {
      cachedAt: Date.now() - 2 * 86400000, // 2 天前
      version: '1.0.0',
    };
    writeFileSync(join(expiredPath, '.cache-metadata.json'), JSON.stringify(expiredMetadata), 'utf-8');

    await cache.cleanExpired();

    assert.ok(existsSync(freshPath), '新鲜缓存应保留');
    assert.ok(!existsSync(expiredPath), '过期缓存应被删除');
  });

  await t.test('缓存目录自动创建', () => {
    const cacheDir = join(TEST_DIR, 'auto-created-cache');
    assert.ok(!existsSync(cacheDir), '缓存目录初始不存在');

    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    assert.ok(existsSync(cacheDir), '构造函数应自动创建缓存目录');
  });
});
