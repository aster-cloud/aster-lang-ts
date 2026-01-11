import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { PackageRegistry } from './package-registry.js';
import { PackageCache } from './package-cache.js';
import { parseManifest } from './manifest-parser.js';
import { maxSatisfying } from './version-utils.js';
import { DependencyGraph } from './dependency-graph.js';
import { updateLockfileEntry } from './lockfile.js';
import type { ModuleCache } from '../lsp/module_cache.js';
import {
  type Diagnostic,
  DiagnosticCode,
  DiagnosticBuilder,
  dummyPosition,
} from '../diagnostics/diagnostics.js';

function isDiagnostic(value: unknown): value is Diagnostic[] {
  return Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' && 'severity' in value[0];
}

/**
 * PackageInstaller 包安装协调器
 *
 * 职责：
 * - 协调 PackageRegistry 和 PackageCache
 * - 实现完整的包安装流程（查询、下载、解压、验证）
 * - 支持单包安装、批量安装、离线模式
 * - 更新 lockfile 并刷新 module_cache
 */
export class PackageInstaller {
  private readonly tempDir: string;
  private readonly lockfilePath: string;
  private readonly concurrencyLimit = pLimit(5);

  constructor(
    private readonly registry: PackageRegistry,
    private readonly cache: PackageCache,
    private readonly moduleCache?: ModuleCache,
    tempDir?: string,
    lockfilePath?: string
  ) {
    this.tempDir = tempDir || '/tmp/aster-installer';
    this.lockfilePath = lockfilePath || '.aster.lock';
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 安装单个包
   *
   * @param packageName - 包名称
   * @param versionConstraint - 版本约束（例如 "^1.0.0", "1.2.3"）
   * @returns 已安装的版本号，或 Diagnostic[]
   */
  async install(packageName: string, versionConstraint: string): Promise<string | Diagnostic[]> {
    // 1. 检查缓存（优先使用）
    // 如果版本约束是精确版本（如 "1.0.0"），直接检查缓存
    if (this.isExactVersion(versionConstraint)) {
      if (this.cache.isCached(packageName, versionConstraint)) {
        return versionConstraint; // 缓存命中
      }
    }

    // 2. 查询可用版本列表
    const versions = await this.registry.listVersions(packageName);
    if (isDiagnostic(versions)) {
      return versions;
    }

    // 3. 匹配版本约束（使用 version-utils）
    const matchedVersion = maxSatisfying(versions, versionConstraint);
    if (!matchedVersion) {
      return [
        DiagnosticBuilder.error(DiagnosticCode.V003_PackageNotFound)
          .withMessage(`找不到满足约束 ${versionConstraint} 的版本`)
          .withPosition(dummyPosition())
          .build()
      ];
    }

    // 4. 再次检查缓存（针对匹配后的具体版本）
    if (this.cache.isCached(packageName, matchedVersion)) {
      return matchedVersion; // 缓存命中
    }

    // 5. 下载 .tar.gz
    const tempPath = join(this.tempDir, `${packageName}-${matchedVersion}.tar.gz`);
    const downloadResult = await this.registry.downloadPackage(packageName, matchedVersion, tempPath);
    if (isDiagnostic(downloadResult)) {
      return downloadResult;
    }

    // 6. 计算 SHA256 哈希
    let integrity: string;
    try {
      integrity = await this.calculateHash(tempPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [
        DiagnosticBuilder.error(DiagnosticCode.C002_ExtractionFailed)
          .withMessage(`计算哈希失败：${message}`)
          .withPosition(dummyPosition())
          .build()
      ];
    }

    // 7. 添加到缓存（解压）
    const cacheResult = await this.cache.addToCache(tempPath, packageName, matchedVersion);
    if (isDiagnostic(cacheResult)) {
      return cacheResult;
    }

    // 8. 验证缓存完整性
    const isValid = await this.cache.validateCache(packageName, matchedVersion);
    if (!isValid) {
      return [
        DiagnosticBuilder.error(DiagnosticCode.C001_CacheCorrupted)
          .withMessage(`缓存验证失败：${packageName}@${matchedVersion}`)
          .withPosition(dummyPosition())
          .build()
      ];
    }

    // 9. 更新 lockfile
    const tarballUrl = `https://github.com/aster-lang/packages/releases/download/v${matchedVersion}/${packageName}-${matchedVersion}.tar.gz`;
    const lockfileUpdate = updateLockfileEntry(
      this.lockfilePath,
      packageName,
      matchedVersion,
      tarballUrl,
      integrity
    );
    if (lockfileUpdate instanceof Error) {
      // Lockfile 更新失败不影响安装成功，只记录警告
      // TODO: 添加日志记录
    }

    // 10. 刷新 module_cache
    if (this.moduleCache) {
      this.moduleCache.invalidatePackageCache(packageName);
    }

    // 11. 清理临时文件
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // 忽略清理错误
    }

    return matchedVersion; // 返回已安装版本
  }

  /**
   * 批量安装（支持依赖解析）
   *
   * @param packages - 包名到版本约束的映射
   * @returns 包名到已安装版本的映射，或 Diagnostic[]
   */
  async installMany(packages: Map<string, string>): Promise<Map<string, string> | Diagnostic[]> {
    const installedVersions = new Map<string, string>();
    const dependencyGraph = new DependencyGraph();
    const errors: Diagnostic[] = [];

    // 第一阶段：并发安装所有根包并构建依赖图
    const tasks = Array.from(packages.entries()).map(([packageName, versionConstraint]) =>
      this.concurrencyLimit(async () => {
        const version = await this.install(packageName, versionConstraint);
        if (isDiagnostic(version)) {
          errors.push(...version);
          return;
        }

        installedVersions.set(packageName, version);

        // 读取 manifest 获取依赖
        const cachePath = this.cache.getCachePath(packageName, version);
        const manifestPath = join(cachePath, 'manifest.json');
        const manifest = parseManifest(manifestPath);
        if (Array.isArray(manifest)) {
          errors.push(
            DiagnosticBuilder.error(DiagnosticCode.M001_ManifestParseError)
              .withMessage(`解析 manifest 失败：${packageName}@${version}`)
              .withPosition(dummyPosition())
              .build()
          );
          return;
        }

        // 添加到依赖图
        dependencyGraph.addNode(packageName, version);
      })
    );

    await Promise.all(tasks);

    if (errors.length > 0) {
      return errors;
    }

    // 第二阶段：并发安装所有传递依赖
    const allDependencies = this.collectAllDependencies(installedVersions);
    const depTasks = Array.from(allDependencies.entries())
      .filter(([depName]) => !installedVersions.has(depName))
      .map(([depName, depConstraint]) =>
        this.concurrencyLimit(async () => {
          const version = await this.install(depName, depConstraint);
          if (isDiagnostic(version)) {
            errors.push(...version);
            return;
          }

          installedVersions.set(depName, version);
          dependencyGraph.addNode(depName, version);
        })
      );

    await Promise.all(depTasks);

    if (errors.length > 0) {
      return errors;
    }

    // 第三阶段：构建依赖边
    for (const [packageName, version] of installedVersions) {
      const cachePath = this.cache.getCachePath(packageName, version);
      const manifestPath = join(cachePath, 'manifest.json');
      const manifest = parseManifest(manifestPath);
      if (Array.isArray(manifest)) {
        continue; // 跳过解析失败的包
      }

      if (manifest.dependencies) {
        for (const depName of Object.keys(manifest.dependencies)) {
          const depVersion = installedVersions.get(depName);
          if (depVersion) {
            const fromId = `${packageName}@${version}`;
            const toId = `${depName}@${depVersion}`;
            try {
              dependencyGraph.addEdge(fromId, toId);
            } catch {
              // 忽略边添加失败（可能是节点不存在）
            }
          }
        }
      }
    }

    // 第四阶段：验证依赖图无循环
    const sorted = dependencyGraph.topologicalSort();
    if (sorted instanceof Error) {
      return [
        DiagnosticBuilder.error(DiagnosticCode.V002_VersionConflictUnresolvable)
          .withMessage(`检测到循环依赖：${sorted.message}`)
          .withPosition(dummyPosition())
          .build()
      ];
    }

    return installedVersions;
  }

  /**
   * 离线模式安装（仅使用缓存）
   *
   * @param packageName - 包名称
   * @param version - 精确版本号
   * @returns 版本号，或 Diagnostic[]
   */
  async installOffline(packageName: string, version: string): Promise<string | Diagnostic[]> {
    // 1. 检查缓存是否存在
    if (!this.cache.isCached(packageName, version)) {
      return [
        DiagnosticBuilder.error(DiagnosticCode.C005_CacheExpired)
          .withMessage(
            `离线模式：缓存中未找到 ${packageName}@${version}。\n` +
            `提示：请先联网运行 \`aster install ${packageName}@${version}\` 下载包到缓存。`
          )
          .withPosition(dummyPosition())
          .build()
      ];
    }

    // 2. 验证缓存完整性
    const isValid = await this.cache.validateCache(packageName, version);
    if (!isValid) {
      return [
        DiagnosticBuilder.error(DiagnosticCode.C001_CacheCorrupted)
          .withMessage(
            `缓存损坏：${packageName}@${version}。\n` +
            `提示：请运行 \`aster cache clean && aster install ${packageName}\` 重新下载。`
          )
          .withPosition(dummyPosition())
          .build()
      ];
    }

    return version;
  }

  /**
   * 收集所有传递依赖
   *
   * @param installedVersions - 已安装的包
   * @returns 依赖名称到版本约束的映射
   */
  private collectAllDependencies(installedVersions: Map<string, string>): Map<string, string> {
    const allDeps = new Map<string, string>();

    for (const [packageName, version] of installedVersions) {
      const cachePath = this.cache.getCachePath(packageName, version);
      const manifestPath = join(cachePath, 'manifest.json');

      try {
        const manifest = parseManifest(manifestPath);
        if (Array.isArray(manifest)) {
          continue; // 跳过解析失败的包
        }

        if (manifest.dependencies) {
          for (const [depName, depConstraint] of Object.entries(manifest.dependencies)) {
            if (!allDeps.has(depName)) {
              allDeps.set(depName, depConstraint);
            }
          }
        }
      } catch {
        // 忽略错误，继续处理其他包
      }
    }

    return allDeps;
  }

  /**
   * 计算文件的 SHA256 哈希值
   *
   * @param filePath - 文件路径
   * @returns SHA256 哈希值（十六进制字符串）
   */
  private async calculateHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 判断版本约束是否为精确版本
   *
   * @param versionConstraint - 版本约束
   * @returns 是否为精确版本
   */
  private isExactVersion(versionConstraint: string): boolean {
    // 精确版本格式：x.y.z（不含前缀符号）
    return /^\d+\.\d+\.\d+$/.test(versionConstraint);
  }
}
