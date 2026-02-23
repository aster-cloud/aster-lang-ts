/**
 * 基于回溯的依赖解析器，实现约束合并、冲突检测与依赖图构建。
 */

import { satisfies, sortVersions } from './version-utils.js';
import { DependencyGraph } from './dependency-graph.js';
import { DiagnosticCode } from '../diagnostics/diagnostics.js';
import type { DependencyMap } from '../manifest.js';

type ConstraintTable = Map<string, string[]>;
type NormalizedOptions = {
  readonly timeout: number;
  readonly maxDepth: number;
};

const RESOLVER_ERROR_LABEL = {
  Timeout: 'DEPENDENCY_RESOLUTION_TIMEOUT',
  Conflict: 'VERSION_CONFLICT_UNRESOLVABLE',
  MissingPackage: 'PACKAGE_NOT_FOUND',
} as const;

export interface ResolverOptions {
  readonly timeout?: number;
  readonly maxDepth?: number;
}

export interface ResolvedDependencies {
  readonly packages: Map<string, string>;
  readonly graph: DependencyGraph;
}

export interface PackageRegistry {
  /**
   * 返回指定包的所有可用版本，若包不存在返回错误。
   */
  getAvailableVersions(name: string): string[] | Error;

  /**
   * 返回指定包/版本的依赖表，若版本不存在返回错误。
   */
  getDependencies(name: string, version: string): DependencyMap | Error;
}

type PackageVersions = Record<string, DependencyMap>;
type RegistryData = Record<string, PackageVersions>;

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_DEPTH = 100;

export class MockPackageRegistry implements PackageRegistry {
  private readonly data: RegistryData = {};

  constructor() {
    this.bootstrap();
  }

  getAvailableVersions(name: string): string[] | Error {
    const versions = this.data[name];
    if (!versions) {
      return new Error(
        `${RESOLVER_ERROR_LABEL.MissingPackage}(${DiagnosticCode.V003_PackageNotFound}): 未找到包 ${name}`
      );
    }
    return sortVersions(Object.keys(versions));
  }

  getDependencies(name: string, version: string): DependencyMap | Error {
    const versions = this.data[name];
    if (!versions) {
      return new Error(
        `${RESOLVER_ERROR_LABEL.MissingPackage}(${DiagnosticCode.V003_PackageNotFound}): 未找到包 ${name}`
      );
    }

    if (name === 'deep-package') {
      this.simulateHeavyLookup();
    }

    const dependencies = versions[version];
    if (!dependencies) {
      return new Error(
        `${RESOLVER_ERROR_LABEL.MissingPackage}(${DiagnosticCode.V003_PackageNotFound}): ${name} 的版本 ${version} 缺失`
      );
    }
    return { ...dependencies };
  }

  private bootstrap(): void {
    this.data['aster.http'] = {
      '3.0.0': { 'aster.time': '^2.0.0' },
      '2.5.0': { 'aster.time': '^1.5.0' },
      '2.1.0': {},
      '2.0.0': {},
    };

    this.data['aster.time'] = {
      '2.0.0': {},
      '1.5.3': {},
      '1.5.0': {},
      '1.0.0': {},
    };

    this.data['aster.sql'] = {
      '1.0.0': { 'aster.time': '~1.5.0' },
      '0.9.0': {},
    };

    this.createDeepChain('deep-chain', 32);
    this.createDeepChain('deep-package', 48);
  }

  private createDeepChain(rootName: string, length: number): void {
    for (let index = 0; index < length; index += 1) {
      const packageName = index === 0 ? rootName : `${rootName}-${index}`;
      const nextName = index === length - 1 ? null : `${rootName}-${index + 1}`;
      this.data[packageName] = {
        '1.0.0': nextName ? { [nextName]: '^1.0.0' } : {},
      };
    }
  }

  /**
   * 通过忙等模拟复杂依赖图遍历延迟，确保timeout逻辑可测。
   */
  private simulateHeavyLookup(): void {
    const target = Date.now() + 150;
    while (Date.now() < target) {
      // 忙等待，生成可预测的延迟
    }
  }
}

export class DependencyResolver {
  constructor(private readonly registry: PackageRegistry) {}

  resolve(rootDeps: DependencyMap, options: ResolverOptions = {}): ResolvedDependencies | Error {
    const normalized = this.normalizeOptions(options);
    const constraints = this.buildInitialConstraints(rootDeps);
    const resolved = new Map<string, string>();
    const packageDeps = new Map<string, DependencyMap>();
    const startTime = Date.now();

    return this.backtrack(constraints, resolved, packageDeps, 0, startTime, normalized);
  }

  private backtrack(
    constraints: ConstraintTable,
    resolved: Map<string, string>,
    packageDeps: Map<string, DependencyMap>,
    depth: number,
    startTime: number,
    options: NormalizedOptions
  ): ResolvedDependencies | Error {
    if (Date.now() - startTime >= options.timeout) {
      return new Error(
        `${RESOLVER_ERROR_LABEL.Timeout}(${DiagnosticCode.V001_DependencyResolutionTimeout}): 解析耗时超过 ${options.timeout}ms`
      );
    }

    if (depth > options.maxDepth) {
      return new Error(`超过最大深度${options.maxDepth}，请检查依赖链`);
    }

    const nextPackage = this.selectNextPackage(constraints, resolved);
    if (!nextPackage) {
      return this.buildResult(resolved, packageDeps);
    }

    const availableVersions = this.registry.getAvailableVersions(nextPackage);
    if (availableVersions instanceof Error) {
      return availableVersions;
    }

    const sortedVersions = sortVersions(availableVersions);
    const packageConstraints = constraints.get(nextPackage) ?? [];
    let lastError: Error | null = null;

    for (const version of sortedVersions) {
      if (!this.versionSatisfiesConstraints(version, packageConstraints)) {
        continue;
      }

      resolved.set(nextPackage, version);

      const dependencies = this.registry.getDependencies(nextPackage, version);
      if (dependencies instanceof Error) {
        lastError = dependencies;
        resolved.delete(nextPackage);
        packageDeps.delete(nextPackage);
        continue;
      }

      packageDeps.set(nextPackage, dependencies);
      const mergedConstraints = this.mergeConstraints(constraints, dependencies);
      const validation = this.validateConstraints(mergedConstraints, resolved);
      if (validation instanceof Error) {
        lastError = validation;
        resolved.delete(nextPackage);
        packageDeps.delete(nextPackage);
        continue;
      }

      const outcome = this.backtrack(
        mergedConstraints,
        resolved,
        packageDeps,
        depth + 1,
        startTime,
        options
      );

      if (!(outcome instanceof Error)) {
        return outcome;
      }

      resolved.delete(nextPackage);
      packageDeps.delete(nextPackage);

      if (this.isFatalError(outcome)) {
        return outcome;
      }

      lastError = outcome;
    }

    return (
      lastError ??
      new Error(
        `${RESOLVER_ERROR_LABEL.Conflict}(${DiagnosticCode.V002_VersionConflictUnresolvable}): 包 ${nextPackage} 无法满足约束`
      )
    );
  }

  private buildInitialConstraints(rootDeps: DependencyMap): ConstraintTable {
    const constraints: ConstraintTable = new Map();
    for (const [name, constraint] of Object.entries(rootDeps)) {
      constraints.set(name, [constraint]);
    }
    return constraints;
  }

  private normalizeOptions(options: ResolverOptions): NormalizedOptions {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    return {
      timeout: timeout > 0 ? timeout : DEFAULT_TIMEOUT,
      maxDepth: maxDepth > 0 ? maxDepth : DEFAULT_MAX_DEPTH,
    };
  }

  private mergeConstraints(base: ConstraintTable, dependencies: DependencyMap): ConstraintTable {
    const next = new Map<string, string[]>();
    for (const [name, list] of base.entries()) {
      next.set(name, [...list]);
    }

    for (const [depName, constraint] of Object.entries(dependencies)) {
      const existing = next.get(depName);
      if (existing) {
        existing.push(constraint);
      } else {
        next.set(depName, [constraint]);
      }
    }
    return next;
  }

  private validateConstraints(constraints: ConstraintTable, resolved: Map<string, string>): Error | null {
    for (const [name, packageConstraints] of constraints) {
      const availableVersions = this.registry.getAvailableVersions(name);
      if (availableVersions instanceof Error) {
        return availableVersions;
      }

      const candidateVersions = resolved.has(name)
        ? [resolved.get(name)!]
        : availableVersions;
      const hasSatisfyingVersion = candidateVersions.some((version) =>
        this.versionSatisfiesConstraints(version, packageConstraints)
      );

      if (!hasSatisfyingVersion) {
        return new Error(
          `${RESOLVER_ERROR_LABEL.Conflict}(${DiagnosticCode.V002_VersionConflictUnresolvable}): 包 ${name} 无可用版本满足 ${packageConstraints.join(', ')}`
        );
      }
    }
    return null;
  }

  private versionSatisfiesConstraints(version: string, constraints: string[]): boolean {
    return constraints.every((constraint) => satisfies(version, constraint));
  }

  private selectNextPackage(constraints: ConstraintTable, resolved: Map<string, string>): string | null {
    let target: string | null = null;
    let maxConstraints = -1;

    for (const [name, packageConstraints] of constraints) {
      if (resolved.has(name)) {
        continue;
      }
      const constraintCount = packageConstraints.length;
      if (constraintCount > maxConstraints || (constraintCount === maxConstraints && target && name < target)) {
        target = name;
        maxConstraints = constraintCount;
      }
    }

    return target;
  }

  private buildResult(
    resolved: Map<string, string>,
    packageDeps: Map<string, DependencyMap>
  ): ResolvedDependencies {
    const graph = new DependencyGraph();
    for (const [name, version] of resolved.entries()) {
      graph.addNode(name, version);
    }

    for (const [name, version] of resolved.entries()) {
      const dependencies = packageDeps.get(name) ?? {};
      const fromId = `${name}@${version}`;
      for (const [depName] of Object.entries(dependencies)) {
        const depVersion = resolved.get(depName);
        if (!depVersion) {
          continue;
        }
        graph.addEdge(fromId, `${depName}@${depVersion}`);
      }
    }

    return {
      packages: new Map(resolved),
      graph,
    };
  }

  private isFatalError(error: Error): boolean {
    const message = error.message;
    return (
      message.includes(RESOLVER_ERROR_LABEL.Timeout) || message.includes('超过最大深度')
    );
  }
}
