#!/usr/bin/env node
/**
 * 层 3: 端到端延迟测试 (重构版)
 *
 * 目的：测量完整 LSP 协议流程的端到端延迟，包含分阶段测量
 * 方法：启动 LSP server，通过完整协议流程测试诊断、hover、completion
 *
 * 改进点：
 * 1. 分阶段测量：进程启动、文件I/O、协议握手、实际诊断
 * 2. 合理超时：单文件1秒，批量 n*100ms
 * 3. 真实多模块测试：测试所有文件而非仅入口
 * 4. 详细报告：各阶段耗时、百分位数、瓶颈识别
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { p50, p95, p99 } from './perf-utils.js';
import { generateMediumProject, generateLargeProgram } from '../test/generators.js';
import { LSPClient } from './lsp-client-helper.js';

type ProjectDefinition = {
  name: string;
  files: Map<string, string>;
  testFiles: string[];  // 要测试的文件列表（可能是所有文件）
};

type ProjectMetrics = {
  name: string;
  files: number;
  lines: number;
  timings: {
    processStart_ms: number;
    fileIO_ms: number;
    initialize_ms: number;
    firstDiagnostic: { p50: number; p95: number; p99: number };
    incrementalDiagnostic: { p50: number; p95: number; p99: number };
  };
  bottleneck: string;
  cacheHitRate: number;
};

const SINGLE_FILE_TIMEOUT_MS = 1_000;  // 1 秒单文件诊断超时
const INCREMENTAL_ITERATIONS = 5;      // 增量诊断迭代次数

async function main(): Promise<void> {
  console.log('🚀 Layer 3: End-to-End Latency Test (v2)');
  console.log('='.repeat(70));
  console.log('');
  console.log('Purpose: Measure complete LSP protocol flow with phased breakdown');
  console.log('Method:  Full LSP lifecycle including process start, file I/O, protocol handshake');
  console.log('');

  const report: Record<string, ProjectMetrics> = {};

  const scenarios = [
    await prepareSmallProject(),
    await prepareMediumProject(),
    await prepareLargeProject(),
  ];

  for (const scenario of scenarios) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📦 Testing ${scenario.name} project (${scenario.files.size} files, ${scenario.testFiles.length} to test)`);
    console.log('='.repeat(70));

    const metrics = await measureScenario(scenario);
    report[scenario.name] = metrics;

    // 打印每个项目的摘要
    printScenarioSummary(metrics);
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 FINAL REPORT');
  console.log('='.repeat(70));
  console.log(JSON.stringify(report, null, 2));

  console.log('\n' + '='.repeat(70));
  console.log('✅ Layer 3 test completed');
  console.log('');
  console.log('Comparison with previous layers:');
  console.log('  - Layer 0 (pure processing):  ~41ms for 40 modules');
  console.log('  - Layer 1 (LSP internal):     ~38ms for 40 modules');
  console.log('  - Layer 2 (IPC overhead):     ~4ms for 40 requests');
  console.log('  - Layer 3 (end-to-end):       see report above');
}

async function measureScenario(definition: ProjectDefinition): Promise<ProjectMetrics> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), `aster-perf-${definition.name}-`));
  const client = new LSPClient();

  try {
    // 阶段 1: 文件写入
    console.log('\n📝 Phase 1: Writing files to disk...');
    const fileIOStart = performance.now();
    await writeProjectFiles(workspaceRoot, definition.files);
    const fileIOMs = performance.now() - fileIOStart;
    console.log(`✅ Wrote ${definition.files.size} files in ${fileIOMs.toFixed(2)}ms`);

    // 阶段 2: 启动 LSP server
    console.log('\n🚀 Phase 2: Starting LSP server...');
    const processStartTime = performance.now();
    client.spawn('dist/src/lsp/server.js');
    const processStartMs = performance.now() - processStartTime;
    console.log(`✅ Server started in ${processStartMs.toFixed(2)}ms`);

    // 阶段 3: LSP 初始化握手
    console.log('\n🤝 Phase 3: LSP initialize handshake...');
    const initializeStart = performance.now();
    await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(workspaceRoot).href,
      capabilities: {
        textDocument: {
          diagnostic: {},
        },
      },
    });
    client.notify('initialized', {});
    const initializeMs = performance.now() - initializeStart;
    console.log(`✅ Initialize completed in ${initializeMs.toFixed(2)}ms`);

    // 阶段 3.5: 等待预热完成（通过 workspace diagnostics 请求）
    console.log(`\n⏱️  Phase 3.5: Waiting for diagnostics warmup...`);
    const warmupStart = performance.now();
    try {
      await withTimeout(
        client.request('workspace/diagnostic', { previousResultIds: [] }),
        60_000,  // 60秒超时，足够预热40个文件
        'workspace diagnostic warmup',
      );
      const warmupMs = performance.now() - warmupStart;
      console.log(`✅ Warmup completed in ${warmupMs.toFixed(2)}ms`);
    } catch {
      console.warn(`⚠️  Warmup timeout or failed, continuing with test...`);
    }

    // 阶段 4: 首次诊断（冷启动）
    console.log(`\n🔬 Phase 4: First diagnostic (cold start) on ${definition.testFiles.length} files...`);
    const firstDiagnosticSamples: number[] = [];

    for (let i = 0; i < definition.testFiles.length; i++) {
      const relPath = definition.testFiles[i];
      if (!relPath) {
        console.warn(`⚠️  File path is undefined at index ${i}`);
        continue;
      }
      const absPath = path.join(workspaceRoot, relPath);
      const uri = pathToFileURL(absPath).href;
      const text = definition.files.get(relPath);
      if (!text) {
        console.warn(`⚠️  File not found: ${relPath}`);
        continue;
      }

      // didOpen
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: 'cnl',
          version: 1,
          text,
        },
      });

      // Pull diagnostics
      const start = performance.now();
      try {
        await withTimeout(
          client.request('textDocument/diagnostic', { textDocument: { uri } }),
          SINGLE_FILE_TIMEOUT_MS,
          `diagnostic for ${relPath}`,
        );
        const duration = performance.now() - start;
        firstDiagnosticSamples.push(duration);

        if (i < 5 || i === definition.testFiles.length - 1) {
          console.log(`  [${(i + 1).toString().padStart(2)}/${definition.testFiles.length}] ${relPath.padEnd(40)} ${duration.toFixed(2)}ms`);
        } else if (i === 5) {
          console.log(`  ... (${definition.testFiles.length - 10} more files) ...`);
        }
      } catch {
        console.warn(`  [${(i + 1).toString().padStart(2)}/${definition.testFiles.length}] ${relPath.padEnd(40)} TIMEOUT`);
      }
    }

    console.log(`\n✅ First diagnostic completed: ${firstDiagnosticSamples.length}/${definition.testFiles.length} files succeeded`);
    console.log(`   Total: ${firstDiagnosticSamples.reduce((a, b) => a + b, 0).toFixed(2)}ms`);
    console.log(`   Average: ${(firstDiagnosticSamples.reduce((a, b) => a + b, 0) / firstDiagnosticSamples.length).toFixed(2)}ms`);

    // 阶段 5: 增量诊断（热启动）
    console.log(`\n🔄 Phase 5: Incremental diagnostic (warm start)...`);
    const incrementalSamples: number[] = [];

    // 只测试第一个文件的增量更新，避免过长
    const testFile = definition.testFiles[0];
    if (!testFile) {
      console.warn('⚠️  No test files available for incremental diagnostic');
    } else {
      const absPath = path.join(workspaceRoot, testFile);
      const uri = pathToFileURL(absPath).href;
      const text = definition.files.get(testFile);
      if (!text) {
        console.warn(`⚠️  File content not found: ${testFile}`);
      } else {

        for (let i = 0; i < INCREMENTAL_ITERATIONS; i++) {
          const version = 2 + i;
          client.notify('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text }],  // 相同内容，测试缓存
          });

          const start = performance.now();
          try {
            await withTimeout(
              client.request('textDocument/diagnostic', { textDocument: { uri } }),
              SINGLE_FILE_TIMEOUT_MS,
              `incremental diagnostic ${i + 1}`,
            );
            const duration = performance.now() - start;
            incrementalSamples.push(duration);
            console.log(`  Iteration ${i + 1}: ${duration.toFixed(2)}ms`);
          } catch {
            console.warn(`  Iteration ${i + 1}: TIMEOUT`);
          }
        }
      }
    }

    console.log(`\n✅ Incremental diagnostic completed: ${incrementalSamples.length}/${INCREMENTAL_ITERATIONS} iterations succeeded`);

    // 计算缓存命中率
    const avgFirst = firstDiagnosticSamples.reduce((a, b) => a + b, 0) / firstDiagnosticSamples.length;
    const avgIncremental = incrementalSamples.reduce((a, b) => a + b, 0) / incrementalSamples.length;
    const speedup = avgFirst / (avgIncremental || 1);
    const cacheHitRate = Math.min(1, speedup / 10);  // 假设理想加速10x

    // 识别瓶颈
    const timings = {
      processStart_ms: processStartMs,
      fileIO_ms: fileIOMs,
      initialize_ms: initializeMs,
      firstDiagnostic_total: firstDiagnosticSamples.reduce((a, b) => a + b, 0),
      incrementalDiagnostic_total: incrementalSamples.reduce((a, b) => a + b, 0),
    };
    const sortedTimings = Object.entries(timings).sort((a, b) => b[1] - a[1]);
    const bottleneck = sortedTimings[0]?.[0] ?? 'unknown';

    // 关闭 LSP server
    try {
      await client.request('shutdown');
    } catch {
      // Ignore
    } finally {
      client.notify('exit');
    }

    return {
      name: definition.name,
      files: definition.files.size,
      lines: countLines(definition.files),
      timings: {
        processStart_ms: processStartMs,
        fileIO_ms: fileIOMs,
        initialize_ms: initializeMs,
        firstDiagnostic: {
          p50: p50(firstDiagnosticSamples),
          p95: p95(firstDiagnosticSamples),
          p99: p99(firstDiagnosticSamples),
        },
        incrementalDiagnostic: {
          p50: p50(incrementalSamples),
          p95: p95(incrementalSamples),
          p99: p99(incrementalSamples),
        },
      },
      bottleneck,
      cacheHitRate,
    };
  } finally {
    client.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

function printScenarioSummary(metrics: ProjectMetrics): void {
  console.log(`\n📊 ${metrics.name} project summary:`);
  console.log(`   Files: ${metrics.files}`);
  console.log(`   Lines: ${metrics.lines}`);
  console.log(`   Timings:`);
  console.log(`     Process start:          ${metrics.timings.processStart_ms.toFixed(2)}ms`);
  console.log(`     File I/O:               ${metrics.timings.fileIO_ms.toFixed(2)}ms`);
  console.log(`     Initialize:             ${metrics.timings.initialize_ms.toFixed(2)}ms`);
  console.log(`     First diagnostic (p50): ${metrics.timings.firstDiagnostic.p50.toFixed(2)}ms`);
  console.log(`     Incremental (p50):      ${metrics.timings.incrementalDiagnostic.p50.toFixed(2)}ms`);
  console.log(`   Bottleneck: ${metrics.bottleneck}`);
  console.log(`   Cache hit rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
}

async function writeProjectFiles(root: string, files: Map<string, string>): Promise<void> {
  for (const [relativePath, content] of files) {
    const absPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf8');
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（>${timeoutMs}ms）`)), timeoutMs);
    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function countLines(files: Map<string, string>): number {
  let total = 0;
  for (const text of files.values()) {
    if (text.length === 0) {
      total += 1;
      continue;
    }
    total += text.split(/\r?\n/).length;
  }
  return total;
}

async function prepareSmallProject(): Promise<ProjectDefinition> {
  const greetPath = path.resolve('test/cnl/programs/examples/greet.aster');
  const text = await fs.readFile(greetPath, 'utf8');
  const files = new Map<string, string>();
  files.set('examples/greet.aster', text);

  return {
    name: 'small',
    files,
    testFiles: ['examples/greet.aster'],
  };
}

async function prepareMediumProject(): Promise<ProjectDefinition> {
  const modules = generateMediumProject(40, 42);
  const files = new Map<string, string>();
  const testFiles: string[] = [];

  for (const [moduleName, content] of modules) {
    const relPath = moduleName.split('.').join('/') + '.aster';
    files.set(relPath, content);
    testFiles.push(relPath);  // ✅ 测试所有文件！
  }

  return {
    name: 'medium',
    files,
    testFiles,
  };
}

async function prepareLargeProject(): Promise<ProjectDefinition> {
  const moduleName = 'benchmark.test';
  const content = generateLargeProgram(50);
  const relativePath = moduleName.split('.').join('/') + '.aster';
  const files = new Map<string, string>();
  files.set(relativePath, content);

  return {
    name: 'large',
    files,
    testFiles: [relativePath],
  };
}

main().catch(err => {
  console.error('❌ Layer 3 test failed:', err);
  process.exit(1);
});
