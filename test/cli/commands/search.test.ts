import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { searchCommand } from '../../../src/cli/commands/search.js';
import { PackageRegistry } from '../../../src/package/package-registry.js';
import type { Diagnostic } from '../../../src/diagnostics/diagnostics.js';

describe('searchCommand', { concurrency: false }, () => {
  const originalCwd = process.cwd();
  const originalListVersions = PackageRegistry.prototype.listVersions;
  const originalDownloadPackage = PackageRegistry.prototype.downloadPackage;

  let workspace: string;
  let listVersionsImpl: (name: string) => Promise<string[] | Diagnostic[]>;
  let downloadPackageImpl: (
    name: string,
    version: string,
    destPath: string
  ) => Promise<void | Diagnostic[]>;
  let remoteLookups: string[];

  before(() => {
    listVersionsImpl = async () => [];
    downloadPackageImpl = async () => {};

    PackageRegistry.prototype.listVersions = async function (name: string) {
      remoteLookups.push(name);
      return listVersionsImpl(name);
    };

    PackageRegistry.prototype.downloadPackage = async function (
      name: string,
      version: string,
      destPath: string
    ) {
      return downloadPackageImpl(name, version, destPath);
    };
  });

  after(() => {
    PackageRegistry.prototype.listVersions = originalListVersions;
    PackageRegistry.prototype.downloadPackage = originalDownloadPackage;
  });

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aster-search-unit-'));
    process.chdir(workspace);
    remoteLookups = [];
    listVersionsImpl = async () => [];
    downloadPackageImpl = async () => {};
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('可以扫描本地 registry 并输出 manifest 描述', async () => {
    await createLocalPackage('aster.math', '1.2.0', '本地 math 描述');

    const output = await captureConsole(() => searchCommand('math'));

    assert.ok(
      output.logs.some((line) => line.includes('本地 | aster.math | 1.2.0 | 本地 math 描述')),
      '应输出本地包行'
    );
  });

  it('支持远程注册表搜索并打印最新版本', async () => {
    listVersionsImpl = async (name) => {
      if (name === 'aster.remote') {
        return ['0.9.0', '1.3.0'];
      }
      return [];
    };
    downloadPackageImpl = async (name, version, destPath) => {
      await writeManifestTarball(destPath, {
        name,
        version,
        description: '远程描述',
      });
    };

    const output = await captureConsole(() => searchCommand('aster.remote'));

    assert.ok(
      output.logs.some((line) => line.includes('远程 | aster.remote | 1.3.0 | 远程描述')),
      '应列出远程包'
    );
  });

  it('关键字可模糊匹配 aster.*，确保列表包含远程结果', async () => {
    listVersionsImpl = async (name) => {
      if (name === 'aster.math') {
        return ['1.2.0'];
      }
      return [];
    };
    downloadPackageImpl = async (name, version, destPath) => {
      await writeManifestTarball(destPath, {
        name,
        version,
        description: '远程 math 描述',
      });
    };

    const output = await captureConsole(() => searchCommand('math'));

    assert.ok(remoteLookups.includes('math'), '应首先尝试原始关键词');
    assert.ok(remoteLookups.includes('aster.math'), '应追加 aster.* 候选');
    assert.ok(
      output.logs.some((line) => line.includes('远程 | aster.math | 1.2.0 | 远程 math 描述')),
      '应列出模糊匹配结果'
    );
  });

  it('未命中任何候选时提示空结果', async () => {
    const output = await captureConsole(() => searchCommand('ghost'));
    assert.ok(
      output.logs.some((line) => line.includes('未找到包含 “ghost” 的包')),
      '应输出空结果提示'
    );
  });

  it('远程查询失败会记录警告并继续', async () => {
    listVersionsImpl = async () => {
      throw new Error('registry down');
    };

    const output = await captureConsole(() => searchCommand('aster.error'));

    assert.ok(
      output.warns.some((line) => line.includes('远程搜索 aster.error 时发生错误')),
      '应输出远程错误提示'
    );
  });

  async function createLocalPackage(name: string, version: string, description: string): Promise<void> {
    const packageDir = join(workspace, '.aster', 'local-registry', name);
    mkdirSync(packageDir, { recursive: true });
    const tarballPath = join(packageDir, `${version}.tar.gz`);
    await writeManifestTarball(tarballPath, { name, version, description });
  }

  async function writeManifestTarball(
    tarballPath: string,
    manifest: { name: string; version: string; description?: string }
  ): Promise<void> {
    mkdirSync(dirname(tarballPath), { recursive: true });
    const staging = mkdtempSync(join(tmpdir(), 'aster-search-pkg-'));
    try {
      writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      await tar.create({ gzip: true, cwd: staging, file: tarballPath }, ['manifest.json']);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  async function captureConsole(action: () => Promise<void>): Promise<{ logs: string[]; warns: string[] }> {
    const logs: string[] = [];
    const warns: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    };
    try {
      await action();
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
    return { logs, warns };
  }
});
