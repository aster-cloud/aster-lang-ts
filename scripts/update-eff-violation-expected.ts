#!/usr/bin/env node
/**
 * 临时脚本：更新 eff_violation_* 测试的 expected 输出文件
 */
import fs from 'node:fs';
import { canonicalize, lex, parse } from '../src/index.js';

process.env.ASTER_CAP_EFFECTS_ENFORCE = '1';

const tests = [
  'eff_violation_chain',
  'eff_violation_cpu_calls_io',
  'eff_violation_empty_caps',
  'eff_violation_files_calls_secrets',
  'eff_violation_http_calls_sql',
  'eff_violation_missing_http',
  'eff_violation_missing_sql',
  'eff_violation_missing_time',
  'eff_violation_mixed_caps',
  'eff_violation_multiple_errors',
  'eff_violation_nested_a',
  'eff_violation_nested_b',
  'eff_violation_pure_calls_cpu',
  'eff_violation_secrets_calls_ai',
  'eff_violation_sql_calls_files',
  'eff_violation_transitive',
  'eff_violation_files_only',
  'eff_violation_secrets_calls_http',
];

async function updateExpectedFiles(): Promise<void> {
  const { lowerModule } = await import('../src/lower_to_core.js');
  const { typecheckModule } = await import('../src/typecheck.js');

  for (const test of tests) {
    const inputFile = `test/cnl/programs/effects/${test}.aster`;
    const outputFile = `test/cnl/programs/effects/expected_${test}.diag.txt`;

    console.log(`更新 ${test}...`);
    try {
      const src = fs.readFileSync(inputFile, 'utf8');
      const can = canonicalize(src);
      const toks = lex(can);
      const { ast } = parse(toks);
      const core = lowerModule(ast);
      const diags = typecheckModule(core);
      const actualLines = Array.from(
        new Set(diags.map(d => `${d.severity.toUpperCase()}: ${d.message}`))
      );
      const output = actualLines.join('\n') + (actualLines.length ? '\n' : '');
      fs.writeFileSync(outputFile, output, 'utf-8');
      console.log(`  ✓ 已更新 ${outputFile}`);
    } catch (error) {
      console.error(`  ✗ 失败: ${error}`);
    }
  }

  console.log('\n全部完成！');
}

updateExpectedFiles().catch(e => {
  console.error('脚本失败:', (e as Error).message);
  process.exit(1);
});
