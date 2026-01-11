import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { PackageRegistry } from '../../package/package-registry.js';
import { sortVersions } from '../../package/version-utils.js';
import type { Manifest } from '../../manifest.js';
import type { Diagnostic } from '../../diagnostics/diagnostics.js';
import { info, warn } from '../utils/logger.js';

interface SearchResult {
  name: string;
  version: string;
  description: string;
  source: 'local' | 'remote';
}

type PackageManifest = Manifest & { description?: string };

export async function searchCommand(keyword: string): Promise<void> {
  const normalized = keyword.trim();
  if (!normalized) {
    throw new Error('请输入要搜索的关键字，例如 math 或 aster.math');
  }

  const localResults = await searchLocal(normalized);
  const seen = new Set(localResults.map((item) => item.name));

  const remoteResults = await searchRemote(normalized, seen);
  const all = [...localResults, ...remoteResults];

  if (all.length === 0) {
    info(`未找到包含 “${normalized}” 的包`);
    return;
  }

  printResults(all);
}

async function searchLocal(keyword: string): Promise<SearchResult[]> {
  const registryDir = locateLocalRegistry();
  if (!existsSync(registryDir)) {
    return [];
  }

  const entries = await fs.readdir(registryDir, { withFileTypes: true });
  const matches = entries.filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes(keyword.toLowerCase()));
  const results: SearchResult[] = [];

  for (const entry of matches) {
    const packageDir = join(registryDir, entry.name);
    const versionFile = await resolveLatestLocalTarball(packageDir);
    if (!versionFile) {
      continue;
    }
    const manifest = await readManifestFromTarball(versionFile.file);
    const description = manifest?.description ?? '未提供描述';
    results.push({ name: entry.name, version: versionFile.version, description, source: 'local' });
  }

  return results;
}

async function resolveLatestLocalTarball(
  packageDir: string
): Promise<{ version: string; file: string } | null> {
  const files = await fs.readdir(packageDir);
  const versions: string[] = [];
  const mapping: Record<string, string> = {};
  for (const file of files) {
    if (!file.endsWith('.tar.gz')) {
      continue;
    }
    const version = file.replace(/\.tar\.gz$/u, '');
    versions.push(version);
    mapping[version] = join(packageDir, file);
  }
  if (versions.length === 0) {
    return null;
  }
  const sorted = sortVersions(versions);
  const latest = sorted[0]!;
  return { version: latest, file: mapping[latest]! };
}

async function searchRemote(keyword: string, seen: Set<string>): Promise<SearchResult[]> {
  const registry = new PackageRegistry({});
  const candidates = buildRemoteCandidates(keyword);
  const results: SearchResult[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    try {
      const versions = await registry.listVersions(candidate);
      if (isDiagnosticArray(versions)) {
        warn(`远程搜索 ${candidate} 失败：${versions[0]?.message ?? '未知错误'}`);
        continue;
      }
      if (!versions || versions.length === 0) {
        continue;
      }
      const sorted = sortVersions(versions);
      const latest = sorted[0]!;
      const manifest = await downloadManifest(registry, candidate, latest);
      const description = manifest?.description ?? '未提供描述';
      results.push({ name: candidate, version: latest, description, source: 'remote' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`远程搜索 ${candidate} 时发生错误：${message}`);
    }
  }

  return results;
}

function buildRemoteCandidates(keyword: string): string[] {
  const trimmed = keyword.trim();
  const candidates = new Set<string>();
  if (trimmed.includes('.')) {
    candidates.add(trimmed);
  } else {
    candidates.add(trimmed);
    candidates.add(`aster.${trimmed}`);
  }
  return Array.from(candidates);
}

async function downloadManifest(
  registry: PackageRegistry,
  packageName: string,
  version: string
): Promise<PackageManifest | null> {
  const tempDir = await mkdtemp(join(tmpdir(), 'aster-search-'));
  const tarballPath = join(tempDir, `${packageName.replace(/[\\/]/g, '-')}-${version}.tar.gz`);
  const result = await registry.downloadPackage(packageName, version, tarballPath);
  try {
    if (isDiagnosticArray(result)) {
      const message = result.map((diag) => `[${diag.code}] ${diag.message}`).join('; ');
      throw new Error(message);
    }
    const manifest = await readManifestFromTarball(tarballPath);
    return manifest;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readManifestFromTarball(tarballPath: string): Promise<PackageManifest | null> {
  try {
    let content = '';
    let found = false;
    await tar.t({
      file: tarballPath,
      onentry(entry) {
        if (entry.path === 'manifest.json') {
          found = true;
          entry.on('data', (chunk: Buffer) => {
            content += chunk.toString('utf-8');
          });
        }
      },
    });
    if (!found) {
      return null;
    }
    return JSON.parse(content) as PackageManifest;
  } catch {
    return null;
  }
}

function printResults(results: SearchResult[]): void {
  info('来源 | 包名 | 最新版本 | 描述');
  for (const item of results) {
    console.log(`${item.source === 'local' ? '本地' : '远程'} | ${item.name} | ${item.version} | ${item.description}`);
  }
}

function locateLocalRegistry(): string {
  let current = process.cwd();
  while (true) {
    const candidate = resolve(current, '.aster', 'local-registry');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(current, '..');
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return resolve(process.cwd(), '.aster', 'local-registry');
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
