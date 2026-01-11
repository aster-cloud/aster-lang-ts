#!/usr/bin/env node
/**
 * LSP 客户端辅助类集成测试
 * 验证 initialize/shutdown/exit 流程
 */

import { LSPClient } from '../../../scripts/lsp-client-helper.js';

async function testLSPClientLifecycle(): Promise<void> {
  const client = new LSPClient();

  try {
    // 启动 LSP 服务器
    console.log('1. 启动 LSP 服务器...');
    client.spawn('dist/src/lsp/server.js');

    // 发送 initialize 请求
    console.log('2. 发送 initialize 请求...');
    const initResult = await client.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'test-client', version: '1.0.0' },
      rootUri: null,
      capabilities: {},
    });
    console.log('✓ Initialize 成功:', initResult ? '收到响应' : '未收到响应');

    // 发送 initialized 通知
    console.log('3. 发送 initialized 通知...');
    client.notify('initialized', {});

    // 发送 shutdown 请求
    console.log('4. 发送 shutdown 请求...');
    await client.request('shutdown');
    console.log('✓ Shutdown 成功');

    // 发送 exit 通知
    console.log('5. 发送 exit 通知...');
    client.notify('exit');

    // 等待进程退出
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n✅ LSP 客户端生命周期测试通过');
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  } finally {
    client.close();
  }
}

testLSPClientLifecycle();
