#!/usr/bin/env node
import cp from 'node:child_process';

function main(): void {
  const file = process.argv[2] || 'test/cnl/programs/core-reference/null_strict_core.json';
  const env = { ...process.env, INTEROP_NULL_STRICT: 'true' };
  const r = cp.spawnSync(process.execPath, ['dist/scripts/emit-classfiles-core.js', file], {
    stdio: 'inherit',
    env,
  });
  if (r.status === 0) {
    console.error('Unexpected success: strict nullability should have failed emission');
    process.exit(1);
  } else {
    console.log('Strict nullability check: emission blocked as expected');
    process.exit(0);
  }
}

main();
