import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seedLocalRegistryPackage } from '../cli/registry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..');
const cliScript = join(repoRoot, 'dist', 'scripts', 'aster.js');
const execFileAsync = promisify(execFile);

describe('CLI 包管理 E2E', { concurrency: false }, () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aster-cli-e2e-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('install + list 在真实 CLI 下协同工作', async () => {
    await seedLocalRegistryPackage(workspace, 'aster.metrics', '1.0.0');
    await seedLocalRegistryPackage(workspace, 'aster.analytics', '2.2.0');

    await runCli(workspace, ['install', 'aster.metrics', '--registry', 'local']);
    await runCli(workspace, ['install', 'aster.analytics@2.2.0', '--registry', 'local', '--save-dev']);

    const manifest = JSON.parse(readFileSync(join(workspace, 'manifest.json'), 'utf-8'));
    assert.equal(manifest.dependencies?.['aster.metrics'], '^1.0.0');
    assert.equal(manifest.devDependencies?.['aster.analytics'], '2.2.0');

    const { stdout } = await runCli(workspace, ['list', '--json', '--outdated']);
    const rows = JSON.parse(stdout.trim());

    const metrics = rows.find((pkg: any) => pkg.name === 'aster.metrics');
    assert.ok(metrics);
    assert.equal(metrics.installed, '1.0.0');
    assert.equal(metrics.scope, 'dependencies');

    const analytics = rows.find((pkg: any) => pkg.name === 'aster.analytics');
    assert.ok(analytics);
    assert.equal(analytics.installed, '2.2.0');
    assert.equal(analytics.scope, 'devDependencies');
  });
});

async function runCli(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [cliScript, ...args], {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}
