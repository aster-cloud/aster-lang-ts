#!/usr/bin/env node
/**
 * LSP 进程生命周期集成测试
 * 验证进程启动、优雅关闭和状态恢复场景
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { LSPClient } from '../../../scripts/lsp-client-helper.js';

/** 检查进程是否存活 */
function isProcessAlive(pid: number): boolean {
  try {
    // 发送信号 0 检查进程是否存在（不会杀死进程）
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 等待进程退出 */
async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

/** 初始化 LSP 客户端并完成握手 */
async function initializeLspClient(): Promise<LSPClient> {
  const client = new LSPClient();
  client.spawn('dist/src/lsp/server.js');

  await client.request('initialize', {
    processId: process.pid,
    clientInfo: { name: 'lifecycle-test-client', version: '1.0.0' },
    rootUri: null,
    capabilities: {},
  });
  client.notify('initialized', {});

  return client;
}

/** 获取 LSP 服务器进程 PID */
async function getServerPid(client: LSPClient): Promise<number> {
  const health = (await client.request('aster/health', {})) as { process?: { pid: number } };
  if (!health.process?.pid) {
    throw new Error('无法获取 LSP 服务器 PID');
  }
  return health.process.pid;
}

async function testGracefulShutdown(): Promise<void> {
  console.log('\n=== 测试优雅关闭 ===');
  const client = await initializeLspClient();

  try {
    // 获取服务器进程 PID
    const pid = await getServerPid(client);
    console.log(`1. LSP 服务器 PID: ${pid}`);

    // 验证进程存活
    if (!isProcessAlive(pid)) {
      throw new Error('LSP 服务器进程未启动');
    }
    console.log('2. 进程存活确认');

    // 发送 shutdown 请求
    console.log('3. 发送 shutdown 请求...');
    await client.request('shutdown');
    console.log('   shutdown 响应已收到');

    // 发送 exit 通知
    console.log('4. 发送 exit 通知...');
    client.notify('exit');

    // 等待进程退出（最多 5 秒）
    console.log('5. 等待进程退出...');
    const exited = await waitForProcessExit(pid, 5000);

    if (!exited) {
      throw new Error(`进程 ${pid} 未在 5 秒内退出`);
    }
    console.log(`   进程 ${pid} 已优雅退出`);

    console.log('✅ 优雅关闭测试通过');
  } finally {
    client.close();
  }
}

async function testForcedTermination(): Promise<void> {
  console.log('\n=== 测试强制终止恢复 ===');
  const client = await initializeLspClient();

  try {
    // 获取服务器进程 PID
    const oldPid = await getServerPid(client);
    console.log(`1. LSP 服务器 PID: ${oldPid}`);

    // 验证旧进程存活
    if (!isProcessAlive(oldPid)) {
      throw new Error('LSP 服务器进程未启动');
    }
    console.log('   旧进程存活确认');

    // 强制关闭客户端（不发送 shutdown/exit）
    console.log('2. 强制关闭客户端连接（模拟意外断开）...');
    client.close();

    // 等待旧进程退出（stdio 关闭后 LSP 应自动退出）
    console.log('3. 等待旧进程退出...');
    const oldExited = await waitForProcessExit(oldPid, 5000);
    if (!oldExited) {
      // 如果进程未自动退出，这是一个警告但不是致命错误
      // 因为 stdio LSP 服务器在 stdin 关闭后应该退出
      console.log(`   ⚠️ 警告: 旧进程 ${oldPid} 未在 5 秒内自动退出`);
      // 尝试强制终止以清理
      try {
        process.kill(oldPid, 'SIGTERM');
        await waitForProcessExit(oldPid, 2000);
      } catch {
        // 忽略终止错误
      }
    } else {
      console.log(`   旧进程 ${oldPid} 已退出`);
    }

    // 验证旧进程确实已退出
    if (isProcessAlive(oldPid)) {
      throw new Error(`旧进程 ${oldPid} 仍在运行，存在孤儿进程风险`);
    }
    console.log('4. 确认无孤儿进程');

    // 启动新的客户端，验证可以正常连接
    console.log('5. 启动新的 LSP 客户端...');
    const newClient = await initializeLspClient();
    const newPid = await getServerPid(newClient);
    console.log(`   新服务器 PID: ${newPid}`);

    // 验证是不同的进程
    if (newPid === oldPid) {
      throw new Error(`新旧 PID 相同 (${newPid})，进程复用异常`);
    }

    // 验证新服务器正常工作
    const health = await newClient.request('aster/health', {});
    if (!health) {
      throw new Error('新服务器健康检查失败');
    }
    console.log('6. 新服务器健康检查通过');

    // 清理新进程
    await newClient.request('shutdown');
    newClient.notify('exit');
    await waitForProcessExit(newPid, 3000);
    newClient.close();

    console.log('✅ 强制终止恢复测试通过');
  } catch (error) {
    client.close();
    throw error;
  }
}

async function testMultipleClients(): Promise<void> {
  console.log('\n=== 测试多客户端场景 ===');

  // 启动多个独立的 LSP 服务器进程
  const clients: LSPClient[] = [];
  const pids: number[] = [];

  try {
    // 启动 3 个客户端
    for (let i = 0; i < 3; i++) {
      console.log(`1.${i + 1}. 启动客户端 ${i + 1}...`);
      const client = await initializeLspClient();
      const pid = await getServerPid(client);
      clients.push(client);
      pids.push(pid);
      console.log(`     PID: ${pid}`);
    }

    // 验证所有进程都在运行
    console.log('2. 验证所有进程都在运行...');
    for (let i = 0; i < pids.length; i++) {
      const pid = pids[i]!;
      if (!isProcessAlive(pid)) {
        throw new Error(`客户端 ${i + 1} 的进程 ${pid} 未运行`);
      }
    }
    console.log('   所有进程确认运行');

    // 依次关闭客户端
    console.log('3. 依次关闭客户端...');
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]!;
      const pid = pids[i]!;
      await client.request('shutdown');
      client.notify('exit');
      await waitForProcessExit(pid, 3000);
      console.log(`   客户端 ${i + 1} (PID: ${pid}) 已关闭`);
    }

    // 验证所有进程都已退出
    console.log('4. 验证所有进程都已退出...');
    await new Promise(resolve => setTimeout(resolve, 500));
    for (let i = 0; i < pids.length; i++) {
      const pid = pids[i]!;
      if (isProcessAlive(pid)) {
        throw new Error(`进程 ${pid} 仍在运行`);
      }
    }
    console.log('   所有进程已退出');

    console.log('✅ 多客户端场景测试通过');
  } finally {
    // 确保清理所有客户端
    for (const client of clients) {
      try {
        client.close();
      } catch {
        // 忽略关闭错误
      }
    }
  }
}

async function testRapidRestarts(): Promise<void> {
  console.log('\n=== 测试快速重启场景 ===');

  const restartCount = 3;
  let previousPid = 0;

  for (let i = 0; i < restartCount; i++) {
    console.log(`${i + 1}. 启动 LSP 服务器 (第 ${i + 1} 次)...`);
    const client = await initializeLspClient();
    const pid = await getServerPid(client);
    console.log(`   PID: ${pid}`);

    // 验证是新进程
    if (pid === previousPid) {
      throw new Error(`PID 与上次相同: ${pid}`);
    }
    previousPid = pid;

    // 验证健康检查
    const health = await client.request('aster/health', {});
    if (!health) {
      throw new Error('健康检查失败');
    }
    console.log('   健康检查通过');

    // 关闭
    await client.request('shutdown');
    client.notify('exit');
    await waitForProcessExit(pid, 3000);
    client.close();

    // 短暂等待
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('✅ 快速重启场景测试通过');
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('LSP 进程生命周期集成测试');
  console.log('========================================');

  try {
    await testGracefulShutdown();
    await testForcedTermination();
    await testMultipleClients();
    await testRapidRestarts();

    console.log('\n========================================');
    console.log('✅ 所有进程生命周期测试通过');
    console.log('========================================');
  } catch (error) {
    console.error('\n========================================');
    console.error('❌ 测试失败:', error);
    console.error('========================================');
    process.exit(1);
  }
}

main();
