#!/usr/bin/env node
import fs from 'node:fs';
import { parseSource, resolveAndLowerChecked } from '../src/compile-pipeline.js';
import { typecheckModuleWithCapabilities } from '../src/typecheck.js';

function main(): void {
  const src = fs.readFileSync('test/cnl/programs/business/policy/capdemo.aster', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('test/cnl/programs/integration/capabilities/capabilities.json', 'utf8'));
  // 名称解析 R1 → lower → R2（ADR 0051）；E8xx 时抛错
  const core = resolveAndLowerChecked(parseSource(src).ast).core;
  const diags = typecheckModuleWithCapabilities(core, manifest);
  // Expect exactly one error: badIO should be allowed (module matches), but its body is invalid nullstrict-wise; we only assert capability errors count is zero
  const capErrors = diags.filter(d => d.severity === 'error' && d.message.includes('capability manifest')).length;
  if (capErrors !== 0) {
    console.error('Capability verification failed:', diags);
    process.exit(1);
  }
  console.log('Capability verification passed (no manifest violations)');
}

main();
