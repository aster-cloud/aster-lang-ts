/**
 * LSP Workspace 文件监控器
 * 提供文件系统变化监控，支持降级策略（从 native watcher 降级到 polling）
 */

import { promises as fs } from 'node:fs';
import { extname, relative, sep } from 'node:path';
import { updateDocumentIndex, invalidateDocument } from './document-indexer.js';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';

/**
 * 文件监控配置
 */
export interface FileWatcherConfig {
  /**
   * 是否启用文件监控
   */
  enabled: boolean;
  /**
   * 监控模式：'native'（客户端提供）或 'polling'（服务器轮询）
   */
  mode: 'native' | 'polling';
  /**
   * Polling 模式下的轮询间隔（毫秒）
   */
  pollingInterval: number;
  /**
   * 排除的目录模式
   */
  excludePatterns: string[];
}

/**
 * 文件变更事件
 */
interface FileChangeEvent {
  uri: string;
  type: 'created' | 'changed' | 'deleted';
}

/**
 * 文件元数据快照
 */
interface FileSnapshot {
  mtime: number;
  size: number;
}

const defaultConfig: FileWatcherConfig = {
  enabled: true,
  mode: 'native',
  pollingInterval: 3000, // 3 秒轮询一次
  excludePatterns: ['node_modules', '.git', 'dist', '.asteri'],
};

/**
 * FileWatcher 类：封装文件监控的所有状态和行为
 * 支持多实例，每个实例维护独立的状态和事件发射器
 */
export class FileWatcher {
  private config: FileWatcherConfig;
  private pollingTimer: NodeJS.Timeout | null = null;
  private fileSnapshots: Map<string, FileSnapshot> = new Map();
  private workspaceFolders: string[] = [];
  private isRunning = false;
  private isScanning = false; // 单飞行锁：防止并发扫描

  /**
   * 事件发射器：用于测试观察和验证
   * 事件类型：
   * - 'scan:attempt': 尝试扫描（无论是否被锁阻止）
   * - 'scan:start': 实际开始扫描（获取到锁）
   * - 'scan:end': 扫描完成
   * - 'scan:rejected': 扫描被单飞行锁拒绝
   */
  private readonly events: EventEmitter;

  constructor(config: Partial<FileWatcherConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.events = new EventEmitter();
  }

  /**
   * 获取扫描事件发射器（仅供测试使用）
   */
  getEventEmitter(): EventEmitter {
    return this.events;
  }

  /**
   * 配置文件监控器
   */
  configure(config: Partial<FileWatcherConfig>): void {
    const wasRunning = this.isRunning;
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning && this.config.enabled) {
      this.start(this.workspaceFolders);
    }
  }

  /**
   * 启动文件监控
   */
  start(folders: string[]): void {
    if (this.isRunning) {
      return;
    }

    this.workspaceFolders = [...folders];
    this.isRunning = true;

    if (this.config.mode === 'polling') {
      this.startPolling();
    }
    // native 模式下，由客户端负责触发 handleNativeFileChanges
  }

  /**
   * 停止文件监控
   */
  stop(): void {
    this.isRunning = false;
    this.stopPolling();
    this.fileSnapshots.clear();
    // 注意：不清理事件监听器，保持与旧实现的兼容性
    // 调用方可以在 configure() 前后持续使用同一监听器
  }

  /**
   * 获取监控状态
   */
  getStatus(): {
    enabled: boolean;
    mode: 'native' | 'polling';
    isRunning: boolean;
    trackedFiles: number;
  } {
    return {
      enabled: this.config.enabled,
      mode: this.config.mode,
      isRunning: this.isRunning,
      trackedFiles: this.fileSnapshots.size,
    };
  }

  /**
   * 处理客户端提供的文件变更事件（native 模式）
   */
  async handleNativeChanges(changes: Array<{ uri: string; type: number }>): Promise<void> {
    const events: FileChangeEvent[] = changes.map(ch => ({
      uri: ch.uri,
      type: ch.type === 1 ? 'created' : ch.type === 2 ? 'changed' : 'deleted',
    }));

    await this.processChanges(events);
  }

  /**
   * 启动轮询机制
   */
  private startPolling(): void {
    if (this.pollingTimer) {
      return;
    }

    // 立即执行一次扫描
    void this.scanAndUpdate();

    // 设置定时器
    this.pollingTimer = setInterval(() => {
      void this.scanAndUpdate();
    }, this.config.pollingInterval);
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * 扫描并更新文件索引
   */
  private async scanAndUpdate(): Promise<void> {
    // 发射尝试事件（用于测试验证）
    this.events.emit('scan:attempt');

    // 单飞行锁：如果已经在扫描，跳过本次
    if (this.isScanning) {
      this.events.emit('scan:rejected');
      return;
    }

    // 发射开始事件（用于测试验证）
    this.events.emit('scan:start');

    this.isScanning = true;
    try {
      const changes: FileChangeEvent[] = [];

      for (const folder of this.workspaceFolders) {
        const detectedChanges = await this.detectChanges(folder);
        changes.push(...detectedChanges);
      }

      // 批量处理变更
      await this.processChanges(changes);
    } finally {
      this.isScanning = false;
      this.events.emit('scan:end');
    }
  }

  /**
   * 检测目录下的文件变更
   */
  private async detectChanges(dir: string): Promise<FileChangeEvent[]> {
    const changes: FileChangeEvent[] = [];
    const currentFiles = new Set<string>();

    try {
      await this.scanDirectory(dir, currentFiles, changes);
    } catch {
      // 目录不存在或无法访问
      return changes;
    }

    // 检查已删除的文件
    for (const [path] of this.fileSnapshots) {
      // 使用 relative 检查文件是否在目录下，避免前缀碰撞
      const rel = relative(dir, path);
      const isInDir = rel && !rel.startsWith('..') && !rel.startsWith(sep);

      if (isInDir && !currentFiles.has(path)) {
        changes.push({
          uri: pathToFileURL(path).href,
          type: 'deleted',
        });
        this.fileSnapshots.delete(path);
      }
    }

    return changes;
  }

  /**
   * 递归扫描目录
   */
  private async scanDirectory(
    dir: string,
    currentFiles: Set<string>,
    changes: FileChangeEvent[]
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // 跳过排除的目录
      if (entry.isDirectory() && this.config.excludePatterns.includes(entry.name)) {
        continue;
      }

      const fullPath = `${dir}/${entry.name}`;

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, currentFiles, changes);
      } else if (entry.isFile() && extname(entry.name) === '.aster') {
        currentFiles.add(fullPath);

        try {
          const stats = await fs.stat(fullPath);
          const snapshot: FileSnapshot = {
            mtime: stats.mtimeMs,
            size: stats.size,
          };

          const previous = this.fileSnapshots.get(fullPath);
          if (!previous) {
            // 新文件
            changes.push({
              uri: pathToFileURL(fullPath).href,
              type: 'created',
            });
          } else if (previous.mtime !== snapshot.mtime || previous.size !== snapshot.size) {
            // 已修改
            changes.push({
              uri: pathToFileURL(fullPath).href,
              type: 'changed',
            });
          }

          this.fileSnapshots.set(fullPath, snapshot);
        } catch {
          // 文件无法访问
        }
      }
    }
  }

  /**
   * 处理文件变更
   */
  private async processChanges(changes: FileChangeEvent[]): Promise<void> {
    if (changes.length === 0) {
      return;
    }

    const BATCH_SIZE = 10;
    for (let i = 0; i < changes.length; i += BATCH_SIZE) {
      const batch = changes.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async change => {
          try {
            if (change.type === 'deleted') {
              invalidateDocument(change.uri);
            } else {
              // created 或 changed
              const fsPath = new URL(change.uri).pathname;
              const content = await fs.readFile(fsPath, 'utf8');
              await updateDocumentIndex(change.uri, content);
            }
          } catch {
            // 忽略错误（文件可能已被删除或无法读取）
          }
        })
      );
    }
  }
}

// ============================================================================
// 向后兼容的模块级 API（使用默认实例）
// ============================================================================

/**
 * 默认的 FileWatcher 实例
 * 用于向后兼容现有的模块级 API
 */
const defaultWatcher = new FileWatcher();

/**
 * 配置文件监控器（向后兼容 API）
 */
export function configureFileWatcher(config: Partial<FileWatcherConfig>): void {
  defaultWatcher.configure(config);
}

/**
 * 启动文件监控（向后兼容 API）
 */
export function startFileWatcher(folders: string[]): void {
  defaultWatcher.start(folders);
}

/**
 * 停止文件监控（向后兼容 API）
 */
export function stopFileWatcher(): void {
  defaultWatcher.stop();
}

/**
 * 获取监控状态（向后兼容 API）
 */
export function getWatcherStatus(): {
  enabled: boolean;
  mode: 'native' | 'polling';
  isRunning: boolean;
  trackedFiles: number;
} {
  return defaultWatcher.getStatus();
}

/**
 * 获取扫描事件发射器（仅供测试使用，向后兼容 API）
 */
export function getScanEventEmitter(): EventEmitter {
  return defaultWatcher.getEventEmitter();
}

/**
 * 处理客户端提供的文件变更事件（native 模式，向后兼容 API）
 */
export async function handleNativeFileChanges(
  changes: Array<{ uri: string; type: number }>
): Promise<void> {
  await defaultWatcher.handleNativeChanges(changes);
}
