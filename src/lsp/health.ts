/**
 * LSP Health 模块
 * 提供服务健康检查和状态报告功能
 */

import * as fs from 'fs';
import type { Connection } from 'vscode-languageserver/node.js';

// 狀態變量用於 CPU 計算
let lastCpuUsage: NodeJS.CpuUsage = process.cpuUsage();
let lastCheckTime: number = Date.now();
const startTime: Date = new Date();

const RESTART_COUNTER_FILE = '/tmp/lsp-restart-count.txt';

interface ProcessMetrics {
  pid: number;
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  cpu: {
    percent: number;
  };
}

interface Metadata {
  startTime: string;
  restartCount: number;
}

function getRestartCount(): number {
  try {
    const content = fs.readFileSync(RESTART_COUNTER_FILE, 'utf-8');
    return parseInt(content.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export function incrementRestartCount(): void {
  const count = getRestartCount() + 1;
  fs.writeFileSync(RESTART_COUNTER_FILE, count.toString(), 'utf-8');
}

function getCpuPercentage(): number {
  const currentUsage = process.cpuUsage();
  const currentTime = Date.now();
  const elapsedMs = currentTime - lastCheckTime;

  if (elapsedMs === 0) return 0;

  const userDiff = currentUsage.user - lastCpuUsage.user;
  const systemDiff = currentUsage.system - lastCpuUsage.system;
  const totalDiff = (userDiff + systemDiff) / 1000;

  const cpuPercent = (totalDiff / elapsedMs) * 100;

  lastCpuUsage = currentUsage;
  lastCheckTime = currentTime;

  return Math.min(Math.max(cpuPercent, 0), 100);
}

/**
 * Health 模块返回的状态接口
 */
export interface HealthStatus {
  watchers: {
    capability: boolean;
    registered: boolean;
    mode?: 'native' | 'polling';
    isRunning?: boolean;
    trackedFiles?: number;
  };
  index: {
    files: number;
    modules: number;
  };
  queue?: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    total: number;
  };
  process?: ProcessMetrics;
  metadata?: Metadata;
}

/**
 * 注册 Health 相关的 LSP 处理器
 * @param connection LSP 连接对象
 * @param hasWatchedFilesCapability 客户端是否支持文件监视
 * @param watcherRegistered 文件监视器是否已注册
 * @param getAllModules 获取所有模块的函数
 * @param getWatcherStatus 获取文件监控状态的函数（可选）
 * @param getQueueStats 获取任务队列统计的函数（可选）
 */
export function registerHealthHandlers(
  connection: Connection,
  hasWatchedFilesCapability: boolean,
  watcherRegistered: boolean,
  getAllModules: () => Array<{ moduleName: string | null }>,
  getWatcherStatus?: () => {
    enabled: boolean;
    mode: 'native' | 'polling';
    isRunning: boolean;
    trackedFiles: number;
  },
  getQueueStats?: () => {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    total: number;
  }
): void {
  const HEALTH_METHOD = 'aster/health';

  connection.onRequest(HEALTH_METHOD, (): HealthStatus => {
    const modules = getAllModules();
    const moduleNames = new Set<string>();
    for (const m of modules) if (m.moduleName) moduleNames.add(m.moduleName);

    const watcherStatus = getWatcherStatus?.();
    const queueStats = getQueueStats?.();
    const memUsage = process.memoryUsage();
    const processMetrics: ProcessMetrics = {
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      cpu: {
        percent: parseFloat(getCpuPercentage().toFixed(2)),
      },
    };

    const metadata: Metadata = {
      startTime: startTime.toISOString(),
      restartCount: getRestartCount(),
    };

    const result: HealthStatus = {
      watchers: {
        capability: hasWatchedFilesCapability,
        registered: watcherRegistered,
      },
      index: {
        files: modules.length,
        modules: moduleNames.size,
      },
      process: processMetrics,
      metadata,
    };

    // 仅在 watcherStatus 存在时添加可选字段
    if (watcherStatus) {
      result.watchers.mode = watcherStatus.mode;
      result.watchers.isRunning = watcherStatus.isRunning;
      result.watchers.trackedFiles = watcherStatus.trackedFiles;
    }

    // 添加队列统计
    if (queueStats) {
      result.queue = {
        pending: queueStats.pending,
        running: queueStats.running,
        completed: queueStats.completed,
        failed: queueStats.failed,
        cancelled: queueStats.cancelled,
        total: queueStats.total,
      };
    }

    return result;
  });
}
