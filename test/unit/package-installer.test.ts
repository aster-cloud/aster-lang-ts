import test from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { create } from 'tar';
import { PackageInstaller } from '../../src/package/package-installer.js';
import { PackageRegistry } from '../../src/package/package-registry.js';
import { PackageCache } from '../../src/package/package-cache.js';
import { DiagnosticSeverity, type Diagnostic } from '../../src/diagnostics/diagnostics.js';

const TEST_DIR = '/tmp/aster-installer-test';

function isDiagnostic(value: unknown): value is Diagnostic[] {
  return Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' && 'severity' in value[0];
}

/**
 * Mock PackageRegistry for testing
 */
class MockPackageRegistry extends PackageRegistry {
  private mockVersions: Map<string, string[]> = new Map();
  private mockDownloads: Map<string, string> = new Map();

  constructor() {
    super({ timeout: 30000, baseUrl: 'https://api.github.com' });
  }

  setMockVersions(packageName: string, versions: string[]): void {
    this.mockVersions.set(packageName, versions);
  }

  setMockDownload(packageName: string, version: string, tarballContent: string): void {
    this.mockDownloads.set(`${packageName}@${version}`, tarballContent);
  }

  async listVersions(packageName: string): Promise<string[] | import('../../src/diagnostics/diagnostics.js').Diagnostic[]> {
    const versions = this.mockVersions.get(packageName);
    if (!versions) {
      return [{
        severity: DiagnosticSeverity.Error,
        code: 'R003' as any,
        message: `包不存在：${packageName}`,
        span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } }
      }];
    }
    return versions;
  }

  async downloadPackage(packageName: string, version: string, targetPath: string): Promise<void | import('../../src/diagnostics/diagnostics.js').Diagnostic[]> {
    const key = `${packageName}@${version}`;
    const content = this.mockDownloads.get(key);
    if (!content) {
      return [{
        severity: DiagnosticSeverity.Error,
        code: 'R004' as any,
        message: `下载失败：${key}`,
        span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } }
      }];
    }

    // 创建真实的 tarball 文件
    const tempDir = join(TEST_DIR, 'mock-tarball-source', packageName, version);
    mkdirSync(tempDir, { recursive: true });

    const manifest = {
      name: packageName,
      version: version,
      capabilities: { allow: ['Http'] },
      dependencies: {},
    };
    writeFileSync(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    writeFileSync(join(tempDir, 'index.aster'), 'function main() {}', 'utf-8');

    try {
      await create(
        { file: targetPath, cwd: tempDir },
        ['manifest.json', 'index.aster']
      );
      return undefined;
    } catch (err: unknown) {
      return [{
        severity: DiagnosticSeverity.Error,
        code: 'R004' as any,
        message: err instanceof Error ? err.message : String(err),
        span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } }
      }];
    }
  }
}

test('PackageInstaller 测试套件', async (t) => {
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

  await t.test('应完成完整安装流程（缓存未命中）', async () => {
    const registry = new MockPackageRegistry();
    registry.setMockVersions('aster.http', ['1.0.0', '1.1.0', '1.2.0']);
    registry.setMockDownload('aster.http', '1.2.0', 'mock-content');

    const cacheDir = join(TEST_DIR, 'cache1');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const tempDir = join(TEST_DIR, 'temp1');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.install('aster.http', '^1.0.0');

    assert.ok(!(version instanceof Error), `安装应成功，实际：${version instanceof Error ? version.message : 'OK'}`);
    assert.strictEqual(version, '1.2.0', '应安装最新匹配版本');
    assert.ok(cache.isCached('aster.http', '1.2.0'), '应在缓存中');
  });

  await t.test('应从缓存直接返回（精确版本）', async () => {
    const registry = new MockPackageRegistry();
    const cacheDir = join(TEST_DIR, 'cache2');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    // 预先填充缓存
    const packagePath = cache.getCachePath('aster.http', '1.0.0');
    mkdirSync(packagePath, { recursive: true });
    writeFileSync(
      join(packagePath, 'manifest.json'),
      JSON.stringify({ name: 'aster.http', version: '1.0.0' }),
      'utf-8'
    );
    const metadata = {
      cachedAt: Date.now(),
      version: '1.0.0',
    };
    writeFileSync(join(packagePath, '.cache-metadata.json'), JSON.stringify(metadata), 'utf-8');

    const tempDir = join(TEST_DIR, 'temp2');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.install('aster.http', '1.0.0');

    assert.strictEqual(version, '1.0.0', '应从缓存返回');
  });

  await t.test('应从缓存返回（版本约束匹配）', async () => {
    const registry = new MockPackageRegistry();
    registry.setMockVersions('aster.http', ['1.0.0', '1.1.0', '1.2.0']);

    const cacheDir = join(TEST_DIR, 'cache3');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    // 预先填充缓存
    const packagePath = cache.getCachePath('aster.http', '1.2.0');
    mkdirSync(packagePath, { recursive: true });
    writeFileSync(
      join(packagePath, 'manifest.json'),
      JSON.stringify({ name: 'aster.http', version: '1.2.0' }),
      'utf-8'
    );
    const metadata = {
      cachedAt: Date.now(),
      version: '1.2.0',
    };
    writeFileSync(join(packagePath, '.cache-metadata.json'), JSON.stringify(metadata), 'utf-8');

    const tempDir = join(TEST_DIR, 'temp3');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.install('aster.http', '^1.0.0');

    assert.strictEqual(version, '1.2.0', '应从缓存返回最新匹配版本');
  });

  await t.test('找不到匹配版本应返回错误', async () => {
    const registry = new MockPackageRegistry();
    registry.setMockVersions('aster.http', ['1.0.0', '1.1.0']);

    const cacheDir = join(TEST_DIR, 'cache4');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const tempDir = join(TEST_DIR, 'temp4');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.install('aster.http', '^2.0.0');

    assert.ok(isDiagnostic(version), '应返回错误');
    if (isDiagnostic(version)) {
      assert.ok(version[0]?.message.includes('找不到满足约束'), '错误消息应正确');
    }
  });

  await t.test('包不存在应返回错误', async () => {
    const registry = new MockPackageRegistry();
    const cacheDir = join(TEST_DIR, 'cache5');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const tempDir = join(TEST_DIR, 'temp5');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.install('aster.nonexistent', '1.0.0');

    assert.ok(isDiagnostic(version), '应返回错误');
    if (isDiagnostic(version)) {
      assert.ok(version[0]?.message.includes('包不存在'), '错误消息应正确');
    }
  });

  await t.test('应支持离线模式（缓存存在）', async () => {
    const registry = new MockPackageRegistry();
    const cacheDir = join(TEST_DIR, 'cache6');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    // 预先填充缓存
    const packagePath = cache.getCachePath('aster.http', '1.0.0');
    mkdirSync(packagePath, { recursive: true });
    writeFileSync(
      join(packagePath, 'manifest.json'),
      JSON.stringify({ name: 'aster.http', version: '1.0.0' }),
      'utf-8'
    );
    const metadata = {
      cachedAt: Date.now(),
      version: '1.0.0',
    };
    writeFileSync(join(packagePath, '.cache-metadata.json'), JSON.stringify(metadata), 'utf-8');

    const tempDir = join(TEST_DIR, 'temp6');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.installOffline('aster.http', '1.0.0');

    assert.strictEqual(version, '1.0.0', '应从缓存返回');
  });

  await t.test('离线模式缓存不存在应返回错误', async () => {
    const registry = new MockPackageRegistry();
    const cacheDir = join(TEST_DIR, 'cache7');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const tempDir = join(TEST_DIR, 'temp7');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.installOffline('aster.http', '1.0.0');

    assert.ok(isDiagnostic(version), '应返回 Diagnostic[]');
    if (isDiagnostic(version)) {
      assert.ok(version[0]?.message.includes('离线模式：缓存中未找到'), '错误消息应正确');
    }
  });

  await t.test('离线模式缓存损坏应返回错误', async () => {
    const registry = new MockPackageRegistry();
    const cacheDir = join(TEST_DIR, 'cache8');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    // 预先填充损坏的缓存（manifest.json 存在但内容错误）
    const packagePath = cache.getCachePath('aster.http', '1.0.0');
    mkdirSync(packagePath, { recursive: true });

    // 创建错误的 manifest（name 不匹配）
    writeFileSync(
      join(packagePath, 'manifest.json'),
      JSON.stringify({ name: 'aster.wrong', version: '1.0.0' }),
      'utf-8'
    );

    const metadata = {
      cachedAt: Date.now(),
      version: '1.0.0',
    };
    writeFileSync(join(packagePath, '.cache-metadata.json'), JSON.stringify(metadata), 'utf-8');

    const tempDir = join(TEST_DIR, 'temp8');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const version = await installer.installOffline('aster.http', '1.0.0');

    assert.ok(isDiagnostic(version), '应返回 Diagnostic[]');
    if (isDiagnostic(version)) {
      assert.ok(version[0]?.message.includes('缓存损坏'), '错误消息应正确');
    }
  });

  await t.test('应支持批量安装', async () => {
    const registry = new MockPackageRegistry();
    registry.setMockVersions('aster.http', ['1.0.0']);
    registry.setMockDownload('aster.http', '1.0.0', 'mock-content');
    registry.setMockVersions('aster.json', ['2.0.0']);
    registry.setMockDownload('aster.json', '2.0.0', 'mock-content');

    const cacheDir = join(TEST_DIR, 'cache9');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const tempDir = join(TEST_DIR, 'temp9');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const packages = new Map([
      ['aster.http', '1.0.0'],
      ['aster.json', '2.0.0'],
    ]);

    const result = await installer.installMany(packages);

    assert.ok(!isDiagnostic(result), `批量安装应成功，实际：${isDiagnostic(result) ? result[0]?.message : 'OK'}`);
    if (!isDiagnostic(result)) {
      assert.strictEqual(result.get('aster.http'), '1.0.0', 'aster.http 应安装');
      assert.strictEqual(result.get('aster.json'), '2.0.0', 'aster.json 应安装');
    }
  });

  await t.test('批量安装中某个包失败应返回错误', async () => {
    const registry = new MockPackageRegistry();
    registry.setMockVersions('aster.http', ['1.0.0']);
    registry.setMockDownload('aster.http', '1.0.0', 'mock-content');
    // aster.nonexistent 不存在

    const cacheDir = join(TEST_DIR, 'cache10');
    const cache = new PackageCache({ cacheDir, ttl: 86400000 });

    const tempDir = join(TEST_DIR, 'temp10');
    const installer = new PackageInstaller(registry, cache, undefined, tempDir);

    const packages = new Map([
      ['aster.http', '1.0.0'],
      ['aster.nonexistent', '1.0.0'],
    ]);

    const result = await installer.installMany(packages);

    assert.ok(isDiagnostic(result), '应返回错误');
    if (isDiagnostic(result)) {
      assert.ok(result[0]?.message.includes('包不存在'), '错误消息应正确');
    }
  });
});
