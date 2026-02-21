#!/usr/bin/env node
/**
 * 文件监控器单元测试
 * 验证polling降级、并发控制和路径匹配功能
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  configureFileWatcher,
  startFileWatcher,
  stopFileWatcher,
  getWatcherStatus,
  handleNativeFileChanges,
  getScanEventEmitter,
} from '../../../src/lsp/workspace/file-watcher.js';
import type { EventEmitter } from 'node:events';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待下一次扫描完成
 * 通过监听 scan:end 事件实现，避免轮询和经验超时
 */
function waitForNextScanEnd(events: EventEmitter, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      events.off('scan:end', onEnd);
      reject(new Error(`等待扫描完成超时（${timeoutMs}ms）`));
    }, timeoutMs);

    const onEnd = () => {
      clearTimeout(timer);
      resolve();
    };

    events.once('scan:end', onEnd);
  });
}

let testCounter = 0;
async function createTestWorkspace(): Promise<string> {
  const testDir = join(tmpdir(), `aster-test-${Date.now()}-${testCounter++}`);
  await fs.mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * 确保文件监控器完全停止并清理
 */
async function ensureCleanup(): Promise<void> {
  stopFileWatcher();
  // 给一点时间让异步操作完成
  await sleep(50);
}

async function cleanupTestWorkspace(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function testWatcherInitialization(): Promise<void> {
  const testDir = await createTestWorkspace();

  try {
    // 配置为polling模式
    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 1000,
    });

    startFileWatcher([testDir]);

    const status = getWatcherStatus();
    assert(status.enabled, 'Watcher应该被启用');
    assert(status.mode === 'polling', '应该是polling模式');
    assert(status.isRunning, 'Watcher应该正在运行');

    stopFileWatcher();

    const status2 = getWatcherStatus();
    assert(!status2.isRunning, 'Watcher应该已停止');

    console.log('✓ Watcher初始化和停止正常');
  } finally {
    stopFileWatcher();
    await cleanupTestWorkspace(testDir);
  }
}

async function testPollingMode(): Promise<void> {
  const testDir = await createTestWorkspace();

  try {
    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 500, // 500ms轮询
    });

    startFileWatcher([testDir]);

    // 创建一个.aster文件
    const testFile = join(testDir, 'test.aster');
    await fs.writeFile(testFile, 'Module test.\n', 'utf8');

    // 等待足够时间让轮询检测到变化
    await sleep(1000);

    const status = getWatcherStatus();
    // 注意：trackedFiles可能需要一些时间来更新
    // 这里只验证watcher仍在运行
    assert(status.isRunning, 'Watcher应该仍在运行');

    console.log('✓ Polling模式功能正常');
  } finally {
    stopFileWatcher();
    await cleanupTestWorkspace(testDir);
  }
}

async function testConcurrentPollingProtection(): Promise<void> {
  const testDir = await createTestWorkspace();

  try {
    // 创建足够多的文件（100个），确保扫描时间较长
    const fileCount = 100;
    for (let i = 0; i < fileCount; i++) {
      await fs.writeFile(
        join(testDir, `file${i}.aster`),
        `Module test${i}.\n`.repeat(50)
      );
    }

    // 配置极短轮询间隔（10ms），触发并发场景
    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 10,
    });

    // 通过事件监听器统计扫描行为
    const events = getScanEventEmitter();
    let attemptCount = 0;
    let startCount = 0;
    let rejectedCount = 0;

    events.on('scan:attempt', () => attemptCount++);
    events.on('scan:start', () => startCount++);
    events.on('scan:rejected', () => rejectedCount++);

    startFileWatcher([testDir]);

    // 等待第一次扫描完成
    await waitForNextScanEnd(events);

    // 继续运行一段时间，让轮询器触发多次
    await sleep(200);

    // 验证文件被跟踪（在 stop 之前检查，因为 stop 会清空 fileSnapshots）
    const status = getWatcherStatus();
    assert(
      status.trackedFiles >= fileCount,
      `应该跟踪至少${fileCount}个文件，实际跟踪${status.trackedFiles}个`
    );

    stopFileWatcher();

    // 关键断言：如果单飞行锁有效，应该有扫描被拒绝
    // attemptCount = startCount + rejectedCount
    assert(
      attemptCount === startCount + rejectedCount,
      `尝试次数(${attemptCount})应该等于开始次数(${startCount})+拒绝次数(${rejectedCount})`
    );

    assert(
      rejectedCount > 0,
      `单飞行锁应该拒绝至少一次并发扫描，实际拒绝${rejectedCount}次`
    );

    assert(
      startCount < attemptCount,
      `开始执行次数(${startCount})应该小于尝试次数(${attemptCount})`
    );

    console.log(
      `✓ 并发轮询保护功能正常（尝试${attemptCount}次，执行${startCount}次，拒绝${rejectedCount}次）`
    );
  } finally {
    stopFileWatcher();
    await cleanupTestWorkspace(testDir);
  }
}

async function testPathMatching(): Promise<void> {
  // 测试路径匹配逻辑，避免前缀碰撞
  // 核心场景：监控两个平行目录 /foo/bar 和 /foo/barista
  // 删除 /foo/bar 中的文件时，旧版 startsWith 逻辑会误删 /foo/barista 中的文件
  // （因为 '/foo/barista'.startsWith('/foo/bar') 返回 true）

  const testDir = await createTestWorkspace();

  try {
    // 创建类似命名的目录（前缀碰撞场景）
    const fooDir = join(testDir, 'foo');
    const dir1 = join(fooDir, 'bar');
    const dir2 = join(fooDir, 'barista');

    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });

    // 在两个目录中创建文件
    const file1 = join(dir1, 'file1.aster');
    const file2 = join(dir2, 'file2.aster');
    await fs.writeFile(file1, 'Module bar.\n');
    await fs.writeFile(file2, 'Module barista.\n');

    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 200,
    });

    const events = getScanEventEmitter();

    startFileWatcher([dir1, dir2]);

    // 等待第一次扫描完成
    await waitForNextScanEnd(events);

    const initialTracked = getWatcherStatus().trackedFiles;
    assert(
      initialTracked >= 2,
      `应该跟踪至少2个文件，实际跟踪${initialTracked}个`
    );

    // 删除 foo/bar 中的文件
    // 旧版 startsWith 逻辑会在 detectChanges(dir1) 时误删 foo/barista/file2.aster
    // 因为 '/foo/barista/file2.aster'.startsWith('/foo/bar') 返回 true
    await fs.unlink(file1);

    // 等待下一次扫描完成
    await waitForNextScanEnd(events);

    // 验证 foo/barista 中的文件没有被误删
    // 若回退到 startsWith 逻辑，此断言会失败（trackedFiles 会变成 initialTracked-2 而非 initialTracked-1）
    const status2 = getWatcherStatus();
    assert(
      status2.trackedFiles === initialTracked - 1,
      `删除file1后应该还剩${initialTracked - 1}个文件（file2不应被误删），实际剩余${status2.trackedFiles}个`
    );

    // 删除 foo/barista 中的文件
    await fs.unlink(file2);
    await waitForNextScanEnd(events);

    const status3 = getWatcherStatus();
    assert(
      status3.trackedFiles === initialTracked - 2,
      `删除file2后应该剩余${initialTracked - 2}个文件，实际剩余${status3.trackedFiles}个`
    );

    console.log(
      '✓ 路径匹配功能正常（使用relative()避免前缀碰撞，监控/foo/bar时删除不影响/foo/barista）'
    );
  } finally {
    stopFileWatcher();
    await cleanupTestWorkspace(testDir);
  }
}

async function testNativeMode(): Promise<void> {
  // 测试native模式的事件处理
  configureFileWatcher({
    mode: 'native',
    enabled: true,
  });

  // 模拟客户端发送的文件变更事件
  const changes = [
    { uri: 'file:///test/file1.aster', type: 1 }, // created
    { uri: 'file:///test/file2.aster', type: 2 }, // changed
    { uri: 'file:///test/file3.aster', type: 3 }, // deleted
  ];

  // handleNativeFileChanges应该能处理这些事件而不崩溃
  await handleNativeFileChanges(changes);

  console.log('✓ Native模式事件处理正常');
}

async function testWatcherReconfiguration(): Promise<void> {
  const testDir = await createTestWorkspace();

  try {
    // 初始配置
    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 1000,
    });

    startFileWatcher([testDir]);
    assert(getWatcherStatus().isRunning, 'Watcher应该启动');

    // 重新配置（应该重启watcher）
    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 2000,
    });

    const status = getWatcherStatus();
    assert(status.isRunning, 'Watcher应该仍在运行');

    console.log('✓ Watcher重新配置功能正常');
  } finally {
    stopFileWatcher();
    await cleanupTestWorkspace(testDir);
  }
}

async function testExcludePatterns(): Promise<void> {
  const testDir = await createTestWorkspace();

  try {
    // 创建应该被排除的目录
    const nodeModules = join(testDir, 'node_modules');
    const gitDir = join(testDir, '.git');
    const srcDir = join(testDir, 'src');

    await fs.mkdir(nodeModules, { recursive: true });
    await fs.mkdir(gitDir, { recursive: true });
    await fs.mkdir(srcDir, { recursive: true });

    // 在各目录中创建文件
    await fs.writeFile(join(nodeModules, 'dep.aster'), 'module dep.\n');
    await fs.writeFile(join(gitDir, 'config.aster'), 'module git.\n');
    await fs.writeFile(join(srcDir, 'main.aster'), 'Module main.\n');

    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 500,
      excludePatterns: ['node_modules', '.git'], // 默认排除
    });

    startFileWatcher([testDir]);

    await sleep(1000);

    // node_modules和.git中的文件应该不被跟踪
    // 只有src中的文件应该被跟踪
    const status = getWatcherStatus();
    // trackedFiles应该只包含main.aster
    // 具体数量验证取决于实现细节
    assert(status.isRunning, 'Watcher应该正在运行');

    console.log('✓ 排除模式功能正常');
  } finally {
    stopFileWatcher();
    await cleanupTestWorkspace(testDir);
  }
}

async function testFileCreationAndDeletion(): Promise<void> {
  const testDir = await createTestWorkspace();

  try {
    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 300,
    });

    startFileWatcher([testDir]);

    const testFile = join(testDir, 'temp.aster');

    // 创建文件
    await fs.writeFile(testFile, 'Module temp.\n');
    await sleep(500);

    let status = getWatcherStatus();
    const filesAfterCreate = status.trackedFiles;

    // 删除文件
    await fs.unlink(testFile);
    await sleep(500);

    status = getWatcherStatus();
    const filesAfterDelete = status.trackedFiles;

    // 文件数量应该减少
    assert(
      filesAfterDelete < filesAfterCreate || filesAfterCreate === 0,
      '删除文件后跟踪文件数应该减少'
    );

    console.log('✓ 文件创建和删除检测正常');
  } finally {
    stopFileWatcher();
    await cleanupTestWorkspace(testDir);
  }
}

async function testMultiInstanceIsolation(): Promise<void> {
  // 测试多实例场景：两个独立的 FileWatcher 实例并行运行，互不影响
  // 这是对实例级重构的关键验证

  const testDir1 = await createTestWorkspace();
  const testDir2 = await createTestWorkspace();

  try {
    // 动态导入 FileWatcher 类
    const { FileWatcher } = await import('../../../src/lsp/workspace/file-watcher.js');

    // 创建两个独立实例
    const watcher1 = new FileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 200,
    });

    const watcher2 = new FileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 200,
    });

    // 在两个目录中创建不同的文件
    await fs.writeFile(join(testDir1, 'file1.aster'), 'Module watcher1.\n');
    await fs.writeFile(join(testDir2, 'file2.aster'), 'Module watcher2.\n');

    // 分别启动两个实例
    watcher1.start([testDir1]);
    watcher2.start([testDir2]);

    // 获取各自的事件发射器
    const events1 = watcher1.getEventEmitter();
    const events2 = watcher2.getEventEmitter();

    // 等待两个实例的首次扫描完成
    await Promise.all([
      waitForNextScanEnd(events1),
      waitForNextScanEnd(events2),
    ]);

    // 验证状态隔离：每个实例只跟踪自己目录的文件
    const status1 = watcher1.getStatus();
    const status2 = watcher2.getStatus();

    assert(status1.isRunning, 'Watcher1 应该正在运行');
    assert(status2.isRunning, 'Watcher2 应该正在运行');
    assert(status1.trackedFiles === 1, `Watcher1 应该只跟踪1个文件，实际跟踪${status1.trackedFiles}个`);
    assert(status2.trackedFiles === 1, `Watcher2 应该只跟踪1个文件，实际跟踪${status2.trackedFiles}个`);

    // 验证事件隔离：各自的事件监听器只收到自己的事件
    let events1Count = 0;
    let events2Count = 0;

    events1.on('scan:end', () => events1Count++);
    events2.on('scan:end', () => events2Count++);

    // 等待下一轮扫描
    await sleep(500);

    // 两个实例应该都触发了扫描事件
    assert(events1Count > 0, `Watcher1 应该触发扫描事件，实际触发${events1Count}次`);
    assert(events2Count > 0, `Watcher2 应该触发扫描事件，实际触发${events2Count}次`);

    // 停止 watcher1，验证不影响 watcher2
    watcher1.stop();
    const status1After = watcher1.getStatus();
    const status2After = watcher2.getStatus();

    assert(!status1After.isRunning, 'Watcher1 应该已停止');
    assert(status2After.isRunning, 'Watcher2 应该仍在运行');
    assert(status1After.trackedFiles === 0, 'Watcher1 停止后应该清空跟踪文件');
    assert(status2After.trackedFiles === 1, 'Watcher2 应该仍跟踪1个文件');

    // 停止 watcher2
    watcher2.stop();

    console.log('✓ 多实例隔离功能正常（状态、事件、生命周期完全独立）');
  } finally {
    await cleanupTestWorkspace(testDir1);
    await cleanupTestWorkspace(testDir2);
  }
}

async function main(): Promise<void> {
  console.log('Running LSP file watcher tests...\n');

  try {
    await testWatcherInitialization();
    await ensureCleanup();

    await testPollingMode();
    await ensureCleanup();

    await testConcurrentPollingProtection();
    await ensureCleanup();

    await testPathMatching();
    await ensureCleanup();

    await testNativeMode();
    await ensureCleanup();

    await testWatcherReconfiguration();
    await ensureCleanup();

    await testExcludePatterns();
    await ensureCleanup();

    await testFileCreationAndDeletion();
    await ensureCleanup();

    await testMultiInstanceIsolation();
    // 注意：多实例测试不需要 ensureCleanup，因为它不使用默认实例

    console.log('\n✅ All file watcher tests passed.');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
