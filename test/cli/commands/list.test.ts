import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listCommand } from '../../../src/cli/commands/list.js';
import { PackageRegistry } from '../../../src/package/package-registry.js';

describe('listCommand', { concurrency: false }, () => {
  const originalCwd = process.cwd();
  const originalListVersions = PackageRegistry.prototype.listVersions;
  let workspace: string;
  let versionMap = new Map<string, string[]>();

  before(() => {
    PackageRegistry.prototype.listVersions = async function (packageName: string) {
      return versionMap.get(packageName) ?? [];
    };
  });

  after(() => {
    PackageRegistry.prototype.listVersions = originalListVersions;
  });

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aster-list-unit-'));
    process.chdir(workspace);
    versionMap = new Map();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('JSON 输出包含 manifest 依赖与锁定版本', async () => {
    writeFileSync(
      'manifest.json',
      JSON.stringify(
        {
          name: 'cli.app',
          version: '0.1.0',
          dependencies: { 'aster.alpha': '^1.0.0' },
          devDependencies: { 'aster.devkit': '~0.3.0' },
        },
        null,
        2
      )
    );
    writeFileSync(
      '.aster.lock',
      JSON.stringify(
        {
          version: '1.0',
          packages: {
            'aster.alpha': { version: '1.2.0', resolved: '' },
            'aster.devkit': { version: '0.3.2', resolved: '' },
          },
        },
        null,
        2
      )
    );

    const rows = await captureListJson(() => listCommand({ json: true }));
    assert.deepEqual(
      rows.map((pkg) => pkg.name),
      ['aster.alpha', 'aster.devkit']
    );

    const alpha = rows.find((pkg) => pkg.name === 'aster.alpha');
    assert.ok(alpha);
    assert.equal(alpha.scope, 'dependencies');
    assert.equal(alpha.installed, '1.2.0');
    assert.equal(alpha.constraint, '^1.0.0');
    assert.equal(alpha.outdated, false);
  });

  it('在 --outdated 与 --json 组合时输出最新兼容版本', async () => {
    writeFileSync(
      'manifest.json',
      JSON.stringify(
        {
          name: 'cli.app',
          version: '0.1.0',
          dependencies: { 'aster.alpha': '^1.0.0' },
          devDependencies: { 'aster.devkit': '^2.0.0' },
        },
        null,
        2
      )
    );
    writeFileSync(
      '.aster.lock',
      JSON.stringify(
        {
          version: '1.0',
          packages: {
            'aster.alpha': { version: '1.2.0', resolved: '' },
            'aster.devkit': { version: '2.1.0', resolved: '' },
          },
        },
        null,
        2
      )
    );
    versionMap.set('aster.alpha', ['1.2.0', '1.5.0']);
    versionMap.set('aster.devkit', ['2.1.0']);

    const rows = await captureListJson(() => listCommand({ json: true, outdated: true }));
    const alpha = rows.find((pkg) => pkg.name === 'aster.alpha');
    assert.ok(alpha);
    assert.equal(alpha.compatible, '1.5.0');
    assert.equal(alpha.latest, '1.5.0');
    assert.equal(alpha.outdated, true);

    const devkit = rows.find((pkg) => pkg.name === 'aster.devkit');
    assert.ok(devkit);
    assert.equal(devkit.compatible, '2.1.0');
    assert.equal(devkit.outdated, false);
  });
});

async function captureListJson(action: () => Promise<void>): Promise<any[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(
      args
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ')
    );
  };
  try {
    await action();
  } finally {
    console.log = originalLog;
  }
  const payload = logs.join('').trim();
  return payload ? JSON.parse(payload) : [];
}
