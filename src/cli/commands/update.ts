import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Manifest, DependencyMap } from '../../manifest.js';
import { parseManifest } from '../../package/manifest-parser.js';
import { PackageRegistry, type RegistryConfig } from '../../package/package-registry.js';
import { PackageCache } from '../../package/package-cache.js';
import { PackageInstaller } from '../../package/package-installer.js';
import { parseLockfile } from '../../package/lockfile.js';
import { DependencyResolver } from '../../package/resolver.js';
import type { PackageRegistry as ResolverRegistry } from '../../package/resolver.js';
import { maxSatisfying } from '../../package/version-utils.js';
import { createDiagnosticsError } from '../utils/error-handler.js';
import { info, success, warn } from '../utils/logger.js';
import type { Diagnostic } from '../../diagnostics/diagnostics.js';

const MANIFEST_FILE = 'manifest.json';
const LOCKFILE_NAME = '.aster.lock';
const ASTER_DIR = '.aster';
const DEFAULT_CACHE_TTL = 1000 * 60 * 60 * 24 * 30;

interface DependencyRecord {
  field: 'dependencies' | 'devDependencies';
  constraint: string;
}

interface UpdatePlan {
  name: string;
  from: string | null;
  to: string;
  constraint: string;
  field: 'dependencies' | 'devDependencies';
  dependencies: DependencyMap;
}

export async function updateCommand(targetPackage?: string): Promise<void> {
  const manifestPath = resolve(process.cwd(), MANIFEST_FILE);
  const manifest = parseManifest(manifestPath);
  if (Array.isArray(manifest)) {
    throw createDiagnosticsError(manifest);
  }

  const dependencyTable = collectDependencyTable(manifest);
  if (dependencyTable.size === 0) {
    info('manifest.json 未包含任何可更新的依赖');
    return;
  }

  const targetNames = selectTargets(dependencyTable, targetPackage);
  if (targetNames.length === 0) {
    info('未匹配到需要更新的依赖');
    return;
  }

  const asterRoot = ensureAsterDirectories();
  const cacheDir = join(asterRoot, 'packages');
  const lockfilePath = resolve(process.cwd(), LOCKFILE_NAME);
  ensureLockfileExists(lockfilePath);

  const registry = new PackageRegistry(resolveDefaultRegistryConfig());
  const cache = new PackageCache({ cacheDir, ttl: DEFAULT_CACHE_TTL });
  const installer = new PackageInstaller(registry, cache, undefined, undefined, lockfilePath);

  const lockSnapshot = readLockSnapshot(lockfilePath);
  const plans: UpdatePlan[] = [];

  for (const name of targetNames) {
    const record = dependencyTable.get(name)!;
    const versions = await registry.listVersions(name);
    if (isDiagnosticArray(versions)) {
      throw createDiagnosticsError(versions);
    }
    if (versions.length === 0) {
      throw new Error(`未在注册表中找到 ${name} 的任何版本`);
    }
    const compatible = maxSatisfying(versions, record.constraint);
    if (!compatible) {
      throw new Error(`没有版本同时满足 ${name} 的约束：${record.constraint}`);
    }

    const current = lockSnapshot[name] ?? null;
    if (current === compatible) {
      info(`${name}@${current} 已是最新兼容版本`);
      continue;
    }

    const installResult = await installer.install(name, compatible);
    if (isDiagnosticArray(installResult)) {
      throw createDiagnosticsError(installResult);
    }
    const installedVersion = installResult;

    const dependencies = (await readCachedDependencies(cacheDir, name, installedVersion)) ?? {};
    const updatedConstraint = deriveConstraint(record.constraint, installedVersion);
    updateManifestField(manifest, record.field, name, updatedConstraint);

    plans.push({
      name,
      from: current,
      to: installedVersion,
      constraint: updatedConstraint,
      field: record.field,
      dependencies,
    });

    info(`已更新 ${name}: ${current ?? '未安装'} → ${installedVersion}`);
  }

  if (plans.length === 0) {
    info('所有目标依赖均已是最新兼容版本');
    return;
  }

  writeManifest(manifestPath, manifest);

  await revalidateWithResolver(plans, cacheDir, lockSnapshot);

  success(`已完成 ${plans.length} 个依赖的更新`);
}

function collectDependencyTable(manifest: Manifest): Map<string, DependencyRecord> {
  const table = new Map<string, DependencyRecord>();
  const deps = manifest.dependencies ?? {};
  for (const [name, constraint] of Object.entries(deps)) {
    table.set(name, { field: 'dependencies', constraint });
  }
  const devDeps = manifest.devDependencies ?? {};
  for (const [name, constraint] of Object.entries(devDeps)) {
    table.set(name, { field: 'devDependencies', constraint });
  }
  return table;
}

function selectTargets(
  table: Map<string, DependencyRecord>,
  explicit?: string
): string[] {
  if (!explicit) {
    return Array.from(table.keys()).sort((a, b) => a.localeCompare(b));
  }
  if (!table.has(explicit)) {
    throw new Error(`依赖 ${explicit} 未在 manifest.json 中声明`);
  }
  return [explicit];
}

function ensureAsterDirectories(): string {
  const root = resolve(process.cwd(), ASTER_DIR);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'packages'), { recursive: true });
  return root;
}

function ensureLockfileExists(lockfilePath: string): void {
  if (existsSync(lockfilePath)) {
    return;
  }
  const payload = JSON.stringify({ version: '1.0', packages: {} }, null, 2);
  writeFileSync(lockfilePath, `${payload}\n`, 'utf-8');
}

function readLockSnapshot(lockfilePath: string): Record<string, string> {
  const parsed = parseLockfile(lockfilePath);
  if (parsed instanceof Error) {
    warn(`读取 .aster.lock 失败：${parsed.message}`);
    return {};
  }
  const snapshot: Record<string, string> = {};
  for (const [name, pkg] of Object.entries(parsed.packages)) {
    snapshot[name] = pkg.version;
  }
  return snapshot;
}

function deriveConstraint(original: string, version: string): string {
  if (original.startsWith('^') || original.startsWith('~')) {
    return `${original[0]}${version}`;
  }
  return version;
}

function updateManifestField(
  manifest: Manifest,
  field: 'dependencies' | 'devDependencies',
  name: string,
  version: string
): void {
  const source = field === 'dependencies' ? (manifest.dependencies ?? (manifest.dependencies = {})) : (manifest.devDependencies ?? (manifest.devDependencies = {}));
  source[name] = version;
  const sortedKeys = Object.keys(source).sort((a, b) => a.localeCompare(b));
  const sorted: Record<string, string> = {};
  for (const key of sortedKeys) {
    sorted[key] = source[key]!;
  }
  if (field === 'dependencies') {
    manifest.dependencies = sorted;
  } else {
    manifest.devDependencies = sorted;
  }
}

function writeManifest(manifestPath: string, manifest: Manifest): void {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

async function readCachedDependencies(
  cacheDir: string,
  name: string,
  version: string
): Promise<DependencyMap | null> {
  try {
    const manifestPath = resolve(cacheDir, name, version, 'manifest.json');
    if (!existsSync(manifestPath)) {
      return null;
    }
    const parsed = parseManifest(manifestPath);
    if (Array.isArray(parsed)) {
      return {};
    }
    return parsed.dependencies ?? {};
  } catch {
    return null;
  }
}

async function revalidateWithResolver(
  plans: UpdatePlan[],
  cacheDir: string,
  lockSnapshot: Record<string, string>
): Promise<void> {
  const store = new Map<string, { version: string; dependencies: DependencyMap }>();
  for (const plan of plans) {
    store.set(plan.name, { version: plan.to, dependencies: plan.dependencies });
  }
  for (const [name, version] of Object.entries(lockSnapshot)) {
    if (store.has(name)) {
      continue;
    }
    const deps = (await readCachedDependencies(cacheDir, name, version)) ?? {};
    store.set(name, { version, dependencies: deps });
  }

  const registry = new LocalResolverRegistry(store);
  const resolver = new DependencyResolver(registry);
  const root: DependencyMap = {};
  for (const plan of plans) {
    root[plan.name] = plan.constraint;
  }
  const resolved = resolver.resolve(root, { timeout: 5_000 });
  if (resolved instanceof Error) {
    throw resolved;
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

class LocalResolverRegistry implements ResolverRegistry {
  constructor(
    private readonly store: Map<string, { version: string; dependencies: DependencyMap }>
  ) {}

  getAvailableVersions(name: string): string[] | Error {
    const entry = this.store.get(name);
    if (!entry) {
      return new Error(`Resolver 无法获取 ${name} 的版本`);
    }
    return [entry.version];
  }

  getDependencies(name: string, version: string): DependencyMap | Error {
    const entry = this.store.get(name);
    if (!entry || entry.version !== version) {
      return new Error(`Resolver 缺少 ${name}@${version} 的依赖声明`);
    }
    return { ...entry.dependencies };
  }
}
