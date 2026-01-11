#!/usr/bin/env node
/**
 * 诊断性能基准测试
 * 验证工作区诊断并行化带来的性能提升
 */

import { performance } from 'node:perf_hooks';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeDiagnostics } from '../src/lsp/diagnostics.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import type { Module as AstModule } from '../src/types.js';

function createMockGetOrParse(): (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: AstModule | null } {
  return (doc: TextDocument): { text: string; tokens: readonly any[]; ast: AstModule | null } => {
    const text = doc.getText();
    const can = canonicalize(text);
    const tokens = lex(can);
    let ast: AstModule | null = null;
    try {
      ast = parse(tokens) as AstModule;
    } catch {
      ast = null;
    }
    return { text: can, tokens, ast };
  };
}

async function measureDiagnosticsPerformance(): Promise<void> {
  const programsRoot = 'test/cnl/programs';
  function collectAsterFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectAsterFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.aster')) {
        out.push(full);
      }
    }
    return out;
  }
  const files = collectAsterFiles(programsRoot);

  console.log(`测试 ${files.length} 个文件的诊断性能...\n`);

  const getOrParse = createMockGetOrParse();
  const times: number[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const doc = TextDocument.create(`file:///${file}`, 'cnl', 1, content);

    const start = performance.now();
    await computeDiagnostics(doc, getOrParse);
    const elapsed = performance.now() - start;

    times.push(elapsed);
  }

  const total = times.reduce((a, b) => a + b, 0);
  const avg = total / times.length;
  const sorted = times.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

  console.log(`总时间: ${total.toFixed(2)}ms`);
  console.log(`平均每文件: ${avg.toFixed(2)}ms`);
  console.log(`P50: ${p50.toFixed(2)}ms`);
  console.log(`P95: ${p95.toFixed(2)}ms`);
  console.log(`\n✅ 诊断性能测试完成`);

  // 更新性能报告
  const report = {
    timestamp: new Date().toISOString(),
    diagnostics: {
      files: files.length,
      total_ms: Number(total.toFixed(2)),
      avg_ms: Number(avg.toFixed(2)),
      p50_ms: Number(p50.toFixed(2)),
      p95_ms: Number(p95.toFixed(2)),
    },
  };

  console.log('\n性能报告:');
  console.log(JSON.stringify(report, null, 2));
}

measureDiagnosticsPerformance().catch(error => {
  console.error('性能测试失败:', error);
  process.exit(1);
});
