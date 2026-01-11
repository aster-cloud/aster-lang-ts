import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateCommand } from '../../../src/cli/commands/update.js';
import { PackageRegistry } from '../../../src/package/package-registry.js';
import { PackageInstaller } from '../../../src/package/package-installer.js';
import type { Diagnostic } from '../../../src/diagnostics/diagnostics.js';
import { DiagnosticCode, DiagnosticSeverity } from '../../../src/diagnostics/diagnostics.js';
import type { DependencyMap, Manifest } from '../../../src/manifest.js';

describe('updateCommand', { concurrency: false }, () => {
  const originalCwd = process.cwd();
  const originalListVersions = PackageRegistry.prototype.listVersions;
  const originalInstall = PackageInstaller.prototype.install;

  let workspace: string;
  let availableVersions: Map<string, string[]>;
  let cachedDependencies: Map<string, DependencyMap>;
  let installCalls: Array<{ name: string; version: string }>;
  let listVersionsHandler: (name: string) => Promise<string[] | Diagnostic[]>;
  let installHandler: (this: PackageInstaller, name: string, version: string) => Promise<string | Diagnostic[]>;
  let cacheDir: string;

  before(() => {
    listVersionsHandler = async () => [];
    installHandler = async function (name, version) {
      return version;
    };

    PackageRegistry.prototype.listVersions = async function (name: string) {
      return listVersionsHandler(name);
    };

    PackageInstaller.prototype.install = async function (name: string, version: string) {
      return installHandler.call(this, name, version);
    };
  });

  after(() => {
    PackageRegistry.prototype.listVersions = originalListVersions;
    PackageInstaller.prototype.install = originalInstall;
  });

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aster-update-unit-'));
    process.chdir(workspace);
    availableVersions = new Map();
    cachedDependencies = new Map();
    installCalls = [];
    cacheDir = join(workspace, '.aster', 'packages');
    mkdirSync(cacheDir, { recursive: true });
    listVersionsHandler = async (name) => availableVersions.get(name) ?? [];
    installHandler = async function (name, version) {
      installCalls.push({ name, version });
      await writeCacheManifest(name, version, cachedDependencies.get(`${name}@${version}`) ?? {});
      const lockfilePath = (this as unknown as { lockfilePath?: string }).lockfilePath ?? '.aster.lock';
      const lockContent = existsSync(lockfilePath)
        ? JSON.parse(readFileSync(lockfilePath, 'utf-8'))
        : { version: '1.0', packages: {} };
      lockContent.packages[name] = {
        version,
        resolved: `mock://${name}/${version}`,
      };
      writeFileSync(lockfilePath, `${JSON.stringify(lockContent, null, 2)}\n`, 'utf-8');
      return version;
    };
    writeLockfile({});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('仅更新显式指定的依赖', async () => {
    writeManifestFile({
      name: 'cli.app',
      version: '0.1.0',
      dependencies: { 'aster.math': '^1.0.0' },
      devDependencies: { 'aster.devkit': '^0.2.0' },
    });
    writeLockfile({
      'aster.math': { version: '1.0.0' },
    });
    availableVersions.set('aster.math', ['1.0.0', '1.4.0']);

    await updateCommand('aster.math');

    const manifest = readManifestFile();
    assert.equal(manifest.dependencies?.['aster.math'], '^1.4.0');
    assert.equal(manifest.devDependencies?.['aster.devkit'], '^0.2.0');
    const lock = readLockfile();
    const updated = lock.packages['aster.math'];
    assert.ok(updated, '锁文件应包含 aster.math');
    assert.equal(updated.version, '1.4.0');
    assert.deepEqual(installCalls, [{ name: 'aster.math', version: '1.4.0' }]);
  });

  it('未指定包名时会按字典序全量更新', async () => {
    writeManifestFile({
      name: 'cli.app',
      version: '0.1.0',
      dependencies: { 'aster.alpha': '^1.0.0' },
      devDependencies: { 'aster.devkit': '~0.3.0' },
    });
    writeLockfile({
      'aster.alpha': { version: '1.0.0' },
      'aster.devkit': { version: '0.3.1' },
    });
    availableVersions.set('aster.alpha', ['0.9.0', '1.3.0']);
    availableVersions.set('aster.devkit', ['0.3.1', '0.3.5', '0.5.0']);

    await updateCommand();

    const manifest = readManifestFile();
    assert.deepEqual(manifest.dependencies, { 'aster.alpha': '^1.3.0' });
    assert.deepEqual(manifest.devDependencies, { 'aster.devkit': '~0.3.5' });
    assert.equal(installCalls.length, 2, '应安装两个依赖');
  });

  it('SemVer 约束会阻止跨主版本升级', async () => {
    writeManifestFile({
      name: 'cli.app',
      version: '0.1.0',
      dependencies: { 'aster.time': '^1.0.0' },
    });
    writeLockfile({
      'aster.time': { version: '1.1.0' },
    });
    availableVersions.set('aster.time', ['2.0.0', '1.8.0']);

    await updateCommand('aster.time');

    const manifest = readManifestFile();
    assert.equal(manifest.dependencies?.['aster.time'], '^1.8.0');
    assert.deepEqual(installCalls, [{ name: 'aster.time', version: '1.8.0' }]);
  });

  it('更新会同步写入 manifest 与 .aster.lock', async () => {
    writeManifestFile({
      name: 'cli.app',
      version: '0.1.0',
      dependencies: { 'aster.cache': '~0.5.0' },
    });
    rmSync('.aster.lock', { force: true });
    availableVersions.set('aster.cache', ['0.5.2', '0.6.0']);

    await updateCommand('aster.cache');

    const manifest = readManifestFile();
    assert.equal(manifest.dependencies?.['aster.cache'], '~0.5.2');
    const lock = readLockfile();
    const cached = lock.packages['aster.cache'];
    assert.ok(cached, '锁文件应创建新条目');
    assert.equal(cached.version, '0.5.2');
  });

  it('远程网络失败会抛出错误并保留原文件', async () => {
    writeManifestFile({
      name: 'cli.app',
      version: '0.1.0',
      dependencies: { 'aster.net': '^1.0.0' },
    });
    listVersionsHandler = async () => {
      throw new Error('registry offline');
    };

    await assert.rejects(() => updateCommand('aster.net'), /registry offline/);
    const manifest = readManifestFile();
    assert.equal(manifest.dependencies?.['aster.net'], '^1.0.0');
  });

  it('注册表无可用版本会抛出包不存在错误', async () => {
    writeManifestFile({
      name: 'cli.app',
      version: '0.1.0',
      dependencies: { 'aster.ghost': '^1.0.0' },
    });
    availableVersions.set('aster.ghost', []);

    await assert.rejects(
      () => updateCommand('aster.ghost'),
      /未在注册表中找到 aster\.ghost 的任何版本/
    );
  });

  it('远程诊断错误会透传 CLI_DIAGNOSTIC_ERROR', async () => {
    writeManifestFile({
      name: 'cli.app',
      version: '0.1.0',
      dependencies: { 'aster.remote': '^1.0.0' },
    });
    listVersionsHandler = async () => [
      {
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.R001_NetworkError,
        message: 'network fail',
        span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } },
      },
    ];

    await assert.rejects(() => updateCommand('aster.remote'), /CLI_DIAGNOSTIC_ERROR/);
  });

  function writeManifestFile(manifest: Manifest): void {
    writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  }

  function readManifestFile(): Manifest {
    return JSON.parse(readFileSync('manifest.json', 'utf-8')) as Manifest;
  }

  function writeLockfile(packages: Record<string, { version: string }>): void {
    const payload = {
      version: '1.0',
      packages: Object.fromEntries(
        Object.entries(packages).map(([name, pkg]) => [
          name,
          { version: pkg.version, resolved: `mock://${name}/${pkg.version}` },
        ])
      ),
    };
    writeFileSync('.aster.lock', `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  }

  function readLockfile(): { packages: Record<string, { version: string }> } {
    return JSON.parse(readFileSync('.aster.lock', 'utf-8')) as {
      packages: Record<string, { version: string }>;
    };
  }

  async function writeCacheManifest(name: string, version: string, dependencies: DependencyMap): Promise<void> {
    const manifest = {
      name,
      version,
      dependencies,
    };
    const targetDir = join(cacheDir, name, version);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  }
});
