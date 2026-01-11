import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installCommand } from '../../../src/cli/commands/install.js';
import { PackageInstaller } from '../../../src/package/package-installer.js';
import {
  DiagnosticCode,
  DiagnosticSeverity,
  type Diagnostic,
} from '../../../src/diagnostics/diagnostics.js';

describe('installCommand', { concurrency: false }, () => {
  const originalCwd = process.cwd();
  const originalInstallMany = PackageInstaller.prototype.installMany;
  let workspace: string;
  let nextInstallResult: Map<string, string>;
  let nextInstallDiagnostics: Diagnostic[] | null;
  const recordedCalls: Map<string, string>[] = [];

  before(() => {
    PackageInstaller.prototype.installMany = async function (packages: Map<string, string>) {
      recordedCalls.push(new Map(packages));
      if (nextInstallDiagnostics) {
        return nextInstallDiagnostics;
      }
      return new Map(nextInstallResult);
    };
  });

  after(() => {
    PackageInstaller.prototype.installMany = originalInstallMany;
  });

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aster-install-unit-'));
    process.chdir(workspace);
    nextInstallResult = new Map();
    nextInstallDiagnostics = null;
    recordedCalls.length = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('写入 manifest 并生成锁文件', async () => {
    nextInstallResult = new Map([['aster.math', '1.4.0']]);

    await installCommand('aster.math', {});

    const manifest = JSON.parse(readFileSync(join(workspace, 'manifest.json'), 'utf-8'));
    assert.deepEqual(manifest.dependencies, { 'aster.math': '^1.4.0' });
    assert.ok(existsSync(join(workspace, '.aster.lock')), '.aster.lock 应存在');
    assert.ok(existsSync(join(workspace, '.aster', 'packages')), '缓存目录应创建');
    const firstCall = recordedCalls[0];
    assert.ok(firstCall, 'installMany 调用记录缺失');
    assert.deepEqual([...firstCall], [['aster.math', '*']]);
  });

  it('支持 --save-dev 与显式约束且跳过锁文件', async () => {
    nextInstallResult = new Map([['aster.devkit', '2.1.0']]);

    await installCommand('aster.devkit@2.1.0', { saveDev: true, noLock: true });

    const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8'));
    assert.deepEqual(manifest.devDependencies, { 'aster.devkit': '2.1.0' });
    assert.strictEqual(manifest.dependencies?.['aster.devkit'], undefined);
    assert.strictEqual(existsSync('.aster.lock'), false);
    const secondCall = recordedCalls[0];
    assert.ok(secondCall, 'installMany 应被调用一次');
    assert.deepEqual([...secondCall], [['aster.devkit', '2.1.0']]);
  });

  it('安装失败时抛出诊断错误', async () => {
    nextInstallDiagnostics = [
      {
        code: DiagnosticCode.M001_ManifestParseError,
        severity: DiagnosticSeverity.Error,
        message: 'manifest error',
        span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } },
      },
    ];

    await assert.rejects(() => installCommand('aster.pkg', {}), /CLI_DIAGNOSTIC_ERROR/);
  });

  it('遇到损坏的锁文件会提前终止', async () => {
    writeFileSync('.aster.lock', '{invalid}', 'utf-8');
    nextInstallResult = new Map([['aster.pkg', '1.0.0']]);
    await assert.rejects(
      () => installCommand('aster.pkg', {}),
      /无法解析现有锁文件/
    );
  });

  it('解析不同 registry 输入格式', async () => {
    await runInstall('aster.remote@1.0.0', { registry: 'https://example.com/api' });
    await runInstall('aster.file@1.0.0', { registry: 'file:///tmp/aster-registry' });
    await runInstall('aster.local@1.0.0', { registry: 'local' });
    await runInstall('aster.path@1.0.0', { registry: '.aster/local-registry' });
    await runInstall('aster.blank@1.0.0', { registry: '   ' });
  });

  it('空白包名称会抛出提示错误', async () => {
    await assert.rejects(() => installCommand('   ', {}), /请提供要安装的包名称/);
  });

  async function runInstall(
    spec: string,
    options: Parameters<typeof installCommand>[1]
  ): Promise<void> {
    const [name, constraint] = spec.split('@');
    if (!name) {
      throw new Error('spec must include包名称');
    }
    nextInstallDiagnostics = null;
    nextInstallResult = new Map([[name, constraint || '1.0.0']]);
    await installCommand(spec, options);
  }
});
