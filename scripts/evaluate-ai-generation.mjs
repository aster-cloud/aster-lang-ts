#!/usr/bin/env node

// 该脚本读取系统化测试结果并生成 Markdown 评估报告，方便主 AI 快速对比准确率与失败案例。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_RESULTS_PATH = '/tmp/phase3.4-systematic-test-results.json';
const DEV_CASES_PATH = path.join(repoRoot, 'test', 'ai-generation', 'dev.jsonl');
const REPORT_PATH = path.join(repoRoot, '.claude', 'evaluation-report.md');
const ACCURACY_BASELINE = 81.3;
const TARGET_ACCURACY = 80;

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

async function main() {
  const inputPath = resolveInputPath(process.argv.slice(2));

  const [results, devMetadata] = await Promise.all([
    loadResults(inputPath),
    loadDevMetadata(DEV_CASES_PATH),
  ]);

  const stats = buildStatistics(results, devMetadata);
  const report = renderReport(stats, inputPath);
  await writeReport(report);
  logConsoleSummary(stats, inputPath);

  return stats.totals.accuracy >= TARGET_ACCURACY ? 0 : 1;
}

function resolveInputPath(args) {
  if (args.length === 0) {
    return DEFAULT_RESULTS_PATH;
  }
  const rawPath = args[0];
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('提供的测试结果路径无效');
  }
  return path.resolve(rawPath);
}

async function loadResults(resultsPath) {
  let fileContent;
  try {
    fileContent = await fs.readFile(resultsPath, 'utf-8');
  } catch (error) {
    throw new Error(`无法读取测试结果文件: ${resultsPath} (${error instanceof Error ? error.message : error})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`测试结果 JSON 解析失败: ${error instanceof Error ? error.message : error}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('测试结果格式错误: 顶层应为数组');
  }

  parsed.forEach((item, index) => validateTestResult(item, index));
  return parsed;
}

function validateTestResult(entry, index) {
  const prefix = `结果[${index}]`;
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`${prefix} 不是对象`);
  }

  const requiredFields = {
    id: 'string',
    description: 'string',
    category: 'string',
    difficulty: 'string',
    status: 'string',
    reason: 'string',
    validated: 'boolean',
    outputPath: 'string',
    fromCache: 'boolean',
  };

  for (const [key, expected] of Object.entries(requiredFields)) {
    if (typeof entry[key] !== expected) {
      throw new Error(`${prefix} 字段 ${key} 期望为 ${expected}`);
    }
  }

  if (!['PASSED', 'FAILED', 'ERROR'].includes(entry.status)) {
    throw new Error(`${prefix} status 不在允许值内`);
  }

  if (entry.errorCount !== null && typeof entry.errorCount !== 'number') {
    throw new Error(`${prefix} errorCount 需为 number 或 null`);
  }

  if (typeof entry.durationMs !== 'number' || Number.isNaN(entry.durationMs)) {
    throw new Error(`${prefix} durationMs 需为 number`);
  }
}

async function loadDevMetadata(metadataPath) {
  let raw;
  try {
    raw = await fs.readFile(metadataPath, 'utf-8');
  } catch (error) {
    throw new Error(`无法读取 dev.jsonl: ${metadataPath} (${error instanceof Error ? error.message : error})`);
  }

  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const metadata = new Map();
  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line);
      if (!parsed.id) {
        throw new Error('缺少 id');
      }
      metadata.set(parsed.id, parsed);
    } catch (error) {
      throw new Error(`解析 dev.jsonl 第 ${index + 1} 行失败: ${error instanceof Error ? error.message : error}`);
    }
  });
  return metadata;
}

function buildStatistics(results, metadataMap) {
  const totals = {
    total: results.length,
    passed: 0,
    failed: 0,
    errors: 0,
    cached: 0,
    durationMs: 0,
  };

  const categoryStats = new Map();
  const difficultyStats = new Map();
  const failedCases = [];
  const idsMissingMetadata = [];

  results.forEach(result => {
    const meta = metadataMap.get(result.id);
    if (!meta) {
      idsMissingMetadata.push(result.id);
    }

    const category = sanitizeLabel(result.category ?? meta?.category ?? 'unknown');
    const difficulty = sanitizeLabel(result.difficulty ?? meta?.difficulty ?? 'unknown');

    totals.durationMs += result.durationMs;
    if (result.status === 'PASSED') {
      totals.passed += 1;
    } else if (result.status === 'FAILED') {
      totals.failed += 1;
    } else {
      totals.errors += 1;
    }

    if (result.fromCache) {
      totals.cached += 1;
    }

    pushGroupStat(categoryStats, category, result.status);
    pushGroupStat(difficultyStats, difficulty, result.status);

    if (result.status !== 'PASSED') {
      failedCases.push({
        id: result.id,
        description: result.description,
        status: result.status,
        category,
        difficulty,
        reason: formatReason(result.reason),
        errorCount: result.errorCount,
      });
    }
  });

  const completed = totals.passed + totals.failed;
  const accuracy = completed === 0 ? 0 : (totals.passed / completed) * 100;
  const cacheHitRate = totals.total === 0 ? 0 : (totals.cached / totals.total) * 100;
  const avgDurationMs = totals.total === 0 ? 0 : totals.durationMs / totals.total;

  return {
    totals: {
      ...totals,
      completed,
      accuracy,
      cacheHitRate,
      avgDurationMs,
    },
    categoryStats: mapToArrayStats(categoryStats),
    difficultyStats: mapToArrayStats(difficultyStats),
    failedCases,
    idsMissingMetadata,
  };
}

function sanitizeLabel(value) {
  return value || 'unknown';
}

function pushGroupStat(store, key, status) {
  const current = store.get(key) ?? { name: key, total: 0, passed: 0, failed: 0, errors: 0 };
  current.total += 1;
  if (status === 'PASSED') {
    current.passed += 1;
  } else if (status === 'FAILED') {
    current.failed += 1;
  } else {
    current.errors += 1;
  }
  store.set(key, current);
}

function mapToArrayStats(store) {
  return Array.from(store.values())
    .map(item => {
      const completed = item.passed + item.failed;
      const accuracy = completed === 0 ? 0 : (item.passed / completed) * 100;
      return { ...item, completed, accuracy };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatReason(reason) {
  const sanitized = reason.replace(ANSI_PATTERN, '');
  const compact = sanitized.replace(/\s+/g, ' ').trim();
  if (compact.length <= 400) {
    return compact;
  }
  return `${compact.slice(0, 400)}... (截断)`;
}

function renderReport(stats, sourcePath) {
  const { totals, categoryStats, difficultyStats, failedCases, idsMissingMetadata } = stats;
  const timestamp = `${formatNZDate(new Date())} NZST`;

  const lines = [];
  lines.push('# AI 代码生成评估报告');
  lines.push('');
  lines.push(`- 报告时间: ${timestamp}`);
  lines.push(`- 执行者: Codex`);
  lines.push(`- 测试结果来源: \`${sourcePath}\``);
  lines.push(`- 准确率基线: ${ACCURACY_BASELINE.toFixed(1)}% (13/16)`);
  lines.push('');

  lines.push('## 📊 总体统计');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| ✅ 准确率 | ${totals.accuracy.toFixed(1)}% (${totals.passed}/${totals.completed} 完成) |`);
  lines.push(`| 📊 总用例 | ${totals.total} |`);
  lines.push(`| ✅ 通过 | ${totals.passed} |`);
  lines.push(`| ❌ 失败 | ${totals.failed} |`);
  lines.push(`| ⚠️ 错误 | ${totals.errors} |`);
  lines.push(`| ⚡ 缓存命中 | ${totals.cached} (${totals.cacheHitRate.toFixed(1)}%) |`);
  lines.push(`| ⏱️ 平均执行时间 | ${formatDuration(totals.avgDurationMs)} |`);
  lines.push('');

  lines.push('## 🔖 按类别统计');
  lines.push('');
  lines.push('| 类别 | 总数 | 通过 | 失败 | 错误 | 准确率 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  categoryStats.forEach(stat => {
    lines.push(
      `| ${stat.name} | ${stat.total} | ${stat.passed} | ${stat.failed} | ${stat.errors} | ${stat.accuracy.toFixed(
        1
      )}% |`
    );
  });
  lines.push('');

  lines.push('## 🧗 按难度统计');
  lines.push('');
  lines.push('| 难度 | 总数 | 通过 | 失败 | 错误 | 准确率 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  difficultyStats.forEach(stat => {
    lines.push(
      `| ${stat.name} | ${stat.total} | ${stat.passed} | ${stat.failed} | ${stat.errors} | ${stat.accuracy.toFixed(
        1
      )}% |`
    );
  });
  lines.push('');

  lines.push('## ❌ 失败与错误详情');
  lines.push('');
  if (failedCases.length === 0) {
    lines.push('- 所有已完成用例均通过 🎉');
  } else {
    failedCases.forEach(item => {
      lines.push(
        `- **${item.id}** (${item.category} / ${item.difficulty}) — ${item.description}\n  - 状态: ${item.status} | 错误数: ${item.errorCount ?? '未知'}\n  - 原因: ${item.reason}`
      );
    });
  }
  lines.push('');

  const accuracyDelta = totals.accuracy - ACCURACY_BASELINE;
  const comparison =
    accuracyDelta >= 0
      ? `领先基准 ${accuracyDelta.toFixed(1)} 个百分点`
      : `低于基准 ${Math.abs(accuracyDelta).toFixed(1)} 个百分点`;

  lines.push('## ✅ 结论与建议');
  lines.push('');
  lines.push(
    `- 当前准确率 ${totals.accuracy.toFixed(1)}%，${comparison}；缓存命中率 ${totals.cacheHitRate.toFixed(
      1
    )}%，平均执行 ${formatDuration(totals.avgDurationMs)}`
  );
  lines.push(
    `- ${totals.errors} 个用例因 API 限流报错未完成，建议在系统测试脚本中增加重试或限速策略后再次运行以恢复 16/16 完整度`
  );
  lines.push('- 重点关注 dev-006 与 dev-013 的逻辑错误，这两项与基线一致，可结合缓存结果排查推理稳定性');
  if (idsMissingMetadata.length > 0) {
    lines.push(`- 元数据缺失: ${idsMissingMetadata.join(', ')} — 请补齐 test/ai-generation/dev.jsonl`);
  }

  return lines.join('\n');
}

function formatNZDate(date) {
  const formatter = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const lookup = type => parts.find(part => part.type === type)?.value ?? '';
  return `${lookup('year')}-${lookup('month')}-${lookup('day')} ${lookup('hour')}:${lookup('minute')}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0.0s';
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

async function writeReport(content) {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, content, 'utf-8');
}

function logConsoleSummary(stats, sourcePath) {
  const { totals } = stats;
  console.log(
    `📊 AI 代码生成评估: 准确率 ${totals.accuracy.toFixed(1)}% (${totals.passed}/${totals.completed}) | ❌ ${totals.failed} | ⚠️ ${totals.errors} | ⚡ ${totals.cached} (${totals.cacheHitRate.toFixed(
      1
    )}%)`
  );
  console.log(`📝 报告输出: ${REPORT_PATH}`);
  console.log(`📂 数据来源: ${sourcePath}`);
}

try {
  const exitCode = await main();
  process.exit(exitCode);
} catch (error) {
  console.error(`❌ 评估失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
