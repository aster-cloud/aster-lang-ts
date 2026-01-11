/**
 * PackageCache 本地缓存管理器
 *
 * 提供包缓存的存储、验证与过期清理能力，支持离线模式。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extract } from 'tar';
import { parseManifest } from './manifest-parser.js';
import {
  type Diagnostic,
  DiagnosticCode,
  DiagnosticBuilder,
  dummyPosition,
} from '../diagnostics/diagnostics.js';

export interface CacheConfig {
  readonly cacheDir: string;
  readonly ttl: number;
  readonly maxSize?: number;
}

interface CacheMetadata {
  readonly cachedAt: number;
  readonly version: string;
}

/**
 * 基于文件系统的包缓存管理器
 */
export class PackageCache {
  private readonly cacheDir: string;
  private readonly ttl: number;

  constructor(config: CacheConfig) {
    this.cacheDir = config.cacheDir;
    this.ttl = config.ttl;

    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 检查指定包版本是否在缓存中且未过期
   *
   * @param packageName 包名称
   * @param version 包版本
   * @returns 缓存有效且未过期返回 true
   */
  isCached(packageName: string, version: string): boolean {
    const cachePath = this.getCachePath(packageName, version);
    const manifestPath = join(cachePath, 'manifest.json');
    const metadataPath = join(cachePath, '.cache-metadata.json');

    if (!existsSync(manifestPath) || !existsSync(metadataPath)) {
      return false;
    }

    try {
      const metadataJson = readFileSync(metadataPath, 'utf-8');
      const metadataContent = JSON.parse(metadataJson) as CacheMetadata;
      const cachedAt = metadataContent.cachedAt;
      const now = Date.now();

      if (now - cachedAt > this.ttl) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取指定包版本的缓存路径
   *
   * @param packageName 包名称
   * @param version 包版本
   * @returns 缓存目录路径
   */
  getCachePath(packageName: string, version: string): string {
    return join(this.cacheDir, packageName, version);
  }

  /**
   * 将 tarball 解压并添加到缓存
   *
   * @param tarballPath tarball 文件路径
   * @param packageName 包名称
   * @param version 包版本
   */
  async addToCache(tarballPath: string, packageName: string, version: string): Promise<void | Diagnostic[]> {
    const cachePath = this.getCachePath(packageName, version);

    try {
      mkdirSync(cachePath, { recursive: true });

      await extract({
        file: tarballPath,
        cwd: cachePath,
      });

      const manifestPath = join(cachePath, 'manifest.json');
      if (!existsSync(manifestPath)) {
        return [
          DiagnosticBuilder.error(DiagnosticCode.C004_ManifestMissing)
            .withMessage(`解压后未找到 manifest.json：${cachePath}`)
            .withPosition(dummyPosition())
            .build()
        ];
      }

      const metadata: CacheMetadata = {
        cachedAt: Date.now(),
        version,
      };

      const metadataPath = join(cachePath, '.cache-metadata.json');
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      return undefined;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [
        DiagnosticBuilder.error(DiagnosticCode.C002_ExtractionFailed)
          .withMessage(`缓存添加失败：${message}`)
          .withPosition(dummyPosition())
          .build()
      ];
    }
  }

  /**
   * 验证缓存完整性
   *
   * @param packageName 包名称
   * @param version 包版本
   * @returns 缓存有效且内容匹配返回 true
   */
  async validateCache(packageName: string, version: string): Promise<boolean> {
    const cachePath = this.getCachePath(packageName, version);
    const manifestPath = join(cachePath, 'manifest.json');

    if (!existsSync(manifestPath)) {
      return false;
    }

    try {
      const manifest = parseManifest(manifestPath);
      if (Array.isArray(manifest)) {
        return false;
      }

      if (manifest.name !== packageName || manifest.version !== version) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理所有过期缓存
   */
  async cleanExpired(): Promise<void> {
    try {
      const packageDirs = await readdir(this.cacheDir);

      for (const packageName of packageDirs) {
        const packagePath = join(this.cacheDir, packageName);
        const versionDirs = await readdir(packagePath);

        for (const version of versionDirs) {
          const metadataPath = join(packagePath, version, '.cache-metadata.json');

          if (!existsSync(metadataPath)) {
            continue;
          }

          try {
            const metadataContent = await readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(metadataContent) as CacheMetadata;
            const now = Date.now();

            if (now - metadata.cachedAt > this.ttl) {
              const cachePath = join(packagePath, version);
              await rm(cachePath, { recursive: true, force: true });
            }
          } catch {
            // 忽略元数据读取错误，继续处理下一个
          }
        }
      }
    } catch {
      // 忽略清理错误
    }
  }
}
