/**
 * LSP Workspace 索引管理器
 * 管理工作区索引的存储、访问和持久化
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { IndexConfig, ModuleIndex } from './types.js';

// 索引存储
const indexByUri = new Map<string, ModuleIndex>();
const indexByModule = new Map<string, ModuleIndex>();

// 配置和定时器
let indexConfig: IndexConfig = {
  persistEnabled: true,
  autoSaveDelay: 1000
};

let indexWriteTimer: NodeJS.Timeout | null = null;

/**
 * 根据文档 URI 获取对应的模块索引。
 * @param uri 目标文档的 URI。
 * @returns 找到时返回索引记录，否则返回 undefined。
 */
export function getModuleIndex(uri: string): ModuleIndex | undefined {
  return indexByUri.get(uri);
}

/**
 * 获取当前工作区内所有模块的索引快照。
 * @returns 模块索引数组。
 */
export function getAllModules(): ModuleIndex[] {
  return Array.from(indexByUri.values());
}

/**
 * 设置模块索引
 * @param uri 文档 URI
 * @param moduleIndex 模块索引
 */
export function setModuleIndex(uri: string, moduleIndex: ModuleIndex): void {
  const previous = indexByUri.get(uri);
  if (previous?.moduleName) {
    indexByModule.delete(previous.moduleName);
  }

  indexByUri.set(uri, moduleIndex);
  if (moduleIndex.moduleName) {
    indexByModule.set(moduleIndex.moduleName, moduleIndex);
  }

  if (indexConfig.persistEnabled) {
    scheduleSaveIndex();
  }
}

/**
 * 将指定文档从索引中移除或标记为失效。
 * @param uri 目标文档的 URI。
 */
export function invalidateDocument(uri: string): void {
  const existing = indexByUri.get(uri);
  if (existing?.moduleName) {
    indexByModule.delete(existing.moduleName);
  }
  indexByUri.delete(uri);
}

/**
 * 从持久化存储加载索引数据。
 * @param indexPath 索引文件路径。
 * @returns 成功加载时返回 true，失败或未找到时返回 false。
 */
export async function loadIndex(indexPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    const data = JSON.parse(content) as {
      indexByUri: Array<[string, ModuleIndex]>;
      indexByModule: Array<[string, ModuleIndex]>;
    };

    indexByUri.clear();
    indexByModule.clear();

    for (const [uri, index] of data.indexByUri) {
      indexByUri.set(uri, index);
    }
    for (const [moduleName, index] of data.indexByModule) {
      indexByModule.set(moduleName, index);
    }

    return true;
  } catch (error) {
    // ENOENT is expected on first run - index file doesn't exist yet
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    // Log real errors (permission issues, parse errors, etc.) to stderr
    // to avoid corrupting the LSP protocol stream on stdout
    console.error('[LSP Index] Failed to load index:', error);
    return false;
  }
}

/**
 * 将当前索引数据写入持久化存储。
 * @param indexPath 索引文件路径。
 */
export async function saveIndex(indexPath: string): Promise<void> {
  const data = {
    version: 1,
    timestamp: Date.now(),
    indexByUri: Array.from(indexByUri.entries()),
    indexByModule: Array.from(indexByModule.entries()),
  };

  await fs.mkdir(dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 安排延迟保存索引
 */
function scheduleSaveIndex(): void {
  if (indexWriteTimer) clearTimeout(indexWriteTimer);

  indexWriteTimer = setTimeout(() => {
    if (indexConfig.indexPath) {
      saveIndex(indexConfig.indexPath).catch(err => {
        // EROFS (read-only file system) is expected in containerized environments
        // where the filesystem is mounted read-only for security
        if (err instanceof Error && 'code' in err && err.code === 'EROFS') {
          return;
        }
        console.error('Failed to save index:', err);
      });
    }
    indexWriteTimer = null;
  }, indexConfig.autoSaveDelay || 1000);
}

/**
 * 更新索引模块的运行配置。
 * @param config 新配置对象。
 */
export function setIndexConfig(config: Partial<IndexConfig>): void {
  indexConfig = { ...indexConfig, ...config };
}

/**
 * 清空当前索引缓存并取消未完成的写入定时器。
 */
export function clearIndex(): void {
  indexByUri.clear();
  indexByModule.clear();
  if (indexWriteTimer) {
    clearTimeout(indexWriteTimer);
    indexWriteTimer = null;
  }
}
