#!/usr/bin/env node
import fs from 'node:fs';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import { lowerModule } from '../src/lower_to_core.js';
import { generateLargeProgram } from './generators.js';

function benchmark<T>(name: string, fn: () => T, iterations = 1000): { result: T; avgMs: number; opsPerSec: number } {
  // Warm up
  for (let i = 0; i < 10; i++) {
    fn();
  }
  
  const start = process.hrtime.bigint();
  let result: T;
  for (let i = 0; i < iterations; i++) {
    result = fn();
  }
  const end = process.hrtime.bigint();
  
  const totalMs = Number(end - start) / 1_000_000;
  const avgMs = totalMs / iterations;
  const opsPerSec = 1000 / avgMs;
  
  console.log(`${name}: ${avgMs.toFixed(3)}ms avg, ${opsPerSec.toFixed(0)} ops/sec`);
  
  return { result: result!, avgMs, opsPerSec };
}

function main(): void {
  console.log('Running performance benchmarks...\n');
  
  // Load test files
  const greetProgram = fs.readFileSync('test/cnl/programs/examples/greet.aster', 'utf8');
  const loginProgram = fs.readFileSync('test/cnl/programs/examples/login.aster', 'utf8');
  const largeProgram = generateLargeProgram(50); // 50 functions
  
  console.log('=== Small Programs ===');
  
  // Benchmark canonicalizer
  benchmark('Canonicalize (greet)', () => canonicalize(greetProgram), 5000);
  benchmark('Canonicalize (login)', () => canonicalize(loginProgram), 5000);
  
  // Benchmark lexer
  const greetCan = canonicalize(greetProgram);
  const loginCan = canonicalize(loginProgram);
  
  benchmark('Lex (greet)', () => lex(greetCan), 3000);
  benchmark('Lex (login)', () => lex(loginCan), 3000);
  
  // Benchmark parser
  const greetTokens = lex(greetCan);
  const loginTokens = lex(loginCan);
  
  benchmark('Parse (greet)', () => parse(greetTokens), 2000);
  benchmark('Parse (login)', () => parse(loginTokens), 2000);
  
  // Benchmark lowering
  const greetAst = parse(greetTokens);
  const loginAst = parse(loginTokens);
  
  benchmark('Lower (greet)', () => lowerModule(greetAst), 3000);
  benchmark('Lower (login)', () => lowerModule(loginAst), 3000);
  
  // Full pipeline benchmarks
  benchmark('Full pipeline (greet)', () => {
    const can = canonicalize(greetProgram);
    const tokens = lex(can);
    const ast = parse(tokens);
    return lowerModule(ast);
  }, 1000);
  
  benchmark('Full pipeline (login)', () => {
    const can = canonicalize(loginProgram);
    const tokens = lex(can);
    const ast = parse(tokens);
    return lowerModule(ast);
  }, 1000);
  
  console.log('\n=== Large Program (50 functions) ===');
  
  const largeCan = canonicalize(largeProgram);
  const largeTokens = lex(largeCan);
  const largeAst = parse(largeTokens);
  
  console.log(`Program size: ${largeProgram.length} chars, ${largeTokens.length} tokens`);
  
  benchmark('Canonicalize (large)', () => canonicalize(largeProgram), 100);
  benchmark('Lex (large)', () => lex(largeCan), 100);
  benchmark('Parse (large)', () => parse(largeTokens), 50);
  benchmark('Lower (large)', () => lowerModule(largeAst), 100);
  
  benchmark('Full pipeline (large)', () => {
    const can = canonicalize(largeProgram);
    const tokens = lex(can);
    const ast = parse(tokens);
    return lowerModule(ast);
  }, 20);
  
  console.log('\n=== Memory Usage ===');
  
  const memBefore = process.memoryUsage();
  
  // Process large program multiple times
  for (let i = 0; i < 100; i++) {
    const can = canonicalize(largeProgram);
    const tokens = lex(can);
    const ast = parse(tokens);
    lowerModule(ast);
  }
  
  const memAfter = process.memoryUsage();
  
  console.log(`Heap used: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap total: ${((memAfter.heapTotal - memBefore.heapTotal) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RSS: ${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(2)} MB`);
  
  // Performance thresholds (fail if too slow)
  const greetPipelineResult = benchmark('Performance check (greet)', () => {
    const can = canonicalize(greetProgram);
    const tokens = lex(can);
    const ast = parse(tokens);
    return lowerModule(ast);
  }, 100);
  
  if (greetPipelineResult.avgMs > 5.0) {
    console.error(`❌ Performance regression: greet pipeline took ${greetPipelineResult.avgMs.toFixed(3)}ms (threshold: 5.0ms)`);
    process.exit(1);
  }
  
  console.log('\n✅ All benchmarks completed successfully!');
  console.log(`Greet pipeline: ${greetPipelineResult.opsPerSec.toFixed(0)} ops/sec (${greetPipelineResult.avgMs.toFixed(3)}ms avg)`);
}

main();
