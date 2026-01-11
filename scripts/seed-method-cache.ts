#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

function main(): void {
  const mod = {
    kind: 'Module',
    name: 'seed.cache',
    decls: [
      // Interop.sum with I,J,D
      { kind: 'Func', name: 'sumI', params: [], ret: { kind: 'TypeName', name: 'Text' }, effects: [], body: { kind: 'Block', statements: [ { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.sum' }, args: [ { kind: 'Int', value: 1 }, { kind: 'Int', value: 2 } ] } } ] } },
      { kind: 'Func', name: 'sumJ', params: [], ret: { kind: 'TypeName', name: 'Text' }, effects: [], body: { kind: 'Block', statements: [ { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.sum' }, args: [ { kind: 'Long', value: '1' }, { kind: 'Long', value: '2' } ] } } ] } },
      { kind: 'Func', name: 'sumD', params: [], ret: { kind: 'TypeName', name: 'Text' }, effects: [], body: { kind: 'Block', statements: [ { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.sum' }, args: [ { kind: 'Double', value: 1.0 }, { kind: 'Double', value: 2.0 } ] } } ] } },
      // Interop.pick with common overloads
      { kind: 'Func', name: 'pickI', params: [], ret: { kind: 'TypeName', name: 'Text' }, effects: [], body: { kind: 'Block', statements: [ { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.pick' }, args: [ { kind: 'Int', value: 1 } ] } } ] } },
      { kind: 'Func', name: 'pickZ', params: [], ret: { kind: 'TypeName', name: 'Text' }, effects: [], body: { kind: 'Block', statements: [ { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.pick' }, args: [ { kind: 'Bool', value: true } ] } } ] } },
      { kind: 'Func', name: 'pickS', params: [], ret: { kind: 'TypeName', name: 'Text' }, effects: [], body: { kind: 'Block', statements: [ { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.pick' }, args: [ { kind: 'String', value: 'x' } ] } } ] } },
      { kind: 'Func', name: 'pickObj', params: [], ret: { kind: 'TypeName', name: 'Text' }, effects: [], body: { kind: 'Block', statements: [ { kind: 'Return', expr: { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.pick' }, args: [ { kind: 'Null' } ] } } ] } }
    ]
  } as const;

  fs.mkdirSync('build/.asteri', { recursive: true });
  const tmp = path.resolve('build/.asteri/seed-methods.core.json');
  fs.writeFileSync(tmp, JSON.stringify(mod));

  const r = cp.spawnSync(process.execPath, ['dist/scripts/emit-classfiles-core.js', tmp], {
    stdio: 'inherit',
    env: { ...process.env, ASTER_ROOT: process.cwd() },
  });
  if (r.status !== 0) {
    console.error('Method cache seed failed');
    process.exit(1);
  } else {
    console.log('Method cache seeded. Inspect with: npm run cache:inspect:methods');
  }
}

main();

