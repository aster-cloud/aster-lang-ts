#!/usr/bin/env node
/**
 * 使用说明：
 * 1. 在项目根目录执行 `node scripts/health-check.ts` 或 `tsx scripts/health-check.ts`
 * 2. 该脚本校验关键环境变量，输出 JSON 结果便于 CI 解析
 * 3. 缺少必需变量时以非零状态码退出，以提醒尽快修复环境
 */
import process from 'node:process';

interface HealthReport {
  readonly status: 'ok' | 'error';
  readonly details: {
    readonly NODE_ENV: string | null;
  };
  readonly missingRequired: readonly string[];
  readonly warnings: readonly string[];
}

function printReport(report: HealthReport, isError: boolean): void {
  const payload = JSON.stringify(report, null, 2);
  if (isError) {
    console.error(payload);
  } else {
    console.log(payload);
  }
}

function main(): void {
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  const nodeEnv = process.env.NODE_ENV ?? null;
  if (nodeEnv === null || nodeEnv.trim() === '') {
    missingRequired.push('NODE_ENV');
  }

  if (process.env.ASTER_CAP_EFFECTS_ENFORCE === '0') {
    warnings.push('ASTER_CAP_EFFECTS_ENFORCE已显式关闭，生产环境不推荐');
  }

  const report: HealthReport = {
    status: missingRequired.length === 0 ? 'ok' : 'error',
    details: {
      NODE_ENV: nodeEnv,
    },
    missingRequired,
    warnings,
  };

  const failed = missingRequired.length > 0;
  printReport(report, failed);
  if (failed) process.exit(1);
}

main();
