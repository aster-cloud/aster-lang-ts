#!/usr/bin/env node
/**
 * 任务队列单元测试
 * 验证取消、超时和优先级调度功能
 */

import {
  configureTaskQueue,
  submitTask,
  cancelTask,
  cancelAllPendingTasks,
  getQueueStats,
  waitForAllTasks,
  TaskPriority,
  TaskStatus,
  getTaskStatus,
} from '../../../src/lsp/task-queue.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testBasicTaskExecution(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 2,
    taskTimeout: 5000,
    enabled: true,
  });

  let executed = false;
  const result = await submitTask(
    'Test Task',
    TaskPriority.HIGH,
    async () => {
      executed = true;
      return 42;
    }
  );

  assert(executed, '任务应该被执行');
  assert(result === 42, '应返回正确的结果');
  console.log('✓ 基础任务执行正常');
}

async function testTaskCancellation(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 1, // 限制为1，确保任务排队
    taskTimeout: 10000,
    enabled: true,
  });

  // 提交一个长时间运行的任务占用队列
  const blockingTask = submitTask(
    'Blocking Task',
    TaskPriority.HIGH,
    async () => {
      await sleep(200);
      return 'blocking';
    }
  );

  // 等待一下确保阻塞任务开始执行
  await sleep(50);

  // 提交第二个任务（会排队）
  let secondTaskExecuted = false;
  const cancelledTask = submitTask(
    'To Be Cancelled',
    TaskPriority.LOW,
    async () => {
      secondTaskExecuted = true;
      return 'should-not-execute';
    }
  );

  // 等待一下让第二个任务进入队列
  await sleep(50);

  // 验证第二个任务已经在pending状态
  const stats = getQueueStats();
  assert(stats.pending >= 1, '应该有待处理任务');

  // 取消所有pending任务
  const cancelledCount = cancelAllPendingTasks();
  assert(cancelledCount >= 1, '应该至少取消1个任务');

  // 验证任务被取消并reject
  let cancelled = false;
  try {
    await cancelledTask;
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes('cancelled'),
      '应该抛出取消错误'
    );
    cancelled = true;
  }

  await blockingTask; // 等待阻塞任务完成

  assert(cancelled, '任务应该被取消并reject');
  assert(!secondTaskExecuted, '被取消的任务不应该被执行');
  console.log('✓ 任务取消功能正常');
}

async function testTaskTimeout(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 2,
    taskTimeout: 100, // 100ms超时
    enabled: true,
  });

  let timedOut = false;
  try {
    await submitTask(
      'Timeout Task',
      TaskPriority.HIGH,
      async () => {
        // 模拟长时间运行的任务
        await sleep(500);
        return 'should-not-return';
      }
    );
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes('timeout'),
      '应该抛出超时错误'
    );
    timedOut = true;
  }

  assert(timedOut, '任务应该超时并reject');
  console.log('✓ 任务超时功能正常');
}

async function testPriorityScheduling(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 1, // 限制为1，确保串行执行
    taskTimeout: 5000,
    enabled: true,
  });

  const executionOrder: string[] = [];

  // 提交一个阻塞任务
  const blocker = submitTask(
    'Blocker',
    TaskPriority.HIGH,
    async () => {
      await sleep(50);
      executionOrder.push('blocker');
      return 'blocker';
    }
  );

  // 等待一下确保blocker开始执行
  await sleep(10);

  // 提交不同优先级的任务
  const lowTask = submitTask('Low', TaskPriority.LOW, async () => {
    executionOrder.push('low');
    return 'low';
  });

  const highTask = submitTask('High', TaskPriority.HIGH, async () => {
    executionOrder.push('high');
    return 'high';
  });

  const mediumTask = submitTask('Medium', TaskPriority.MEDIUM, async () => {
    executionOrder.push('medium');
    return 'medium';
  });

  // 等待所有任务完成
  await Promise.all([blocker, lowTask, highTask, mediumTask]);

  // 验证执行顺序：blocker -> high -> medium -> low
  assert(executionOrder[0] === 'blocker', '阻塞任务应该先执行');
  assert(executionOrder[1] === 'high', '高优先级任务应该第二执行');
  assert(executionOrder[2] === 'medium', '中优先级任务应该第三执行');
  assert(executionOrder[3] === 'low', '低优先级任务应该最后执行');

  console.log('✓ 优先级调度功能正常');
}

async function testConcurrentExecution(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 3, // 允许3个并发任务
    taskTimeout: 5000,
    enabled: true,
  });

  const startTimes: number[] = [];
  const tasks = [];

  for (let i = 0; i < 5; i++) {
    tasks.push(
      submitTask(`Task ${i}`, TaskPriority.MEDIUM, async () => {
        startTimes.push(Date.now());
        await sleep(50);
        return i;
      })
    );
  }

  await Promise.all(tasks);

  // 验证前3个任务几乎同时开始（并发）
  const time0 = startTimes[0];
  const time2 = startTimes[2];
  if (time0 !== undefined && time2 !== undefined) {
    const firstThreeRange = time2 - time0;
    assert(
      firstThreeRange < 30,
      `前3个任务应该并发执行（时间差: ${firstThreeRange}ms）`
    );
  } else {
    assert(false, '应该有至少3个任务开始时间');
  }

  console.log('✓ 并发执行功能正常');
}

async function testTaskFailure(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 2,
    taskTimeout: 5000,
    enabled: true,
  });

  let failed = false;
  try {
    await submitTask('Failing Task', TaskPriority.HIGH, async () => {
      throw new Error('Task failed intentionally');
    });
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes('intentionally'),
      '应该传播任务内部错误'
    );
    failed = true;
  }

  assert(failed, '任务失败应该被捕获');
  console.log('✓ 任务失败处理正常');
}

async function testCancelAllPendingTasks(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 1,
    taskTimeout: 5000,
    enabled: true,
  });

  // 提交阻塞任务
  const blocker = submitTask('Blocker', TaskPriority.HIGH, async () => {
    await sleep(100);
    return 'blocker';
  });

  await sleep(10);

  // 提交多个待处理任务
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    tasks.push(
      submitTask(`Task ${i}`, TaskPriority.LOW, async () => {
        return i;
      })
    );
  }

  // 取消所有待处理任务
  const cancelledCount = cancelAllPendingTasks();
  assert(cancelledCount === 5, `应该取消5个任务，实际取消了${cancelledCount}个`);

  // 验证所有任务都被取消
  let allCancelled = true;
  for (const task of tasks) {
    try {
      await task;
      allCancelled = false;
    } catch (error) {
      assert(
        error instanceof Error && error.message.includes('cancelled'),
        '应该抛出取消错误'
      );
    }
  }

  await blocker;
  assert(allCancelled, '所有待处理任务应该被取消');
  console.log('✓ 批量取消功能正常');
}

async function testQueueStats(): Promise<void> {
  configureTaskQueue({
    maxConcurrent: 1,
    taskTimeout: 5000,
    enabled: true,
  });

  const stats1 = getQueueStats();
  const initialTotal = stats1.total;

  // 提交一个任务
  const task = submitTask('Stats Test', TaskPriority.MEDIUM, async () => {
    await sleep(50);
    return 'done';
  });

  await sleep(10);

  const stats2 = getQueueStats();
  assert(stats2.total === initialTotal + 1, '总任务数应该增加1');
  assert(stats2.running >= 1, '应该有运行中的任务');

  await task;

  const stats3 = getQueueStats();
  assert(stats3.completed >= stats2.completed + 1, '完成任务数应该增加');

  console.log('✓ 队列统计功能正常');
}

async function testDisabledQueue(): Promise<void> {
  configureTaskQueue({
    enabled: false, // 禁用队列
  });

  let executed = false;
  const result = await submitTask('Direct Execution', TaskPriority.HIGH, async () => {
    executed = true;
    return 'direct';
  });

  assert(executed, '禁用队列时任务应该直接执行');
  assert(result === 'direct', '应返回正确结果');
  console.log('✓ 队列禁用模式正常');
}

async function main(): Promise<void> {
  console.log('Running LSP task queue tests...\n');

  try {
    await testBasicTaskExecution();
    await testTaskCancellation();
    await testTaskTimeout();
    await testPriorityScheduling();
    await testConcurrentExecution();
    await testTaskFailure();
    await testCancelAllPendingTasks();
    await testQueueStats();
    await testDisabledQueue();

    console.log('\n✅ All task queue tests passed.');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
