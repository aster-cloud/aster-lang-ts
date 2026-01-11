import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { GenerateResult } from './generator.js';

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

/**
 * 生成結果緩存，使用磁盤 JSON 文件保存完整的 GenerateResult
 */
export class GenerationCache {
  private readonly cacheDir: string;
  private stats: { hits: number; misses: number } = { hits: 0, misses: 0 };
  private dirReady: Promise<void> | null = null;

  constructor(cacheDir?: string) {
    const rootDir = cacheDir ?? path.resolve(process.cwd(), '.cache', 'ai-generation');
    this.cacheDir = rootDir;
  }

  /**
   * 讀取緩存內容
   */
  async get(key: string): Promise<GenerateResult | null> {
    await this.ensureCacheDir();
    const filePath = this.getCacheFilePath(key);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      this.stats.hits += 1;
      return JSON.parse(data) as GenerateResult;
    } catch (error) {
      this.stats.misses += 1;
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        console.warn(`[GenerationCache] 讀取 ${filePath} 失敗: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * 寫入緩存（原子寫入避免併發競爭）
   */
  async set(key: string, result: GenerateResult): Promise<void> {
    await this.ensureCacheDir();
    const filePath = this.getCacheFilePath(key);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { fromCache: _fromCache, ...cacheable } = result;
      await fs.writeFile(tempPath, JSON.stringify(cacheable), 'utf8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      console.warn(`[GenerationCache] 寫入 ${filePath} 失敗: ${err.message}`);
      try {
        await fs.rm(tempPath, { force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * 清空緩存並重置統計
   */
  async clear(): Promise<void> {
    await fs.rm(this.cacheDir, { recursive: true, force: true }).catch(() => {});
    this.dirReady = null;
    this.stats = { hits: 0, misses: 0 };
  }

  getCacheStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
    };
  }

  /**
   * 將描述轉換為固定長度哈希，避免文件名過長
   */
  static hashDescription(description: string): string {
    return crypto.createHash('sha256').update(description, 'utf8').digest('hex');
  }

  private getCacheFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    if (!this.dirReady) {
      this.dirReady = fs.mkdir(this.cacheDir, { recursive: true }).then(() => undefined);
    }
    await this.dirReady;
  }
}
