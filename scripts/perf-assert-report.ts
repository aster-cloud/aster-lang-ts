#!/usr/bin/env node

/**
 * 性能报告验证脚本
 * 读取 perf-report.json 并检查 passed 字段
 * 用于 CI 中确保性能回归检测生效
 */

import fs from 'node:fs/promises';
import path from 'node:path';

type PerfReport = {
  timestamp: string;
  passed: boolean;
  failures: string[];
};

const REPORT_PATH = path.resolve('perf-report.json');

async function main(): Promise<void> {
  let report: PerfReport;

  try {
    const content = await fs.readFile(REPORT_PATH, 'utf8');
    report = JSON.parse(content) as PerfReport;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`❌ 找不到性能报告文件：${REPORT_PATH}`);
      console.error('请先运行 npm run perf:benchmark 生成报告');
      process.exit(2);
    }
    console.error(`❌ 读取性能报告失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  if (report.passed) {
    console.log('✅ 性能基准测试通过');
    process.exit(0);
  }

  console.error('\n❌ 性能基准测试失败\n');
  console.error('检测到以下性能回归或阈值超标：\n');

  if (report.failures && report.failures.length > 0) {
    for (const failure of report.failures) {
      console.error(`  • ${failure}`);
    }
  } else {
    console.error('  未找到失败详情（perf-report.json 格式异常）');
  }

  console.error(`\n详情见：${REPORT_PATH}`);
  console.error(`报告时间：${report.timestamp}`);

  process.exit(1);
}

main();
