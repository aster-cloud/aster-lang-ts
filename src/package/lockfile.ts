/**
 * aster.lock 文件生成与读写工具。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { ResolvedDependencies } from './resolver.js';

const LOCKFILE_VERSION = '1.0';

export interface LockedPackage {
  version: string;
  resolved: string;
  integrity?: string;
  dependencies?: Record<string, string>;
}

export interface Lockfile {
  version: string;
  packages: Record<string, LockedPackage>;
}

export function generateLockfile(resolved: ResolvedDependencies): Lockfile {
  const packages: Record<string, LockedPackage> = {};
  const packageEntries = Array.from(resolved.packages.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, version] of packageEntries) {
    const dependencies = extractDependencies(resolved, name, version);
    packages[name] = {
      version,
      resolved: '',
      ...(dependencies && Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    };
  }

  return {
    version: LOCKFILE_VERSION,
    packages,
  };
}

export function parseLockfile(filePath: string): Lockfile | Error {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return new Error(`Lockfile not found: ${filePath}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    const err = error as Error;
    return new Error(`Invalid lockfile format: ${err.message}`);
  }

  if (!data || typeof data !== 'object') {
    return new Error('Invalid lockfile format: root is not an object');
  }

  const parsed = data as Partial<Lockfile>;
  if (!parsed.version || parsed.version !== LOCKFILE_VERSION) {
    return new Error(`Unsupported lockfile version: ${parsed.version ?? 'unknown'}`);
  }

  if (!parsed.packages || typeof parsed.packages !== 'object') {
    return new Error('Invalid lockfile format: packages missing');
  }

  const normalizedPackages: Record<string, LockedPackage> = {};
  for (const [name, pkg] of Object.entries(parsed.packages)) {
    if (!pkg || typeof pkg !== 'object') {
      return new Error(`Invalid lockfile entry for package ${name}`);
    }
    const version = (pkg as LockedPackage).version;
    if (!version || typeof version !== 'string') {
      return new Error(`Invalid version for package ${name}`);
    }

    const resolved = typeof (pkg as LockedPackage).resolved === 'string' ? (pkg as LockedPackage).resolved : '';
    const integrity = typeof (pkg as LockedPackage).integrity === 'string' ? (pkg as LockedPackage).integrity : undefined;
    const dependencies = sanitizeDependencies((pkg as LockedPackage).dependencies);
    normalizedPackages[name] = {
      version,
      resolved,
      ...(integrity ? { integrity } : {}),
      ...(dependencies ? { dependencies } : {}),
    };
  }

  return {
    version: LOCKFILE_VERSION,
    packages: normalizedPackages,
  };
}

export function mergeLockfile(existing: Lockfile, newDeps: ResolvedDependencies): Lockfile {
  const base: Record<string, LockedPackage> = {};
  for (const [name, pkg] of Object.entries(existing.packages)) {
    base[name] = cloneLockedPackage(pkg);
  }

  const updated = generateLockfile(newDeps);
  for (const [name, pkg] of Object.entries(updated.packages)) {
    base[name] = cloneLockedPackage(pkg);
  }

  return {
    version: LOCKFILE_VERSION,
    packages: base,
  };
}

export function writeLockfile(lockfile: Lockfile, filePath: string): void {
  const payload = `${JSON.stringify(lockfile, null, 2)}\n`;
  writeFileSync(filePath, payload, 'utf-8');
}

export function updateLockfileEntry(
  lockfilePath: string,
  packageName: string,
  version: string,
  resolved: string,
  integrity: string
): void | Error {
  const lockfile = parseLockfile(lockfilePath);
  if (lockfile instanceof Error) {
    return lockfile;
  }

  if (!lockfile.packages[packageName]) {
    lockfile.packages[packageName] = {
      version,
      resolved,
      integrity,
    };
  } else {
    lockfile.packages[packageName] = {
      ...lockfile.packages[packageName],
      version,
      resolved,
      integrity,
    };
  }

  writeLockfile(lockfile, lockfilePath);
}

function extractDependencies(
  resolved: ResolvedDependencies,
  name: string,
  version: string
): Record<string, string> | undefined {
  const nodes = resolved.graph.getDirectDependencies(name, version);
  if (!nodes || nodes.length === 0) {
    return undefined;
  }

  const dependencies: Record<string, string> = {};
  const sorted = nodes.sort((a, b) => a.name.localeCompare(b.name));
  for (const node of sorted) {
    dependencies[node.name] = node.version;
  }
  return dependencies;
}

function cloneLockedPackage(pkg: LockedPackage): LockedPackage {
  return {
    version: pkg.version,
    resolved: pkg.resolved,
    ...(pkg.integrity ? { integrity: pkg.integrity } : {}),
    ...(pkg.dependencies ? { dependencies: { ...pkg.dependencies } } : {}),
  };
}

function sanitizeDependencies(input?: Record<string, string>): Record<string, string> | undefined {
  if (!input) {
    return undefined;
  }
  const entries = Object.entries(input).filter(([, value]) => typeof value === 'string');
  if (entries.length === 0) {
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [dep, value] of entries) {
    normalized[dep] = value;
  }
  return normalized;
}
