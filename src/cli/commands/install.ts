import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Manifest } from '../../manifest.js';
import { parseManifest } from '../../package/manifest-parser.js';
import { PackageCache } from '../../package/package-cache.js';
import { PackageRegistry, type RegistryConfig } from '../../package/package-registry.js';
import { PackageInstaller } from '../../package/package-installer.js';
import { generateLockfile, parseLockfile, writeLockfile } from '../../package/lockfile.js';
import { DependencyGraph } from '../../package/dependency-graph.js';
import type { ResolvedDependencies } from '../../package/resolver.js';
import { createDiagnosticsError } from '../utils/error-handler.js';
import { info, success, warn } from '../utils/logger.js';

export interface InstallOptions {
  saveDev?: boolean;
  noLock?: boolean;
  registry?: string;
}

interface PackageSpec {
  name: string;
  constraint: string;
  explicitConstraint: boolean;
}

type DependencyField = 'dependencies' | 'devDependencies';

const MANIFEST_FILE = 'manifest.json';
const LOCKFILE_NAME = '.aster.lock';
const ASTER_DIR = '.aster';
const DEFAULT_CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30天缓存
const SKIP_LOCK_PATH = '__SKIP_LOCK__';

export async function installCommand(packageSpec: string, options: InstallOptions): Promise<void> {
  const spec = parsePackageSpec(packageSpec);

  const manifestPath = resolve(process.cwd(), MANIFEST_FILE);
  const manifest = ensureManifest(manifestPath);

  const asterRoot = ensureAsterDirectories();
  const cacheDir = join(asterRoot, 'packages');
  mkdirSync(cacheDir, { recursive: true });

  const lockfilePath = resolve(process.cwd(), LOCKFILE_NAME);
  if (!options.noLock) {
    ensureLockfile(lockfilePath);
  }

  const registryConfig = resolveRegistryConfig(options.registry);
  const registry = new PackageRegistry(registryConfig);
  const cache = new PackageCache({ cacheDir, ttl: DEFAULT_CACHE_TTL });
  const installer = new PackageInstaller(
    registry,
    cache,
    undefined,
    undefined,
    options.noLock ? SKIP_LOCK_PATH : lockfilePath
  );

  info(`正在安装 ${spec.name}${spec.explicitConstraint ? `（约束：${spec.constraint}）` : ''}`);
  const installResult = await installer.installMany(new Map([[spec.name, spec.constraint]]));
  if (Array.isArray(installResult)) {
    throw createDiagnosticsError(installResult);
  }

  const installedVersion = installResult.get(spec.name);
  if (!installedVersion) {
    throw new Error(`安装结束后未获得 ${spec.name} 的版本信息`);
  }

  const field: DependencyField = options.saveDev ? 'devDependencies' : 'dependencies';
  const savedVersion = spec.explicitConstraint ? spec.constraint : `^${installedVersion}`;
  updateManifest(manifest, field, spec.name, savedVersion);
  writeManifest(manifestPath, manifest);

  if (options.noLock) {
    warn('已根据 --no-lock 选项跳过 .aster.lock 更新');
  }

  success(`已安装 ${spec.name}@${installedVersion}`);
}

function parsePackageSpec(input: string): PackageSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('请提供要安装的包名称，例如 aster.math');
  }

  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    validatePackageName(trimmed);
    return { name: trimmed, constraint: '*', explicitConstraint: false };
  }

  const name = trimmed.slice(0, atIndex);
  const constraint = trimmed.slice(atIndex + 1) || '*';
  validatePackageName(name);
  return { name, constraint, explicitConstraint: constraint !== '*' };
}

function validatePackageName(name: string): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(name)) {
    throw new Error(`包名称 ${name} 无效，必须是形如 aster.math 的点分格式`);
  }
}

function ensureManifest(filePath: string): Manifest {
  if (!existsSync(filePath)) {
    const initial: Manifest = {
      name: 'app',
      version: '0.1.0',
      dependencies: {},
      devDependencies: {},
    };
    writeManifest(filePath, initial);
    return initial;
  }

  const parsed = parseManifest(filePath);
  if (Array.isArray(parsed)) {
    throw createDiagnosticsError(parsed);
  }

  return normalizeManifest(parsed);
}

function normalizeManifest(manifest: Manifest): Manifest {
  return {
    ...manifest,
    dependencies: { ...(manifest.dependencies ?? {}) },
    devDependencies: { ...(manifest.devDependencies ?? {}) },
  };
}

function writeManifest(filePath: string, manifest: Manifest): void {
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(filePath, payload, 'utf-8');
}

function updateManifest(manifest: Manifest, field: DependencyField, pkg: string, version: string): void {
  const target = { ...(manifest[field] ?? {}) } as Record<string, string>;
  target[pkg] = version;
  manifest[field] = sortDependencyMap(target);
}

function sortDependencyMap(map: Record<string, string>): Record<string, string> {
  const sortedKeys = Object.keys(map).sort((a, b) => a.localeCompare(b));
  const result: Record<string, string> = {};
  for (const key of sortedKeys) {
    result[key] = map[key]!;
  }
  return result;
}

function ensureAsterDirectories(): string {
  const root = resolve(process.cwd(), ASTER_DIR);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'packages'), { recursive: true });
  return root;
}

function ensureLockfile(filePath: string): void {
  const parsed = parseLockfile(filePath);
  if (!(parsed instanceof Error)) {
    return;
  }

  if (!parsed.message.includes('not found')) {
    throw new Error(`无法解析现有锁文件：${parsed.message}`);
  }

  const emptyResolved: ResolvedDependencies = {
    packages: new Map(),
    graph: new DependencyGraph(),
  };
  writeLockfile(generateLockfile(emptyResolved), filePath);
}

function resolveRegistryConfig(raw?: string): RegistryConfig {
  if (!raw) {
    return {};
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('file://')) {
    return { baseUrl: trimmed };
  }
  if (trimmed === 'local') {
    return { baseUrl: 'local' };
  }
  return { baseUrl: resolve(process.cwd(), trimmed) };
}
