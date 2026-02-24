#!/usr/bin/env node

/**
 * 综合性能基准脚本
 * - 测量编译阶段（canonicalize/lex/parse/lower/pipeline）延迟
 * - 复用 LSP 端到端性能脚本收集小/中/大型项目指标
 * - 输出结构化 JSON 报告并进行阈值与回归检测
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import { lowerModule } from '../src/lower_to_core.js';
import { p50, p95, p99 } from './perf-utils.js';
import { generateMediumProject, generateLargeProgram } from '../test/generators.js';

type PercentileStats = { p50: number; p95: number; p99: number };

type CompilationScenario = {
  files: number;
  lines: number;
  canonicalize_ms: PercentileStats;
  lex_ms: PercentileStats;
  parse_ms: PercentileStats;
  lower_ms: PercentileStats;
  pipeline_ms: PercentileStats;
};

type CompilationReport = {
  small: CompilationScenario;
  medium: CompilationScenario;
  large: CompilationScenario;
};

type LSPMetricGroup = {
  files: number;
  lines: number;
  initialize_ms: number;
  hover: PercentileStats;
  completion: PercentileStats;
  diagnostics: PercentileStats;
};

type LSPBenchmarkReport = {
  timestamp: string;
  node_version: string;
  projects: Record<string, LSPMetricGroup>;
};

type Thresholds = {
  parse_p50_ms: number;
  greet_pipeline_ms: number;
  lsp_hover_p95_ms: number;
  lsp_completion_p95_ms: number;
};

type PerfReport = {
  timestamp: string;
  metadata: {
    node_version: string;
    platform: NodeJS.Platform;
    arch: string;
    cpus: number;
    total_memory_gb: number;
  };
  compilation: CompilationReport;
  lsp: Record<string, LSPMetricGroup>;
  thresholds: Thresholds;
  passed: boolean;
  failures: string[];
};

const SMALL_ITERATIONS = resolveIteration(process.env.COMPILATION_SMALL_ITERATIONS, 100);
const MEDIUM_ITERATIONS = resolveIteration(process.env.COMPILATION_MEDIUM_ITERATIONS, 12);
const LARGE_ITERATIONS = resolveIteration(process.env.COMPILATION_LARGE_ITERATIONS, 40);
const BASELINE_MARGIN = resolveNumber(process.env.PERF_BASELINE_MARGIN, 0.15);
const REGRESSION_TOLERANCE = resolveNumber(process.env.PERF_REGRESSION_TOLERANCE, 0.2);
const REPORT_PATH = path.resolve('perf-report.json');

async function main(): Promise<void> {
  console.error('[perf-benchmark] 开始性能基准测试...');

  const [smallProject, mediumProject, largeProject] = await prepareProjects();

  console.error('[perf-benchmark] 收集编译阶段性能数据...');
  const compilation = {
    small: measureCompilationProject(smallProject, SMALL_ITERATIONS),
    medium: measureCompilationProject(mediumProject, MEDIUM_ITERATIONS),
    large: measureCompilationProject(largeProject, LARGE_ITERATIONS),
  };

  console.error('[perf-benchmark] 调用 LSP 端到端性能脚本...');
  const lspReport = await runLSPBenchmark();
  const lspProjects = lspReport.projects;

  const baseline = await loadBaseline(REPORT_PATH);
  const thresholds = buildThresholds(baseline);

  const failures: string[] = [];
  failures.push(...checkThresholds(compilation, lspProjects, thresholds));
  if (baseline) {
    failures.push(...detectRegressions(compilation, lspProjects, baseline, REGRESSION_TOLERANCE));
  }

  const passed = failures.length === 0;
  const report: PerfReport = {
    timestamp: new Date().toISOString(),
    metadata: collectMetadata(),
    compilation,
    lsp: lspProjects,
    thresholds,
    passed,
    failures,
  };

  const reportJson = JSON.stringify(report, null, 2);
  await fs.writeFile(REPORT_PATH, reportJson, 'utf8');
  process.stdout.write(`${reportJson}\n`);

  if (!passed) {
    console.error('[perf-benchmark] ❌ 性能基准测试未通过，详情见 perf-report.json。');
    process.exit(1);
  }

  console.error('[perf-benchmark] ✅ 性能基准测试通过。');
}

async function prepareProjects(): Promise<
  [Map<string, string>, Map<string, string>, Map<string, string>]
> {
  const smallText = await fs.readFile('test/cnl/programs/examples/greet.aster', 'utf8');
  const smallProject = new Map<string, string>([['examples/greet.aster', smallText]]);

  const mediumProject = generateMediumProject(40, 42);

  const largeProgram = generateLargeProgram(50);
  const largeProject = new Map<string, string>([['benchmark/test.aster', largeProgram]]);

  return [smallProject, mediumProject, largeProject];
}

function measureCompilationProject(project: Map<string, string>, iterations: number): CompilationScenario {
  if (iterations <= 0) {
    throw new Error(`测量迭代次数无效：${iterations}`);
  }

  const canonicalizeSamples: number[] = [];
  const lexSamples: number[] = [];
  const parseSamples: number[] = [];
  const lowerSamples: number[] = [];
  const pipelineSamples: number[] = [];

  const contents = Array.from(project.values());
  const fileCount = project.size;
  const lineCount = countProjectLines(project);

  for (let i = 0; i < iterations; i++) {
    const pipelineStart = performance.now();

    let stageStart = performance.now();
    const canonicalized: string[] = new Array(contents.length);
    for (let idx = 0; idx < contents.length; idx++) {
      canonicalized[idx] = canonicalize(contents[idx]!);
    }
    canonicalizeSamples.push(performance.now() - stageStart);

    stageStart = performance.now();
    const tokenSets = canonicalized.map(text => lex(text));
    lexSamples.push(performance.now() - stageStart);

    stageStart = performance.now();
    const asts = tokenSets.map(tokens => parse(tokens).ast);
    parseSamples.push(performance.now() - stageStart);

    stageStart = performance.now();
    for (const ast of asts) {
      lowerModule(ast);
    }
    lowerSamples.push(performance.now() - stageStart);

    pipelineSamples.push(performance.now() - pipelineStart);
  }

  return {
    files: fileCount,
    lines: lineCount,
    canonicalize_ms: buildStats(canonicalizeSamples),
    lex_ms: buildStats(lexSamples),
    parse_ms: buildStats(parseSamples),
    lower_ms: buildStats(lowerSamples),
    pipeline_ms: buildStats(pipelineSamples),
  };
}

async function runLSPBenchmark(): Promise<LSPBenchmarkReport> {
  return new Promise<LSPBenchmarkReport>((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/scripts/perf-lsp-e2e.js'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        LSP_PERF_ITERATIONS: process.env.LSP_PERF_ITERATIONS ?? '10',
        LSP_PERF_DIAG_ITERATIONS: process.env.LSP_PERF_DIAG_ITERATIONS ?? '5',
      },
    });

    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });

    child.on('error', err => {
      reject(new Error(`启动 LSP 基准脚本失败：${err instanceof Error ? err.message : String(err)}`));
    });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`LSP 基准脚本退出码 ${code ?? -1}`));
        return;
      }

      try {
        const parsed = JSON.parse(output) as LSPBenchmarkReport;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`解析 LSP 基准输出失败：${err instanceof Error ? err.message : String(err)}`));
      }
    });
  });
}

async function loadBaseline(filePath: string): Promise<PerfReport | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text) as PerfReport;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('[perf-benchmark] 未找到历史性能报告，跳过回归对比。');
      return null;
    }
    console.error(
      `[perf-benchmark] 读取历史性能报告失败，将跳过回归对比：${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function buildThresholds(baseline: PerfReport | null): Thresholds {
  const defaults: Thresholds = {
    parse_p50_ms: resolveNumber(process.env.PERF_THRESHOLD_PARSE_P50_MS, 30),
    greet_pipeline_ms: resolveNumber(process.env.PERF_THRESHOLD_PIPELINE_P50_MS, 5),
    lsp_hover_p95_ms: resolveNumber(process.env.PERF_THRESHOLD_LSP_HOVER_P95_MS, 100),
    lsp_completion_p95_ms: resolveNumber(process.env.PERF_THRESHOLD_LSP_COMPLETION_P95_MS, 150),
  };

  if (baseline?.compilation?.small?.parse_ms?.p50) {
    defaults.parse_p50_ms = Math.max(
      defaults.parse_p50_ms,
      baseline.compilation.small.parse_ms.p50 * (1 + BASELINE_MARGIN),
    );
  }

  if (baseline?.compilation?.small?.pipeline_ms?.p50) {
    defaults.greet_pipeline_ms = Math.max(
      defaults.greet_pipeline_ms,
      baseline.compilation.small.pipeline_ms.p50 * (1 + BASELINE_MARGIN),
    );
  }

  const baselineHover = baseline?.lsp?.small?.hover?.p95;
  if (baselineHover !== undefined) {
    defaults.lsp_hover_p95_ms = Math.max(defaults.lsp_hover_p95_ms, baselineHover * (1 + BASELINE_MARGIN));
  }

  const baselineCompletion = baseline?.lsp?.small?.completion?.p95;
  if (baselineCompletion !== undefined) {
    defaults.lsp_completion_p95_ms = Math.max(
      defaults.lsp_completion_p95_ms,
      baselineCompletion * (1 + BASELINE_MARGIN),
    );
  }

  return defaults;
}

function checkThresholds(
  compilation: CompilationReport,
  lspProjects: Record<string, LSPMetricGroup>,
  thresholds: Thresholds,
): string[] {
  const failures: string[] = [];

  if (compilation.small.parse_ms.p50 > thresholds.parse_p50_ms) {
    failures.push(
      `Small parse p50 ${compilation.small.parse_ms.p50.toFixed(2)}ms 超过阈值 ${thresholds.parse_p50_ms.toFixed(2)}ms`,
    );
  }

  if (compilation.small.pipeline_ms.p50 > thresholds.greet_pipeline_ms) {
    failures.push(
      `Small pipeline p50 ${compilation.small.pipeline_ms.p50.toFixed(2)}ms 超过阈值 ${thresholds.greet_pipeline_ms.toFixed(2)}ms`,
    );
  }

  const smallLsp = lspProjects.small;
  if (smallLsp && smallLsp.hover.p95 > thresholds.lsp_hover_p95_ms) {
    failures.push(
      `Small LSP hover p95 ${smallLsp.hover.p95.toFixed(2)}ms 超过阈值 ${thresholds.lsp_hover_p95_ms.toFixed(2)}ms`,
    );
  }

  if (smallLsp && smallLsp.completion.p95 > thresholds.lsp_completion_p95_ms) {
    failures.push(
      `Small LSP completion p95 ${smallLsp.completion.p95.toFixed(2)}ms 超过阈值 ${thresholds.lsp_completion_p95_ms.toFixed(
        2,
      )}ms`,
    );
  }

  return failures;
}

function detectRegressions(
  currentCompilation: CompilationReport,
  currentLsp: Record<string, LSPMetricGroup>,
  baseline: PerfReport,
  tolerance: number,
): string[] {
  const issues: string[] = [];

  const compare = (label: string, currentValue?: number, baselineValue?: number): void => {
    if (currentValue === undefined || baselineValue === undefined) return;
    const limit = baselineValue * (1 + tolerance);
    if (currentValue > limit) {
      issues.push(
        `${label} 从 ${baselineValue.toFixed(2)}ms 上升到 ${currentValue.toFixed(2)}ms（允许上限 ${limit.toFixed(2)}ms）`,
      );
    }
  };

  compare(
    'Small parse p50',
    currentCompilation.small.parse_ms.p50,
    baseline.compilation?.small?.parse_ms?.p50,
  );
  compare(
    'Small pipeline p50',
    currentCompilation.small.pipeline_ms.p50,
    baseline.compilation?.small?.pipeline_ms?.p50,
  );
  compare(
    'Medium parse p50',
    currentCompilation.medium.parse_ms.p50,
    baseline.compilation?.medium?.parse_ms?.p50,
  );
  compare(
    'Large parse p50',
    currentCompilation.large.parse_ms.p50,
    baseline.compilation?.large?.parse_ms?.p50,
  );

  compare('Small hover p95', currentLsp.small?.hover.p95, baseline.lsp?.small?.hover?.p95);
  compare('Small completion p95', currentLsp.small?.completion.p95, baseline.lsp?.small?.completion?.p95);
  compare('Medium hover p95', currentLsp.medium?.hover.p95, baseline.lsp?.medium?.hover?.p95);
  compare('Medium completion p95', currentLsp.medium?.completion.p95, baseline.lsp?.medium?.completion?.p95);

  return issues;
}

function collectMetadata(): PerfReport['metadata'] {
  return {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    total_memory_gb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
  };
}

function buildStats(samples: number[]): PercentileStats {
  return {
    p50: roundMs(p50(samples)),
    p95: roundMs(p95(samples)),
    p99: roundMs(p99(samples)),
  };
}

function countProjectLines(project: Map<string, string>): number {
  let total = 0;
  for (const text of project.values()) {
    if (text.length === 0) {
      total += 1;
      continue;
    }
    total += text.split(/\r?\n/).length;
  }
  return total;
}

function resolveIteration(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function roundMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(3));
}

void main().catch(err => {
  console.error(`[perf-benchmark] 发生未捕获异常：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
