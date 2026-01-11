/**
 * LSP 后台任务队列
 * 管理重型操作（索引、rename、类型检查等），避免阻塞主线程
 */

/**
 * 任务优先级
 */
export enum TaskPriority {
  /**
   * 高优先级：用户交互任务（hover、completion、definition）
   */
  HIGH = 0,
  /**
   * 中优先级：后台任务（diagnostics、references）
   */
  MEDIUM = 1,
  /**
   * 低优先级：重型任务（workspace rebuild、rename）
   */
  LOW = 2,
}

/**
 * 任务状态
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 任务接口
 */
export interface Task<T = any> {
  /**
   * 任务 ID
   */
  id: string;
  /**
   * 任务名称
   */
  name: string;
  /**
   * 优先级
   */
  priority: TaskPriority;
  /**
   * 任务执行函数
   */
  execute: () => Promise<T>;
  /**
   * 任务状态
   */
  status: TaskStatus;
  /**
   * 创建时间
   */
  createdAt: number;
  /**
   * 开始执行时间
   */
  startedAt?: number;
  /**
   * 完成时间
   */
  completedAt?: number;
  /**
   * 执行结果
   */
  result?: T;
  /**
   * 错误信息
   */
  error?: Error;
  /**
   * 取消标记
   */
  cancelled?: boolean;
  /**
   * Promise 控制器：用于在取消/超时时通知调用方
   */
  resolve?: (value: T) => void;
  reject?: (error: Error) => void;
}

/**
 * 队列配置
 */
export interface TaskQueueConfig {
  /**
   * 最大并发任务数
   */
  maxConcurrent: number;
  /**
   * 任务超时时间（毫秒），0 表示无限制
   */
  taskTimeout: number;
  /**
   * 是否启用队列
   */
  enabled: boolean;
}

/**
 * 队列统计信息
 */
export interface QueueStats {
  /**
   * 待处理任务数
   */
  pending: number;
  /**
   * 运行中任务数
   */
  running: number;
  /**
   * 已完成任务数
   */
  completed: number;
  /**
   * 失败任务数
   */
  failed: number;
  /**
   * 已取消任务数
   */
  cancelled: number;
  /**
   * 总任务数
   */
  total: number;
}

const defaultConfig: TaskQueueConfig = {
  maxConcurrent: 2,
  taskTimeout: 30000, // 30 秒
  enabled: true,
};

let currentConfig: TaskQueueConfig = { ...defaultConfig };
let taskIdCounter = 0;

// 优先级队列：每个优先级维护一个队列
const queues: Map<TaskPriority, Task[]> = new Map([
  [TaskPriority.HIGH, []],
  [TaskPriority.MEDIUM, []],
  [TaskPriority.LOW, []],
]);

// 运行中的任务
const runningTasks: Set<Task> = new Set();

// 所有任务记录（用于统计）
const allTasks: Map<string, Task> = new Map();

/**
 * 配置任务队列
 */
export function configureTaskQueue(config: Partial<TaskQueueConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * 提交任务到队列
 */
export function submitTask<T>(
  name: string,
  priority: TaskPriority,
  execute: () => Promise<T>
): Promise<T> {
  if (!currentConfig.enabled) {
    // 队列未启用，直接执行
    return execute();
  }

  return new Promise((resolve, reject) => {
    const taskId = `task-${++taskIdCounter}`;
    const task: Task<T> = {
      id: taskId,
      name,
      priority,
      execute,
      status: TaskStatus.PENDING,
      createdAt: Date.now(),
      resolve,
      reject,
    };

    // 添加到优先级队列
    const queue = queues.get(priority);
    if (queue) {
      queue.push(task);
    }

    // 记录任务
    allTasks.set(taskId, task);

    // 尝试调度任务
    scheduleNext();
  });
}

/**
 * 调度下一个任务
 */
function scheduleNext(): void {
  // 检查是否达到并发限制
  if (runningTasks.size >= currentConfig.maxConcurrent) {
    return;
  }

  // 按优先级顺序查找待执行任务
  const priorities = [TaskPriority.HIGH, TaskPriority.MEDIUM, TaskPriority.LOW];
  for (const priority of priorities) {
    const queue = queues.get(priority);
    if (queue && queue.length > 0) {
      const task = queue.shift()!;
      executeTask(task);
      return;
    }
  }
}

/**
 * 执行任务
 */
async function executeTask(task: Task): Promise<void> {
  if (task.cancelled) {
    task.status = TaskStatus.CANCELLED;
    task.completedAt = Date.now();
    // 通知调用方任务已取消
    if (task.reject) {
      task.reject(new Error(`Task ${task.name} was cancelled`));
    }
    scheduleNext();
    return;
  }

  task.status = TaskStatus.RUNNING;
  task.startedAt = Date.now();
  runningTasks.add(task);

  let timeoutId: NodeJS.Timeout | null = null;
  let timedOut = false;

  try {
    // 设置超时：创建一个竞速的Promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      if (currentConfig.taskTimeout > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Task timeout after ${currentConfig.taskTimeout}ms`));
        }, currentConfig.taskTimeout);
      }
    });

    // 执行任务，与超时Promise竞速
    let result: any;
    if (currentConfig.taskTimeout > 0) {
      result = await Promise.race([task.execute(), timeoutPromise]);
    } else {
      result = await task.execute();
    }

    // 任务成功完成
    if (!timedOut) {
      task.result = result;
      task.status = TaskStatus.COMPLETED;
      if (task.resolve) {
        task.resolve(result);
      }
    }
  } catch (error) {
    task.error = error as Error;

    // 区分超时和失败
    if (timedOut) {
      task.status = TaskStatus.CANCELLED;
      task.cancelled = true;
    } else {
      task.status = TaskStatus.FAILED;
    }

    // 通知调用方
    if (task.reject) {
      task.reject(task.error);
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    task.completedAt = Date.now();
    runningTasks.delete(task);
    // 调度下一个任务
    scheduleNext();
  }
}

/**
 * 取消任务
 */
export function cancelTask(taskId: string): boolean {
  const task = allTasks.get(taskId);
  if (!task || task.status !== TaskStatus.PENDING) {
    return false;
  }

  task.cancelled = true;
  task.status = TaskStatus.CANCELLED;
  task.completedAt = Date.now();

  // 通知调用方任务已取消
  if (task.reject) {
    task.reject(new Error(`Task ${task.name} was cancelled`));
  }

  // 从队列中移除
  const queue = queues.get(task.priority);
  if (queue) {
    const index = queue.indexOf(task);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  return true;
}

/**
 * 取消所有待处理任务
 */
export function cancelAllPendingTasks(): number {
  let count = 0;
  for (const queue of queues.values()) {
    for (const task of queue) {
      if (task.status === TaskStatus.PENDING) {
        task.cancelled = true;
        task.status = TaskStatus.CANCELLED;
        task.completedAt = Date.now();

        // 通知调用方任务已取消
        if (task.reject) {
          task.reject(new Error(`Task ${task.name} was cancelled`));
        }

        count++;
      }
    }
    queue.length = 0; // 清空队列
  }
  return count;
}

/**
 * 获取队列统计信息
 */
export function getQueueStats(): QueueStats {
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;

  for (const task of allTasks.values()) {
    switch (task.status) {
      case TaskStatus.PENDING:
        pending++;
        break;
      case TaskStatus.RUNNING:
        running++;
        break;
      case TaskStatus.COMPLETED:
        completed++;
        break;
      case TaskStatus.FAILED:
        failed++;
        break;
      case TaskStatus.CANCELLED:
        cancelled++;
        break;
    }
  }

  return {
    pending,
    running,
    completed,
    failed,
    cancelled,
    total: allTasks.size,
  };
}

/**
 * 清理已完成的任务记录（保留最近 N 个）
 */
export function cleanupCompletedTasks(keepRecent: number = 100): number {
  const completedTasks: Array<[string, Task]> = [];

  for (const [id, task] of allTasks) {
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELLED) {
      completedTasks.push([id, task]);
    }
  }

  // 按完成时间排序
  completedTasks.sort((a, b) => (b[1].completedAt || 0) - (a[1].completedAt || 0));

  // 删除多余的记录
  let removed = 0;
  for (let i = keepRecent; i < completedTasks.length; i++) {
    const entry = completedTasks[i];
    if (entry) {
      allTasks.delete(entry[0]);
      removed++;
    }
  }

  return removed;
}

/**
 * 等待所有任务完成
 */
export async function waitForAllTasks(): Promise<void> {
  while (runningTasks.size > 0 || Array.from(queues.values()).some(q => q.length > 0)) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * 获取任务状态
 */
export function getTaskStatus(taskId: string): TaskStatus | undefined {
  return allTasks.get(taskId)?.status;
}

/**
 * 获取运行中的任务列表
 */
export function getRunningTasks(): Array<{ id: string; name: string; duration: number }> {
  const now = Date.now();
  return Array.from(runningTasks).map(task => ({
    id: task.id,
    name: task.name,
    duration: now - (task.startedAt || now),
  }));
}
