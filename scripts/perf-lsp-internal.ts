#!/usr/bin/env node
/**
 * 层 1: LSP Server 内部延迟测试
 *
 * 目的：测量 LSP diagnostics 层的实际开销（包含缓存，但无 IPC）
 * 方法：直接在进程内调用 computeDiagnostics，无 LSP 协议和 IPC 开销
 *
 * 预期结果：~60-80ms for 40 modules (略高于纯处理的 41ms，因为有缓存和格式转换)
 */

import { performance } from 'node:perf_hooks';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { computeDiagnostics } from '../src/lsp/diagnostics.js';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import { generateMediumProject, generateLargeProgram } from '../test/generators.js';
import { p50, p95, p99 } from './perf-utils.js';
import fs from 'node:fs/promises';

interface TestScenario {
  name: string;
  files: Map<string, string>;
}

function getOrParse(doc: TextDocument): { text: string; tokens: readonly any[]; ast: any } {
  const text = doc.getText();
  const can = canonicalize(text);
  const tokens = lex(can);
  let ast: any;
  try {
    ast = parse(tokens);
  } catch {
    ast = null;
  }
  return { text, tokens, ast };
}

async function prepareSmallScenario(): Promise<TestScenario> {
  const greetPath = 'test/cnl/programs/examples/greet.aster';
  const text = await fs.readFile(greetPath, 'utf8');
  const files = new Map<string, string>();
  files.set('greet.aster', text);
  return { name: 'small', files };
}

async function prepareMediumScenario(): Promise<TestScenario> {
  const modules = generateMediumProject(40, 42);
  const files = new Map<string, string>();
  for (const [moduleName, content] of modules) {
    const fileName = moduleName.split('.').join('/') + '.aster';
    files.set(fileName, content);
  }
  return { name: 'medium', files };
}

async function prepareLargeScenario(): Promise<TestScenario> {
  const content = generateLargeProgram(50);
  const files = new Map<string, string>();
  files.set('large.aster', content);
  return { name: 'large', files };
}

async function measureScenario(scenario: TestScenario): Promise<void> {
  console.log(`\n🔬 Testing ${scenario.name} scenario (${scenario.files.size} files)`);
  console.log('─'.repeat(70));

  const coldStartSamples: number[] = [];
  const warmStartSamples: number[] = [];

  // Cold start: 测量每个文件的首次诊断
  console.log('\n📊 Cold Start (First Diagnostics):');
  let fileIndex = 0;
  for (const [fileName, content] of scenario.files) {
    fileIndex++;
    const uri = `file:///test/${fileName}`;
    const doc = TextDocument.create(uri, 'cnl', 1, content);

    const start = performance.now();
    try {
      const diagnostics = await computeDiagnostics(doc, getOrParse);
      const duration = performance.now() - start;
      coldStartSamples.push(duration);

      if (fileIndex <= 5 || fileIndex === scenario.files.size) {
        console.log(
          `  [${fileIndex.toString().padStart(2)}/${scenario.files.size}] ${fileName.padEnd(40)} ` +
          `${duration.toFixed(2).padStart(8)}ms  (${diagnostics.length} diags)`
        );
      } else if (fileIndex === 6) {
        console.log(`  ... (${scenario.files.size - 10} more files) ...`);
      }
    } catch (error) {
      console.log(
        `  [${fileIndex.toString().padStart(2)}/${scenario.files.size}] ${fileName.padEnd(40)} ` +
        `ERROR: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Warm start: 重新请求相同文件的诊断（测试缓存效果）
  console.log('\n📊 Warm Start (Cached Diagnostics):');
  fileIndex = 0;
  for (const [fileName, content] of scenario.files) {
    fileIndex++;
    const uri = `file:///test/${fileName}`;
    const doc = TextDocument.create(uri, 'cnl', 1, content);  // 相同 version=1

    const start = performance.now();
    try {
      const diagnostics = await computeDiagnostics(doc, getOrParse);
      const duration = performance.now() - start;
      warmStartSamples.push(duration);

      if (fileIndex <= 5 || fileIndex === scenario.files.size) {
        console.log(
          `  [${fileIndex.toString().padStart(2)}/${scenario.files.size}] ${fileName.padEnd(40)} ` +
          `${duration.toFixed(2).padStart(8)}ms  (${diagnostics.length} diags)`
        );
      } else if (fileIndex === 6) {
        console.log(`  ... (${scenario.files.size - 10} more files) ...`);
      }
    } catch (error) {
      console.log(
        `  [${fileIndex.toString().padStart(2)}/${scenario.files.size}] ${fileName.padEnd(40)} ` +
        `ERROR: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 统计分析
  console.log('\n' + '─'.repeat(70));
  console.log('📈 Statistics:');

  const coldTotal = coldStartSamples.reduce((a, b) => a + b, 0);
  const warmTotal = warmStartSamples.reduce((a, b) => a + b, 0);

  console.log(`\n  Cold Start:`);
  console.log(`    Total:       ${coldTotal.toFixed(2)}ms`);
  console.log(`    Average:     ${(coldTotal / coldStartSamples.length).toFixed(2)}ms`);
  console.log(`    p50 (median):${p50(coldStartSamples).toFixed(2)}ms`);
  console.log(`    p95:         ${p95(coldStartSamples).toFixed(2)}ms`);
  console.log(`    p99:         ${p99(coldStartSamples).toFixed(2)}ms`);

  console.log(`\n  Warm Start (Cached):`);
  console.log(`    Total:       ${warmTotal.toFixed(2)}ms`);
  console.log(`    Average:     ${(warmTotal / warmStartSamples.length).toFixed(2)}ms`);
  console.log(`    p50 (median):${p50(warmStartSamples).toFixed(2)}ms`);
  console.log(`    p95:         ${p95(warmStartSamples).toFixed(2)}ms`);
  console.log(`    p99:         ${p99(warmStartSamples).toFixed(2)}ms`);

  // 缓存分析
  const cacheHitCount = warmStartSamples.filter(t => t < 1).length;
  const cacheHitRate = (cacheHitCount / warmStartSamples.length) * 100;
  const speedup = coldTotal / (warmTotal || 1);

  console.log(`\n  Performance:`);
  console.log(`    Speedup:     ${speedup.toFixed(2)}x`);
  console.log(`    Cache hits:  ${cacheHitCount}/${warmStartSamples.length} (${cacheHitRate.toFixed(1)}%)`);

  // 与层 0 (纯处理) 对比
  console.log(`\n  📌 Note: This includes LSP diagnostics overhead (caching + format conversion)`);
  console.log(`     Compare with Layer 0 (profile-medium-project.ts) to see pure processing speed.`);
}

async function main(): Promise<void> {
  console.log('🚀 Layer 1: LSP Server Internal Latency Test');
  console.log('='.repeat(70));
  console.log('');
  console.log('Purpose: Measure LSP diagnostics layer overhead (with caching, without IPC)');
  console.log('Method:  Direct in-process calls to computeDiagnostics()');
  console.log('');

  const scenarios = [
    await prepareSmallScenario(),
    await prepareMediumScenario(),
    await prepareLargeScenario(),
  ];

  for (const scenario of scenarios) {
    await measureScenario(scenario);
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Layer 1 test completed');
  console.log('');
  console.log('Next steps:');
  console.log('  - Run Layer 2 (perf-lsp-ipc.ts) to measure IPC overhead');
  console.log('  - Run Layer 3 (perf-lsp-e2e-v2.ts) to measure end-to-end latency');
}

main().catch(error => {
  console.error('❌ Layer 1 test failed:', error);
  process.exit(1);
});
