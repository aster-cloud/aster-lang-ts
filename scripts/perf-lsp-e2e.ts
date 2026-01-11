#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { p50, p95, p99 } from './perf-utils.js';
import { generateMediumProject, generateLargeProgram } from '../test/generators.js';
import { LSPClient } from './lsp-client-helper.js';

type Position = { line: number; character: number };

type ProjectDefinition = {
  name: string;
  files: Map<string, string>;
  entryRelativePath: string;
  hoverPosition: Position;
  completionPosition: Position;
};

type ProjectMetrics = {
  files: number;
  lines: number;
  initialize_ms: number;
  hover: { p50: number; p95: number; p99: number };
  completion: { p50: number; p95: number; p99: number };
  diagnostics: { p50: number; p95: number; p99: number };
};

type DiagnosticsSampleOptions = {
  client: LSPClient;
  uri: string;
  text: string;
  iterations: number;
};

const REQUEST_TIMEOUT_MS = resolveTimeout(process.env.LSP_PERF_TIMEOUT_MS, 5_000);
const DIAGNOSTIC_TIMEOUT_MS = resolveTimeout(process.env.LSP_PERF_DIAG_TIMEOUT_MS, 30_000); // 提高默认超时到30秒以适应大型项目
const ITERATIONS = resolveIterationCount(process.env.LSP_PERF_ITERATIONS, 100);
const DIAGNOSTIC_ITERATIONS = resolveIterationCount(process.env.LSP_PERF_DIAG_ITERATIONS, 20);
const DEBUG = process.env.LSP_PERF_DEBUG === '1';
const SKIP_HOVER = process.env.LSP_PERF_SKIP_HOVER === '1'; // 在 CI 中跳过 hover 测试以避免超时

function resolveIterationCount(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveTimeout(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    node_version: process.version,
    projects: {},
  };

  const scenarios = await Promise.all([
    prepareSmallProject(),
    prepareMediumProject(),
    prepareLargeProject(),
  ]);

  for (const scenario of scenarios) {
    const metrics = await measureScenario(scenario);
    (report.projects as Record<string, ProjectMetrics>)[scenario.name] = metrics;
  }

  console.log(JSON.stringify(report, null, 2));
}

async function measureScenario(definition: ProjectDefinition): Promise<ProjectMetrics> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), `aster-perf-${definition.name}-`));
  const client = new LSPClient();

  try {
    await writeProjectFiles(workspaceRoot, definition.files);
    const entryPath = path.join(workspaceRoot, definition.entryRelativePath);
    const entryUri = pathToFileURL(entryPath).href;
    const entryText = definition.files.get(definition.entryRelativePath);
    if (entryText === undefined) {
      throw new Error(`找不到入口文件内容：${definition.entryRelativePath}`);
    }

    client.spawn('dist/src/lsp/server.js');

    const initializeStart = performance.now();
    await withTimeout(
      client.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(workspaceRoot).href,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['markdown', 'plaintext'] },
            completion: { completionItem: { snippetSupport: false } },
          },
        },
      }),
      REQUEST_TIMEOUT_MS,
      'initialize',
    );
    client.notify('initialized', {});
    const initializeMs = performance.now() - initializeStart;

    client.notify('textDocument/didOpen', {
      textDocument: {
        uri: entryUri,
        languageId: 'cnl',
        version: 1,
        text: entryText,
      },
    });

    const diagnosticsSamples = await collectDiagnosticsSamples({
      client,
      uri: entryUri,
      text: entryText,
      iterations: DIAGNOSTIC_ITERATIONS,
    });

    if (!SKIP_HOVER) {
      await warmupRequest(client, 'textDocument/hover', { textDocument: { uri: entryUri }, position: definition.hoverPosition });
    }
    await warmupRequest(client, 'textDocument/completion', {
      textDocument: { uri: entryUri },
      position: definition.completionPosition,
    });

    const hoverLatencies: number[] = [];
    if (!SKIP_HOVER) {
      for (let i = 0; i < ITERATIONS; i++) {
        const t0 = performance.now();
        try {
          await withTimeout(
            client.request('textDocument/hover', {
              textDocument: { uri: entryUri },
              position: definition.hoverPosition,
            }),
            REQUEST_TIMEOUT_MS,
            'textDocument/hover',
          );
          hoverLatencies.push(performance.now() - t0);
        } catch (err) {
          if (DEBUG) {
            console.warn(
              `[${definition.name}] hover 请求失败（迭代 ${i + 1}）:`,
              err instanceof Error ? err.message : err,
            );
          }
          hoverLatencies.push(REQUEST_TIMEOUT_MS);
        }
      }
    } else {
      // 跳过 hover 测试，输出占位符数据
      hoverLatencies.push(0);
    }

    const completionLatencies: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      try {
        await withTimeout(
          client.request('textDocument/completion', {
            textDocument: { uri: entryUri },
            position: definition.completionPosition,
          }),
          REQUEST_TIMEOUT_MS,
          'textDocument/completion',
        );
        completionLatencies.push(performance.now() - t0);
      } catch (err) {
        if (DEBUG) {
          console.warn(
            `[${definition.name}] completion 请求失败（迭代 ${i + 1}）:`,
            err instanceof Error ? err.message : err,
          );
        }
        completionLatencies.push(REQUEST_TIMEOUT_MS);
      }
    }

    try {
      await withTimeout(client.request('shutdown'), REQUEST_TIMEOUT_MS, 'shutdown');
    } catch {
      // 忽略关闭阶段超时，确保后续清理继续执行
    } finally {
      client.notify('exit');
    }

    return {
      files: definition.files.size,
      lines: countLines(definition.files),
      initialize_ms: initializeMs,
      hover: {
        p50: p50(hoverLatencies),
        p95: p95(hoverLatencies),
        p99: p99(hoverLatencies),
      },
      completion: {
        p50: p50(completionLatencies),
        p95: p95(completionLatencies),
        p99: p99(completionLatencies),
      },
      diagnostics: {
        p50: p50(diagnosticsSamples),
        p95: p95(diagnosticsSamples),
        p99: p99(diagnosticsSamples),
      },
    };
  } finally {
    client.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeProjectFiles(root: string, files: Map<string, string>): Promise<void> {
  for (const [relativePath, content] of files) {
    const absPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf8');
  }
}

async function collectDiagnosticsSamples(options: DiagnosticsSampleOptions): Promise<number[]> {
  const { client, uri, text, iterations } = options;
  const samples: number[] = [];
  let version = 1;

  // 初始诊断请求（使用 Pull Diagnostics）
  const initialStart = performance.now();
  try {
    await withTimeout(
      client.request('textDocument/diagnostic', {
        textDocument: { uri },
      }),
      DIAGNOSTIC_TIMEOUT_MS,
      'initial diagnostic request',
    );
    samples.push(performance.now() - initialStart);
  } catch {
    // 初始诊断失败则继续采样后续迭代
  }

  for (let i = 0; i < iterations; i++) {
    version += 1;
    client.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });

    // 主动请求诊断（Pull Diagnostics）
    const start = performance.now();
    try {
      await withTimeout(
        client.request('textDocument/diagnostic', {
          textDocument: { uri },
        }),
        DIAGNOSTIC_TIMEOUT_MS,
        'diagnostic request',
      );
      samples.push(performance.now() - start);
    } catch {
      // 超时样本忽略
    }
  }

  if (samples.length === 0) samples.push(0);
  return samples;
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
    entryRelativePath: 'examples/greet.aster',
    hoverPosition: locatePosition(text, 'user', 0, 'parameter'),
    completionPosition: locatePosition(text, 'Return ', 7),
  };
}

async function prepareMediumProject(): Promise<ProjectDefinition> {
  const modules = generateMediumProject(40, 42);
  const files = new Map<string, string>();
  for (const [moduleName, content] of modules) {
    const relPath = moduleName.split('.').join('/') + '.aster';
    files.set(relPath, content);
  }
  const entryModule = 'benchmark.medium.common';
  const entryPath = entryModule.split('.').join('/') + '.aster';
  const entryText = files.get(entryPath);
  if (!entryText) throw new Error('中型项目缺少入口模块 benchmark.medium.common');

  return {
    name: 'medium',
    files,
    entryRelativePath: entryPath,
    hoverPosition: locatePosition(entryText, 'prefix', 0, 'parameter'),
    completionPosition: locatePosition(entryText, 'Return base.', 7),
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
    entryRelativePath: relativePath,
    hoverPosition: locatePosition(content, 'user', 0, 'parameter'),
    completionPosition: locatePosition(content, 'Return Active.', 8),
  };
}

/**
 * 在文本中定位指定搜索词的位置
 * @param text 要搜索的文本
 * @param search 搜索词（函数名、参数名等）
 * @param offset 从搜索词开始位置的偏移量（可选）
 * @param context 上下文提示，用于更精确的匹配（可选，如 'parameter' 表示查找参数）
 */
function locatePosition(text: string, search: string, offset = 0, context?: 'parameter'): Position {
  let targetIndex: number;

  if (context === 'parameter') {
    // 参数查找：查找 "with paramName:" 或 "and paramName:" 模式
    const paramPattern = new RegExp(`\\b(with|and)\\s+(${search})\\s*:`, 'g');
    const match = paramPattern.exec(text);
    if (!match) throw new Error(`在文本中找不到参数：${search}`);
    // 定位到参数名的开始位置
    targetIndex = match.index + match[1]!.length + 1; // +1 for space after 'with'/'and'
  } else {
    // 普通查找：直接查找字符串
    const index = text.indexOf(search);
    if (index === -1) throw new Error(`在文本中找不到片段：${search}`);
    targetIndex = index + offset;
  }

  const untilTarget = text.slice(0, targetIndex);
  const line = untilTarget.split(/\r?\n/).length - 1;
  const lastLineBreak = untilTarget.lastIndexOf('\n');
  const character = targetIndex - (lastLineBreak + 1);
  return { line, character };
}

async function warmupRequest(client: LSPClient, method: string, params: Record<string, unknown>): Promise<void> {
  try {
    await withTimeout(client.request(method, params), REQUEST_TIMEOUT_MS * 4, `${method} (warmup)`);
  } catch (err) {
    if (DEBUG) {
      console.warn(
        `[warmup] ${method} 失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

main().catch(err => {
  console.error('perf-lsp-e2e 执行失败：', err);
  process.exit(1);
});
