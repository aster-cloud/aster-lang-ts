import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installCommand } from '../../src/cli/commands/install.js';
import { listCommand } from '../../src/cli/commands/list.js';
import { seedLocalRegistryPackage } from './registry-utils.js';

describe('CLI 集成测试', { concurrency: false }, () => {
  const originalCwd = process.cwd();
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aster-cli-integration-'));
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('可从本地 registry 安装并通过 list 命令读取', async () => {
    await seedLocalRegistryPackage(workspace, 'aster.metrics', '1.0.0');

    await installCommand('aster.metrics', { registry: 'local' });

    const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8'));
    assert.equal(manifest.dependencies?.['aster.metrics'], '^1.0.0');

    const cacheManifest = JSON.parse(
      readFileSync(join('.aster', 'packages', 'aster.metrics', '1.0.0', 'manifest.json'), 'utf-8')
    );
    assert.equal(cacheManifest.name, 'aster.metrics');

    const rows = await captureJsonOutput(() => listCommand({ json: true }));
    const metrics = rows.find((pkg) => pkg.name === 'aster.metrics');
    assert.ok(metrics);
    assert.equal(metrics.installed, '1.0.0');
    assert.equal(metrics.outdated, false);
  });
});

async function captureJsonOutput(action: () => Promise<void>): Promise<any[]> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    output.push(
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
  const payload = output.join('').trim();
  return payload ? JSON.parse(payload) : [];
}
