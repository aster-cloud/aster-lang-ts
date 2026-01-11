#!/usr/bin/env node
/**
 * LSP Health API 集成测试
 * 验证新增的资源监控指标（CPU、内存、uptime、重启计数）
 */

import { LSPClient } from '../../../scripts/lsp-client-helper.js';

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

interface HealthResponse {
  watchers: {
    capability: boolean;
    registered: boolean;
    mode?: string;
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


/** 初始化 LSP 客户端并完成握手 */
async function initializeLspClient(): Promise<LSPClient> {
  const client = new LSPClient();
  client.spawn('dist/src/lsp/server.js');

  await client.request('initialize', {
    processId: process.pid,
    clientInfo: { name: 'health-test-client', version: '1.0.0' },
    rootUri: null,
    capabilities: {},
  });
  client.notify('initialized', {});

  return client;
}

/** 关闭 LSP 客户端 */
async function shutdownLspClient(client: LSPClient): Promise<void> {
  try {
    await client.request('shutdown');
    client.notify('exit');
    await new Promise(resolve => setTimeout(resolve, 200));
  } catch {
    // 忽略关闭时的错误
  } finally {
    client.close();
  }
}

async function testProcessMetrics(): Promise<void> {
  console.log('\n=== 测试进程资源指标 ===');
  const client = await initializeLspClient();

  try {
    const health = (await client.request('aster/health', {})) as HealthResponse;

    // 验证 process 字段存在
    if (!health.process) {
      throw new Error('health.process 字段缺失');
    }

    // 验证 PID
    if (typeof health.process.pid !== 'number' || health.process.pid <= 0) {
      throw new Error(`无效的 PID: ${health.process.pid}`);
    }
    console.log(`✓ PID: ${health.process.pid}`);

    // 验证 uptime
    if (typeof health.process.uptime !== 'number' || health.process.uptime < 0) {
      throw new Error(`无效的 uptime: ${health.process.uptime}`);
    }
    console.log(`✓ Uptime: ${health.process.uptime}s`);

    // 验证内存指标
    if (!health.process.memory) {
      throw new Error('health.process.memory 字段缺失');
    }
    if (typeof health.process.memory.rss !== 'number' || health.process.memory.rss <= 0) {
      throw new Error(`无效的 RSS: ${health.process.memory.rss}`);
    }
    if (typeof health.process.memory.heapUsed !== 'number' || health.process.memory.heapUsed < 0) {
      throw new Error(`无效的 heapUsed: ${health.process.memory.heapUsed}`);
    }
    if (typeof health.process.memory.heapTotal !== 'number' || health.process.memory.heapTotal <= 0) {
      throw new Error(`无效的 heapTotal: ${health.process.memory.heapTotal}`);
    }
    console.log(`✓ Memory - RSS: ${health.process.memory.rss}MB, Heap: ${health.process.memory.heapUsed}/${health.process.memory.heapTotal}MB`);

    // 验证 CPU 百分比
    if (!health.process.cpu) {
      throw new Error('health.process.cpu 字段缺失');
    }
    if (typeof health.process.cpu.percent !== 'number') {
      throw new Error(`无效的 CPU percent 类型: ${typeof health.process.cpu.percent}`);
    }
    if (health.process.cpu.percent < 0 || health.process.cpu.percent > 100) {
      throw new Error(`CPU percent 超出范围 [0, 100]: ${health.process.cpu.percent}`);
    }
    console.log(`✓ CPU: ${health.process.cpu.percent}%`);

    console.log('✅ 进程资源指标测试通过');
  } finally {
    await shutdownLspClient(client);
  }
}

async function testMetadata(): Promise<void> {
  console.log('\n=== 测试元数据字段 ===');
  const client = await initializeLspClient();

  try {
    const health = (await client.request('aster/health', {})) as HealthResponse;

    // 验证 metadata 字段存在
    if (!health.metadata) {
      throw new Error('health.metadata 字段缺失');
    }

    // 验证 startTime 格式（ISO 8601）
    if (typeof health.metadata.startTime !== 'string') {
      throw new Error(`无效的 startTime 类型: ${typeof health.metadata.startTime}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(health.metadata.startTime)) {
      throw new Error(`startTime 格式不符合 ISO 8601: ${health.metadata.startTime}`);
    }
    console.log(`✓ Start Time: ${health.metadata.startTime}`);

    // 验证 restartCount
    if (typeof health.metadata.restartCount !== 'number' || health.metadata.restartCount < 0) {
      throw new Error(`无效的 restartCount: ${health.metadata.restartCount}`);
    }
    console.log(`✓ Restart Count: ${health.metadata.restartCount}`);

    console.log('✅ 元数据字段测试通过');
  } finally {
    await shutdownLspClient(client);
  }
}

async function testBackwardCompatibility(): Promise<void> {
  console.log('\n=== 测试向后兼容性 ===');
  const client = await initializeLspClient();

  try {
    const health = (await client.request('aster/health', {})) as HealthResponse;

    // 验证原有字段仍然存在
    if (!health.watchers) {
      throw new Error('health.watchers 字段缺失');
    }
    if (typeof health.watchers.capability !== 'boolean') {
      throw new Error(`无效的 watchers.capability 类型: ${typeof health.watchers.capability}`);
    }
    if (typeof health.watchers.registered !== 'boolean') {
      throw new Error(`无效的 watchers.registered 类型: ${typeof health.watchers.registered}`);
    }
    console.log(`✓ Watchers - capability: ${health.watchers.capability}, registered: ${health.watchers.registered}`);

    if (!health.index) {
      throw new Error('health.index 字段缺失');
    }
    if (typeof health.index.files !== 'number') {
      throw new Error(`无效的 index.files 类型: ${typeof health.index.files}`);
    }
    if (typeof health.index.modules !== 'number') {
      throw new Error(`无效的 index.modules 类型: ${typeof health.index.modules}`);
    }
    console.log(`✓ Index - files: ${health.index.files}, modules: ${health.index.modules}`);

    console.log('✅ 向后兼容性测试通过');
  } finally {
    await shutdownLspClient(client);
  }
}

async function testQueueMetrics(): Promise<void> {
  console.log('\n=== 测试任务队列指标 ===');
  const client = await initializeLspClient();

  try {
    const health = (await client.request('aster/health', {})) as HealthResponse;

    // queue 字段可能存在也可能不存在（取决于 LSP 实现）
    if (health.queue) {
      // 验证 queue.pending
      if (typeof health.queue.pending !== 'number' || health.queue.pending < 0) {
        throw new Error(`无效的 queue.pending: ${health.queue.pending}`);
      }

      // 验证 queue.running
      if (typeof health.queue.running !== 'number' || health.queue.running < 0) {
        throw new Error(`无效的 queue.running: ${health.queue.running}`);
      }

      // 验证 queue.completed
      if (typeof health.queue.completed !== 'number' || health.queue.completed < 0) {
        throw new Error(`无效的 queue.completed: ${health.queue.completed}`);
      }

      // 验证 queue.failed
      if (typeof health.queue.failed !== 'number' || health.queue.failed < 0) {
        throw new Error(`无效的 queue.failed: ${health.queue.failed}`);
      }

      // 验证 queue.cancelled
      if (typeof health.queue.cancelled !== 'number' || health.queue.cancelled < 0) {
        throw new Error(`无效的 queue.cancelled: ${health.queue.cancelled}`);
      }

      // 验证 queue.total
      if (typeof health.queue.total !== 'number' || health.queue.total < 0) {
        throw new Error(`无效的 queue.total: ${health.queue.total}`);
      }

      // 验证 total = pending + running + completed + failed + cancelled
      const expectedTotal = health.queue.pending + health.queue.running + health.queue.completed + health.queue.failed + health.queue.cancelled;
      if (health.queue.total !== expectedTotal) {
        throw new Error(`queue.total (${health.queue.total}) 不等于各状态之和 (${expectedTotal})`);
      }

      console.log(`✓ Queue - pending: ${health.queue.pending}, running: ${health.queue.running}, completed: ${health.queue.completed}, failed: ${health.queue.failed}, cancelled: ${health.queue.cancelled}, total: ${health.queue.total}`);
    } else {
      console.log('ℹ️ queue 字段未返回（可选字段）');
    }

    console.log('✅ 任务队列指标测试通过');
  } finally {
    await shutdownLspClient(client);
  }
}

async function testWatchersExtendedFields(): Promise<void> {
  console.log('\n=== 测试文件监视器扩展字段 ===');
  const client = await initializeLspClient();

  try {
    const health = (await client.request('aster/health', {})) as HealthResponse;

    // 验证 watchers 必须存在
    if (!health.watchers) {
      throw new Error('health.watchers 字段缺失');
    }

    // 验证核心字段
    if (typeof health.watchers.capability !== 'boolean') {
      throw new Error(`无效的 watchers.capability 类型: ${typeof health.watchers.capability}`);
    }
    if (typeof health.watchers.registered !== 'boolean') {
      throw new Error(`无效的 watchers.registered 类型: ${typeof health.watchers.registered}`);
    }

    // 验证可选扩展字段 mode
    if (health.watchers.mode !== undefined) {
      if (typeof health.watchers.mode !== 'string') {
        throw new Error(`无效的 watchers.mode 类型: ${typeof health.watchers.mode}`);
      }
      console.log(`✓ Watchers mode: ${health.watchers.mode}`);
    }

    // 验证可选扩展字段 isRunning
    if (health.watchers.isRunning !== undefined) {
      if (typeof health.watchers.isRunning !== 'boolean') {
        throw new Error(`无效的 watchers.isRunning 类型: ${typeof health.watchers.isRunning}`);
      }
      console.log(`✓ Watchers isRunning: ${health.watchers.isRunning}`);
    }

    // 验证可选扩展字段 trackedFiles
    if (health.watchers.trackedFiles !== undefined) {
      if (typeof health.watchers.trackedFiles !== 'number' || health.watchers.trackedFiles < 0) {
        throw new Error(`无效的 watchers.trackedFiles: ${health.watchers.trackedFiles}`);
      }
      console.log(`✓ Watchers trackedFiles: ${health.watchers.trackedFiles}`);
    }

    console.log(`✓ Watchers - capability: ${health.watchers.capability}, registered: ${health.watchers.registered}`);
    console.log('✅ 文件监视器扩展字段测试通过');
  } finally {
    await shutdownLspClient(client);
  }
}

async function testRestartCountIncrement(): Promise<void> {
  console.log('\n=== 测试重启计数器递增 ===');

  // 注意：重启计数器是全局文件，其他测试可能也会影响它
  // 因此我们只验证计数在两次连续启动之间有所增加

  // 第一次启动，获取初始计数
  console.log('1. 启动第一个 LSP 实例...');
  const client1 = await initializeLspClient();
  const health1 = (await client1.request('aster/health', {})) as HealthResponse;
  const count1 = health1.metadata?.restartCount ?? 0;
  console.log(`   初始重启计数: ${count1}`);
  await shutdownLspClient(client1);

  // 等待进程完全退出
  await new Promise(resolve => setTimeout(resolve, 500));

  // 第二次启动，验证计数增加
  console.log('2. 启动第二个 LSP 实例...');
  const client2 = await initializeLspClient();
  const health2 = (await client2.request('aster/health', {})) as HealthResponse;
  const count2 = health2.metadata?.restartCount ?? 0;
  console.log(`   第二次重启计数: ${count2}`);
  await shutdownLspClient(client2);

  // 验证计数有增加（可能不是精确 +1，因为其他测试可能同时运行）
  if (count2 <= count1) {
    throw new Error(`重启计数未增加: count1=${count1}, count2=${count2}`);
  }

  console.log(`   计数从 ${count1} 增加到 ${count2}`);
  console.log('✅ 重启计数器递增测试通过');
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('LSP Health API 集成测试');
  console.log('========================================');

  try {
    await testProcessMetrics();
    await testMetadata();
    await testBackwardCompatibility();
    await testQueueMetrics();
    await testWatchersExtendedFields();
    await testRestartCountIncrement();

    console.log('\n========================================');
    console.log('✅ 所有 Health API 测试通过');
    console.log('========================================');
  } catch (error) {
    console.error('\n========================================');
    console.error('❌ 测试失败:', error);
    console.error('========================================');
    process.exit(1);
  }
}

main();
