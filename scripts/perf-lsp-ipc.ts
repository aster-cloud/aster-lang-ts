#!/usr/bin/env node
/**
 * 层 2: IPC 通信开销测试
 *
 * 目的：量化 LSP 协议中的 IPC 序列化/反序列化开销
 * 方法：启动 LSP server 子进程，发送最小消息测量往返延迟
 *
 * 预期结果：~5-20ms per request
 */

import { performance } from 'node:perf_hooks';
import { LSPClient } from './lsp-client-helper.js';
import { p50, p95, p99 } from './perf-utils.js';

const WARMUP_ITERATIONS = 10;
const MEASUREMENT_ITERATIONS = 100;

async function measureIPCLatency(client: LSPClient): Promise<number[]> {
  const samples: number[] = [];

  for (let i = 0; i < MEASUREMENT_ITERATIONS; i++) {
    const start = performance.now();
    try {
      // 发送空的 hover 请求（最小有效消息）
      await client.request('textDocument/hover', {
        textDocument: { uri: 'file:///nonexistent.aster' },
        position: { line: 0, character: 0 },
      });
    } catch {
      // 预期会失败（文件不存在），我们只关心往返延迟
    }
    const duration = performance.now() - start;
    samples.push(duration);
  }

  return samples;
}

async function measureInitializeLatency(client: LSPClient): Promise<number> {
  const start = performance.now();
  await client.request('initialize', {
    processId: process.pid,
    capabilities: {},
    workspaceFolders: null,
  });
  return performance.now() - start;
}

async function main(): Promise<void> {
  console.log('🚀 Layer 2: IPC Communication Overhead Test');
  console.log('='.repeat(70));
  console.log('');
  console.log('Purpose: Quantify IPC serialization/deserialization overhead');
  console.log('Method:  Measure round-trip time of minimal LSP messages');
  console.log('');

  const client = new LSPClient();

  try {
    console.log('📦 Starting LSP server...');
    const processStartTime = performance.now();
    client.spawn('dist/src/lsp/server.js');
    const processStartDuration = performance.now() - processStartTime;
    console.log(`✅ Server started in ${processStartDuration.toFixed(2)}ms`);

    // 测量 initialize 握手延迟
    console.log('\n🔬 Measuring initialize handshake latency...');
    const initDuration = await measureInitializeLatency(client);
    console.log(`✅ Initialize completed in ${initDuration.toFixed(2)}ms`);

    // Warmup: 预热 IPC 通道
    console.log(`\n🔥 Warming up (${WARMUP_ITERATIONS} iterations)...`);
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      try {
        await client.request('textDocument/hover', {
          textDocument: { uri: 'file:///warmup.aster' },
          position: { line: 0, character: 0 },
        });
      } catch {
        // Ignore
      }
    }
    console.log('✅ Warmup completed');

    // 测量 IPC 往返延迟
    console.log(`\n🔬 Measuring IPC round-trip latency (${MEASUREMENT_ITERATIONS} iterations)...`);
    const samples = await measureIPCLatency(client);

    // 统计分析
    console.log('\n' + '─'.repeat(70));
    console.log('📈 IPC Round-Trip Latency Statistics:');
    console.log('');
    console.log(`  Samples:     ${samples.length}`);
    console.log(`  Total:       ${samples.reduce((a, b) => a + b, 0).toFixed(2)}ms`);
    console.log(`  Average:     ${(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)}ms`);
    console.log(`  p50 (median):${p50(samples).toFixed(2)}ms`);
    console.log(`  p95:         ${p95(samples).toFixed(2)}ms`);
    console.log(`  p99:         ${p99(samples).toFixed(2)}ms`);
    console.log(`  Min:         ${Math.min(...samples).toFixed(2)}ms`);
    console.log(`  Max:         ${Math.max(...samples).toFixed(2)}ms`);

    // 批量请求开销估算
    const avgLatency = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.log('\n' + '─'.repeat(70));
    console.log('💡 Batch Request Overhead Estimation:');
    console.log('');
    console.log(`  For 1 request:   ${avgLatency.toFixed(2)}ms`);
    console.log(`  For 10 requests: ${(avgLatency * 10).toFixed(2)}ms`);
    console.log(`  For 40 requests: ${(avgLatency * 40).toFixed(2)}ms (Medium project)`);
    console.log(`  For 100 requests:${(avgLatency * 100).toFixed(2)}ms`);

    // 与层 1 对比
    console.log('\n' + '─'.repeat(70));
    console.log('📌 Comparison with Layer 1 (LSP Internal):');
    console.log('');
    console.log('  Layer 1 (in-process):  ~0.95ms per file (cold), ~0.00ms (warm)');
    console.log(`  Layer 2 (IPC):         ${avgLatency.toFixed(2)}ms per request`);
    console.log(`  IPC overhead:          ${avgLatency.toFixed(2)}ms per request`);
    console.log('');
    console.log('  📊 For Medium project (40 files):');
    console.log('     Layer 1 processing:  ~38ms');
    console.log(`     IPC overhead:        ~${(avgLatency * 40).toFixed(2)}ms`);
    console.log(`     Total expected:      ~${(38 + avgLatency * 40).toFixed(2)}ms`);

    console.log('\n' + '='.repeat(70));
    console.log('✅ Layer 2 test completed');
    console.log('');
    console.log('Next steps:');
    console.log('  - Run Layer 3 (perf-lsp-e2e-v2.ts) to measure end-to-end latency');
    console.log('  - Compare all layers to identify bottleneck location');

  } finally {
    console.log('\n🔚 Stopping LSP server...');
    client.close();
  }
}

main().catch(error => {
  console.error('❌ Layer 2 test failed:', error);
  process.exit(1);
});
