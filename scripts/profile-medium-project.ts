#!/usr/bin/env node
/**
 * 性能分析：精确测量Medium项目各阶段耗时
 * 目的：找出导致基准测试超时的真正瓶颈
 */

import { performance } from 'node:perf_hooks';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import { lowerModule } from '../src/lower_to_core.js';
import { typecheckModule } from '../src/typecheck.js';
import { generateMediumProject } from '../test/generators.js';

interface PhaseStats {
  name: string;
  total: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  samples: number[];
}

function calculateStats(name: string, samples: number[]): PhaseStats {
  const total = samples.reduce((a, b) => a + b, 0);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name,
    total,
    avg: total / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    samples,
  };
}

function printStats(stats: PhaseStats): void {
  console.log(`\n📊 ${stats.name}`);
  console.log('─'.repeat(60));
  console.log(`  Total:       ${stats.total.toFixed(2)}ms`);
  console.log(`  Average:     ${stats.avg.toFixed(2)}ms`);
  console.log(`  p50 (median):${stats.p50.toFixed(2)}ms`);
  console.log(`  p95:         ${stats.p95.toFixed(2)}ms`);
  console.log(`  Min:         ${stats.min.toFixed(2)}ms`);
  console.log(`  Max:         ${stats.max.toFixed(2)}ms`);
}

async function main(): Promise<void> {
  console.log('🚀 Medium Project Performance Analysis');
  console.log('='.repeat(60));

  // 生成Medium项目 (40个模块)
  console.log('\n📦 Generating Medium project (40 modules)...');
  const genStart = performance.now();
  const modules = generateMediumProject(40, 42);
  const genTime = performance.now() - genStart;
  console.log(`✅ Generated in ${genTime.toFixed(2)}ms`);
  console.log(`   Modules: ${modules.size}`);

  // 统计各阶段耗时
  const canonicalizeTimings: number[] = [];
  const lexTimings: number[] = [];
  const parseTimings: number[] = [];
  const lowerTimings: number[] = [];
  const typecheckTimings: number[] = [];
  const totalTimings: number[] = [];

  console.log('\n🔬 Processing modules...');
  let moduleIndex = 0;

  for (const [moduleName, source] of modules.entries()) {
    moduleIndex++;
    const moduleStart = performance.now();

    try {
      // Phase 1: Canonicalize
      const canStart = performance.now();
      const canonicalized = canonicalize(source);
      canonicalizeTimings.push(performance.now() - canStart);

      // Phase 2: Lex
      const lexStart = performance.now();
      const tokens = lex(canonicalized);
      lexTimings.push(performance.now() - lexStart);

      // Phase 3: Parse
      const parseStart = performance.now();
      const { ast } = parse(tokens);
      parseTimings.push(performance.now() - parseStart);

      // Phase 4: Lower to Core IR
      const lowerStart = performance.now();
      const core = lowerModule(ast);
      lowerTimings.push(performance.now() - lowerStart);

      // Phase 5: Typecheck
      const typecheckStart = performance.now();
      const diags = typecheckModule(core);
      typecheckTimings.push(performance.now() - typecheckStart);

      const moduleDuration = performance.now() - moduleStart;
      totalTimings.push(moduleDuration);

      if (moduleIndex <= 5 || moduleIndex % 10 === 0 || moduleIndex === modules.size) {
        console.log(
          `  [${moduleIndex.toString().padStart(2)}/${modules.size}] ${moduleName.padEnd(35)} ` +
          `${moduleDuration.toFixed(2).padStart(8)}ms  (${diags.length} diags)`
        );
      }
    } catch (error) {
      console.log(
        `  [${moduleIndex.toString().padStart(2)}/${modules.size}] ${moduleName.padEnd(35)} ` +
        `ERROR: ${error instanceof Error ? error.message : String(error)}`
      );
      // 仍然记录部分完成的阶段
      totalTimings.push(performance.now() - moduleStart);
    }
  }

  // 打印各阶段统计
  console.log('\n' + '='.repeat(60));
  console.log('📈 PHASE-BY-PHASE BREAKDOWN');
  console.log('='.repeat(60));

  const canonStats = calculateStats('Phase 1: Canonicalize', canonicalizeTimings);
  const lexStats = calculateStats('Phase 2: Lex', lexTimings);
  const parseStats = calculateStats('Phase 3: Parse', parseTimings);
  const lowerStats = calculateStats('Phase 4: Lower to Core', lowerTimings);
  const typecheckStats = calculateStats('Phase 5: Typecheck', typecheckTimings);
  const totalStats = calculateStats('Total (all phases)', totalTimings);

  printStats(canonStats);
  printStats(lexStats);
  printStats(parseStats);
  printStats(lowerStats);
  printStats(typecheckStats);
  printStats(totalStats);

  // 瓶颈分析
  console.log('\n' + '='.repeat(60));
  console.log('🎯 BOTTLENECK ANALYSIS');
  console.log('='.repeat(60));

  const phases = [
    { name: 'Canonicalize', total: canonStats.total, percent: 0 },
    { name: 'Lex', total: lexStats.total, percent: 0 },
    { name: 'Parse', total: parseStats.total, percent: 0 },
    { name: 'Lower', total: lowerStats.total, percent: 0 },
    { name: 'Typecheck', total: typecheckStats.total, percent: 0 },
  ];

  const grandTotal = phases.reduce((sum, p) => sum + p.total, 0);
  for (const phase of phases) {
    phase.percent = (phase.total / grandTotal) * 100;
  }

  phases.sort((a, b) => b.total - a.total);

  console.log('\nTime distribution by phase:');
  for (const phase of phases) {
    const bar = '█'.repeat(Math.floor(phase.percent / 2));
    console.log(
      `  ${phase.name.padEnd(15)} ${phase.total.toFixed(2).padStart(8)}ms  ` +
      `${phase.percent.toFixed(1).padStart(5)}%  ${bar}`
    );
  }

  console.log(`\n🏁 Grand Total: ${grandTotal.toFixed(2)}ms for ${modules.size} modules`);
  console.log(`   Average per module: ${(grandTotal / modules.size).toFixed(2)}ms`);

  // 与超时阈值对比
  const TIMEOUT_MS = 30000;
  if (grandTotal > TIMEOUT_MS) {
    console.log(`\n⚠️  WARNING: Total time (${grandTotal.toFixed(2)}ms) exceeds timeout (${TIMEOUT_MS}ms)`);
  } else {
    console.log(`\n✅ Total time (${grandTotal.toFixed(2)}ms) is within timeout (${TIMEOUT_MS}ms)`);
  }

  // 识别最大瓶颈
  console.log(`\n🔴 PRIMARY BOTTLENECK: ${phases[0]!.name} (${phases[0]!.percent.toFixed(1)}% of total time)`);
  if (phases[0]!.percent > 40) {
    console.log(`   This phase accounts for more than 40% of total time - optimization target!`);
  }
}

main().catch(error => {
  console.error('❌ Performance analysis failed:', error);
  process.exit(1);
});
