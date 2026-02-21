import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Effect } from '../config/semantic.js';
import { parseEffect } from '../config/semantic.js';
import type { EffectSignature } from '../effects/effect_signature.js';

type EffectCache = Map<string, EffectSignature>;

const MODULE_NOT_FOUND = 'MODULE_NOT_FOUND';
const MODULE_PARSE_ERROR = 'MODULE_PARSE_ERROR';
const FUNCTION_PATTERN = /\bRule\s+([A-Za-z0-9_]+)/i;
const EFFECT_PATTERN = /It\s+performs\s+([A-Za-z]+)/i;
const MODULE_PATTERN = /^\s*Module\s+([A-Za-z0-9_.-]+)\./i;

export interface CacheEffectOptions {
  moduleName: string;
  uri?: string | null;
  signatures: Map<string, EffectSignature>;
  imports?: readonly string[];
}

/**
 * 扩展包含通配符的路径模式（如 .aster/cache/*）
 *
 * @param pattern 路径模式，可能包含 * 通配符
 * @returns 展开后的实际路径数组
 */
function expandGlobPattern(pattern: string): string[] {
  // 如果不包含通配符，直接返回
  if (!pattern.includes('*')) {
    return [pattern];
  }

  // 分割路径，找到第一个包含 * 的部分
  const parts = pattern.split('/');
  const wildcardIndex = parts.findIndex(p => p.includes('*'));

  if (wildcardIndex === -1) {
    return [pattern];
  }

  // 构建基础路径（通配符之前的部分）
  const basePath = parts.slice(0, wildcardIndex).join('/');
  const wildcardPart = parts[wildcardIndex];
  const remainingParts = parts.slice(wildcardIndex + 1);

  // 如果基础路径不存在，返回空数组
  if (!existsSync(basePath)) {
    return [];
  }

  try {
    const entries = readdirSync(basePath);
    const expanded: string[] = [];

    for (const entry of entries) {
      // 如果通配符是 *，匹配所有条目
      if (wildcardPart === '*') {
        const fullPath = join(basePath, entry);
        try {
          const stats = statSync(fullPath);
          if (stats.isDirectory()) {
            // 如果还有剩余路径部分，继续拼接
            if (remainingParts.length > 0) {
              const finalPath = join(fullPath, ...remainingParts);
              if (existsSync(finalPath)) {
                expanded.push(finalPath);
              }
            } else {
              expanded.push(fullPath);
            }
          }
        } catch {
          // 跳过无法访问的条目
        }
      }
    }

    return expanded;
  } catch {
    return [];
  }
}

export class ModuleCache {
  private readonly workspaceModules = new Map<string, EffectCache>();
  private readonly packageModules = new Map<string, EffectCache>();
  private readonly moduleByUri = new Map<string, string>();
  private readonly uriByModule = new Map<string, string>();
  private readonly importsByModule = new Map<string, Set<string>>();
  private readonly dependentsByModule = new Map<string, Set<string>>();
  private moduleSearchPaths: string[] = [];

  cacheModuleEffectSignatures(options: CacheEffectOptions): void {
    const { moduleName, uri, signatures, imports = [] } = options;
    if (!moduleName || moduleName === '<anonymous>') return;

    this.workspaceModules.set(moduleName, new Map(signatures));

    if (uri) {
      this.moduleByUri.set(uri, moduleName);
      this.uriByModule.set(moduleName, uri);
    }

    this.updateDependencies(moduleName, imports);
  }

  getModuleEffectSignatures(
    moduleName: string,
    searchPaths?: readonly string[]
  ): ReadonlyMap<string, EffectSignature> | undefined {
    if (!moduleName) return undefined;

    const workspace = this.workspaceModules.get(moduleName);
    if (workspace) return workspace;

    const pkgCache = this.packageModules.get(moduleName);
    if (pkgCache) return pkgCache;

    const paths = this.normalizeSearchPaths(searchPaths);
    if (paths.length === 0) return undefined;

    const loaded = this.loadModule(moduleName, paths);
    if (loaded instanceof Error) {
      if (!loaded.message.includes(MODULE_NOT_FOUND)) {
        console.warn(`[ModuleCache] 解析 ${moduleName} 失败: ${loaded.message}`);
      }
      return undefined;
    }
    return loaded;
  }

  loadModule(
    moduleName: string,
    searchPaths: readonly string[]
  ): ReadonlyMap<string, EffectSignature> | Error {
    const paths = this.normalizeSearchPaths(searchPaths);
    if (paths.length === 0) {
      return new Error(`${MODULE_NOT_FOUND}: ${moduleName}`);
    }

    for (const base of paths) {
      const resolved = this.resolveModuleFile(base, moduleName);
      if (!resolved || !existsSync(resolved)) continue;
      const parsed = this.parseEffectSignature(resolved, moduleName);
      if (parsed instanceof Error) return parsed;
      this.packageModules.set(moduleName, parsed);
      return parsed;
    }

    return new Error(`${MODULE_NOT_FOUND}: ${moduleName}`);
  }

  invalidateModuleEffectsByUri(uri: string): void {
    const moduleName = this.moduleByUri.get(uri);
    if (!moduleName) return;
    this.invalidateModuleEffects(moduleName);
  }

  invalidateModuleEffects(moduleName: string): void {
    const visited = new Set<string>();
    this.invalidateRecursive(moduleName, visited);
  }

  invalidatePackageCache(packageName: string): void {
    this.packageModules.delete(packageName);
  }

  clearModuleEffectCache(): void {
    this.workspaceModules.clear();
    this.packageModules.clear();
    this.moduleByUri.clear();
    this.uriByModule.clear();
    this.importsByModule.clear();
    this.dependentsByModule.clear();
  }

  setModuleSearchPaths(paths: readonly string[]): void {
    const expandedPaths: string[] = [];
    for (const path of paths) {
      const expanded = expandGlobPattern(path);
      expandedPaths.push(...expanded.map(p => resolve(p)));
    }
    this.moduleSearchPaths = Array.from(new Set(expandedPaths));
  }

  private updateDependencies(moduleName: string, imports: readonly string[]): void {
    const normalized = new Set(imports.filter(value => typeof value === 'string' && value.length > 0));
    const previous = this.importsByModule.get(moduleName);
    if (previous) {
      for (const dep of previous) {
        this.dependentsByModule.get(dep)?.delete(moduleName);
        if (this.dependentsByModule.get(dep)?.size === 0) {
          this.dependentsByModule.delete(dep);
        }
      }
    }

    this.importsByModule.set(moduleName, normalized);
    for (const dep of normalized) {
      let dependents = this.dependentsByModule.get(dep);
      if (!dependents) {
        dependents = new Set();
        this.dependentsByModule.set(dep, dependents);
      }
      dependents.add(moduleName);
    }
  }

  private invalidateRecursive(moduleName: string, visited: Set<string>): void {
    if (visited.has(moduleName)) return;
    visited.add(moduleName);

    this.workspaceModules.delete(moduleName);

    const imports = this.importsByModule.get(moduleName);
    if (imports) {
      for (const dep of imports) {
        this.dependentsByModule.get(dep)?.delete(moduleName);
        if (this.dependentsByModule.get(dep)?.size === 0) {
          this.dependentsByModule.delete(dep);
        }
      }
    }
    this.importsByModule.delete(moduleName);

    const uri = this.uriByModule.get(moduleName);
    if (uri) {
      this.uriByModule.delete(moduleName);
      this.moduleByUri.delete(uri);
    }

    const dependents = this.dependentsByModule.get(moduleName);
    this.dependentsByModule.delete(moduleName);

    if (!dependents) return;
    for (const dependent of dependents) {
      this.invalidateRecursive(dependent, visited);
    }
  }

  private normalizeSearchPaths(searchPaths?: readonly string[]): string[] {
    if (searchPaths && searchPaths.length > 0) {
      return Array.from(new Set(searchPaths.map(p => resolve(p))));
    }
    return this.moduleSearchPaths;
  }

  private resolveModuleFile(base: string, moduleName: string): string | null {
    if (!base || !moduleName) return null;
    const segments = moduleName.split('.').filter(Boolean);
    if (segments.length === 0) return null;
    return join(base, ...segments) + '.aster';
  }

  private parseEffectSignature(filePath: string, moduleName: string): EffectCache | Error {
    try {
      const content = readFileSync(filePath, 'utf8');
      return parseEffectSignatures(content, moduleName, filePath);
    } catch (error) {
      return new Error(`${MODULE_PARSE_ERROR}: ${(error as Error).message}`);
    }
  }
}

export const defaultModuleCache = new ModuleCache();

export function cacheModuleEffectSignatures(options: CacheEffectOptions): void {
  defaultModuleCache.cacheModuleEffectSignatures(options);
}

export function getModuleEffectSignatures(
  moduleName: string,
  searchPaths?: readonly string[]
): ReadonlyMap<string, EffectSignature> | undefined {
  return defaultModuleCache.getModuleEffectSignatures(moduleName, searchPaths);
}

export function invalidateModuleEffectsByUri(uri: string): void {
  defaultModuleCache.invalidateModuleEffectsByUri(uri);
}

export function invalidateModuleEffects(moduleName: string): void {
  defaultModuleCache.invalidateModuleEffects(moduleName);
}

export function clearModuleEffectCache(): void {
  defaultModuleCache.clearModuleEffectCache();
}

export function loadModule(
  moduleName: string,
  searchPaths: readonly string[]
): ReadonlyMap<string, EffectSignature> | Error {
  return defaultModuleCache.loadModule(moduleName, searchPaths);
}

export function invalidatePackageCache(packageName: string): void {
  defaultModuleCache.invalidatePackageCache(packageName);
}

export function setModuleSearchPaths(paths: readonly string[]): void {
  defaultModuleCache.setModuleSearchPaths(paths);
}

function parseEffectSignatures(
  content: string,
  moduleName: string,
  filePath: string
): EffectCache | Error {
  const functions = new Map<string, Set<Effect>>();
  let currentFunction: string | null = null;
  let headerModule: string | null = null;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!headerModule) {
      const moduleMatch = line.match(MODULE_PATTERN);
      if (moduleMatch) {
        headerModule = moduleMatch[1]?.trim() ?? null;
      }
    }

    const funcMatch = rawLine.match(FUNCTION_PATTERN);
    if (funcMatch) {
      currentFunction = funcMatch[1] ?? null;
      if (currentFunction && !functions.has(currentFunction)) {
        functions.set(currentFunction, new Set());
      }
    }

    if (!currentFunction) continue;
    const effectMatch = rawLine.match(EFFECT_PATTERN);
    if (!effectMatch) continue;
    const effectText = effectMatch[1];
    if (!effectText) continue;
    const effect = parseEffect(effectText.toLowerCase());
    if (!effect) continue;
    const bucket = functions.get(currentFunction);
    if (bucket) bucket.add(effect);
  }

  const normalizedModule = moduleName || headerModule || '';
  if (!normalizedModule) {
    return new Error(`${MODULE_PARSE_ERROR}: ${filePath} 缺少模块声明`);
  }
  if (headerModule && moduleName && headerModule !== moduleName) {
    return new Error(`${MODULE_PARSE_ERROR}: 请求模块 ${moduleName} 与 ${filePath} 不一致`);
  }

  const signatures: EffectCache = new Map();
  for (const [funcName, effects] of functions) {
    const qualifiedName = normalizedModule ? `${normalizedModule}.${funcName}` : funcName;
    const declared = new Set(effects);
    signatures.set(qualifiedName, {
      module: normalizedModule,
      function: funcName,
      qualifiedName,
      declared,
      inferred: new Set(declared),
      required: new Set(declared),
    });
  }
  return signatures;
}
