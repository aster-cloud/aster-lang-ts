import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Manifest } from '../../manifest.js';
import { parseManifest } from '../../package/manifest-parser.js';
import { parseLockfile } from '../../package/lockfile.js';
import { PackageRegistry, type RegistryConfig } from '../../package/package-registry.js';
import { maxSatisfying, sortVersions, parseVersion } from '../../package/version-utils.js';
import type { Diagnostic } from '../../diagnostics/diagnostics.js';
import { createDiagnosticsError } from '../utils/error-handler.js';
import { info, warn } from '../utils/logger.js';

const MANIFEST_FILE = 'manifest.json';
const LOCKFILE_NAME = '.aster.lock';

export interface ListOptions {
  outdated?: boolean;
  json?: boolean;
}

interface ListedPackage {
  readonly name: string;
  readonly scope: 'dependencies' | 'devDependencies';
  readonly constraint: string;
  readonly installed: string | null;
  readonly latest?: string | null;
  readonly compatible?: string | null;
  readonly outdated: boolean;
}

interface DependencyEntry {
  readonly name: string;
  readonly constraint: string;
  readonly scope: 'dependencies' | 'devDependencies';
}

interface LockInfo {
  readonly packages: Record<string, string>;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const manifestPath = resolve(process.cwd(), MANIFEST_FILE);
  const manifest = parseManifest(manifestPath);
  if (Array.isArray(manifest)) {
    throw createDiagnosticsError(manifest);
  }

  const deps = collectDependencies(manifest);
  if (deps.length === 0) {
    info('manifest.json 未声明任何依赖');
    if (options.json) {
      console.log('[]');
    }
    return;
  }

  const lockfilePath = resolve(process.cwd(), LOCKFILE_NAME);
  const lockInfo = readLockfile(lockfilePath);

  const registryConfig = options.outdated ? resolveDefaultRegistryConfig() : null;
  const registry = registryConfig ? new PackageRegistry(registryConfig) : null;

  const listed: ListedPackage[] = [];
  for (const dep of deps) {
    const installed = lockInfo.packages[dep.name] ?? null;
    let compatible: string | null = null;
    let latest: string | null = null;
    let outdated = false;

    if (options.outdated && registry) {
      const info = await fetchVersionInfo(registry, dep.name, dep.constraint);
      compatible = info.compatible;
      latest = info.latest;
      outdated = isOutdated(installed, compatible);
    }

    listed.push({
      name: dep.name,
      scope: dep.scope,
      constraint: dep.constraint,
      installed,
      compatible,
      latest,
      outdated,
    });
  }

  if (options.json) {
    console.log(`${JSON.stringify(listed, null, 2)}\n`);
    return;
  }

  printTable(listed, Boolean(options.outdated));
}

function collectDependencies(manifest: Manifest): DependencyEntry[] {
  const result: DependencyEntry[] = [];
  const dependencies = manifest.dependencies ?? {};
  for (const [name, constraint] of Object.entries(dependencies)) {
    result.push({ name, constraint, scope: 'dependencies' });
  }
  const devDependencies = manifest.devDependencies ?? {};
  for (const [name, constraint] of Object.entries(devDependencies)) {
    result.push({ name, constraint, scope: 'devDependencies' });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function readLockfile(lockfilePath: string): LockInfo {
  if (!existsSync(lockfilePath)) {
    return { packages: {} };
  }
  const parsed = parseLockfile(lockfilePath);
  if (parsed instanceof Error) {
    warn(`解析 .aster.lock 失败：${parsed.message}`);
    return { packages: {} };
  }
  const packages: Record<string, string> = {};
  for (const [name, pkg] of Object.entries(parsed.packages)) {
    packages[name] = pkg.version;
  }
  return { packages };
}

async function fetchVersionInfo(
  registry: PackageRegistry,
  packageName: string,
  constraint: string
): Promise<{ compatible: string | null; latest: string | null }> {
  const versions = await registry.listVersions(packageName);
  if (isDiagnosticArray(versions)) {
    throw createDiagnosticsError(versions);
  }
  const list: string[] = versions;
  if (!list || list.length === 0) {
    return { compatible: null, latest: null };
  }
  const sorted = sortVersions(list);
  const latest = sorted[0] ?? null;
  const compatible = maxSatisfying(sorted, constraint);
  return { compatible, latest };
}

function isOutdated(installed: string | null, compatible: string | null): boolean {
  if (!compatible) {
    return false;
  }
  if (!installed) {
    return true;
  }
  const installedSem = parseVersion(installed);
  const compatibleSem = parseVersion(compatible);
  if (!installedSem || !compatibleSem) {
    return installed !== compatible;
  }
  return compatibleSem.compare(installedSem) > 0;
}

function printTable(packages: ListedPackage[], showOutdated: boolean): void {
  const header = ['包名', '作用域', '版本约束', '已安装', showOutdated ? '最新兼容' : null, showOutdated ? '状态' : null]
    .filter(Boolean)
    .map((item) => item!)
    .join(' | ');
  info(header);
  for (const pkg of packages) {
    const columns = [pkg.name, pkg.scope === 'dependencies' ? 'prod' : 'dev', pkg.constraint, pkg.installed ?? '未锁定'];
    if (showOutdated) {
      columns.push(pkg.compatible ?? '未知');
      columns.push(pkg.outdated ? '↑ 可更新' : '✓ 最新');
    }
    console.log(columns.join(' | '));
  }
}

function resolveDefaultRegistryConfig(): RegistryConfig {
  const env = process.env.ASTER_REGISTRY?.trim();
  if (env) {
    return normalizeRegistryInput(env);
  }
  const localRegistry = resolve(process.cwd(), '.aster', 'local-registry');
  if (existsSync(localRegistry)) {
    return { baseUrl: 'local' };
  }
  return {};
}

function normalizeRegistryInput(source: string): RegistryConfig {
  if (!source) {
    return {};
  }
  if (source === 'local') {
    return { baseUrl: 'local' };
  }
  if (/^https?:\/\//i.test(source) || source.startsWith('file://')) {
    return { baseUrl: source };
  }
  return { baseUrl: resolve(process.cwd(), source) };
}

function isDiagnosticArray(value: unknown): value is Diagnostic[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    'code' in (value[0] as object)
  );
}
