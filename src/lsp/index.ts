/**
 * LSP Workspace 索引模块 - 统一导出
 * 提供工作区文档索引、符号查找和持久化功能
 */

// 导出类型定义
export type { IndexConfig, SymbolInfo, ModuleIndex } from './workspace/types.js';

// 导出索引管理函数
export {
  getModuleIndex,
  getAllModules,
  setIndexConfig,
  clearIndex,
  loadIndex,
  saveIndex,
} from './workspace/index-manager.js';

// 导出文档索引器
export { updateDocumentIndex, invalidateDocument } from './workspace/document-indexer.js';

// 导出符号查找器
export { findSymbolReferences } from './workspace/symbol-finder.js';

// 导出工作区扫描器
export { rebuildWorkspaceIndex } from './workspace/workspace-scanner.js';

// 导出文件监控器
export {
  configureFileWatcher,
  startFileWatcher,
  stopFileWatcher,
  getWatcherStatus,
  handleNativeFileChanges,
} from './workspace/file-watcher.js';
export type { FileWatcherConfig } from './workspace/file-watcher.js';

// 导出任务队列
export {
  configureTaskQueue,
  submitTask,
  cancelTask,
  cancelAllPendingTasks,
  getQueueStats,
  cleanupCompletedTasks,
  waitForAllTasks,
  getTaskStatus,
  getRunningTasks,
  TaskPriority,
  TaskStatus,
} from './task-queue.js';
export type { Task, TaskQueueConfig, QueueStats } from './task-queue.js';
