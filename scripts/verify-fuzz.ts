#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

function sh(cmd: string): void { cp.execSync(cmd, { stdio: 'inherit' }); }

function randInt(n: number): number { return Math.floor(Math.random() * n); }

function randExpr(i: number): any {
  const k = randInt(3);
  if (k === 0) return { kind: 'Int', value: randInt(1000) };
  if (k === 1) return { kind: 'Bool', value: randInt(2) === 0 };
  // 50% chance of static interop call to exercise INVOKESTATIC lowering
  if (randInt(2) === 0) {
    const which = randInt(2);
    if (which === 0) {
      // pick overload fuzz
      const choice = randInt(4);
      let arg: any;
      if (choice === 0) arg = { kind: 'Int', value: randInt(100) };
      else if (choice === 1) arg = { kind: 'Bool', value: randInt(2) === 0 };
      else if (choice === 2) arg = { kind: 'String', value: 's' + i };
      else arg = { kind: 'Null' };
      return { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.pick' }, args: [arg] };
    } else {
      // sum overload fuzz with mixed numeric kinds
      const aKinds = [
        { kind: 'Int', value: randInt(50) },
        { kind: 'Long', value: String(randInt(50)) },
        { kind: 'Double', value: Math.floor(Math.random() * 50) + 0.5 },
      ];
      const a = aKinds[randInt(aKinds.length)];
      const b = aKinds[randInt(aKinds.length)];
      return { kind: 'Call', target: { kind: 'Name', name: 'aster.runtime.Interop.sum' }, args: [a, b] };
    }
  }
  return { kind: 'String', value: 's' + i };
}

function genCoreJSON(i: number): any {
  // Randomly generate either a Return literal or an If with two Returns
  const shape = randInt(2);
  if (shape === 0) {
    const e = randExpr(i);
    const retName = e.kind === 'String' ? 'Text' : e.kind;
    return {
      kind: 'Module', name: 'fuzz.mod' + i, decls: [
        { kind: 'Func', name: 'f' + i, params: [], ret: { kind: 'TypeName', name: retName }, effects: [],
          body: { kind: 'Block', statements: [{ kind: 'Return', expr: e }] } }
      ]
    };
  } else {
    const cond = { kind: 'Bool', value: randInt(2) === 0 };
    const thenExpr = randExpr(i);
    const elseExpr = randExpr(i+1000);
    // Harmonize return type to Text if either branch is String
    const retName = (thenExpr.kind === 'String' || elseExpr.kind === 'String') ? 'Text' : (thenExpr.kind === 'Bool' || elseExpr.kind === 'Bool') ? 'Bool' : 'Int';
    return {
      kind: 'Module', name: 'fuzz.mod' + i, decls: [
        { kind: 'Func', name: 'f' + i, params: [], ret: { kind: 'TypeName', name: retName }, effects: [],
          body: { kind: 'Block', statements: [
            { kind: 'If', cond, thenBlock: { kind: 'Block', statements: [{ kind: 'Return', expr: thenExpr }] }, elseBlock: { kind: 'Block', statements: [{ kind: 'Return', expr: elseExpr }] } }
          ] } }
      ]
    };
  }
}

function main(): void {
  const outDir = path.resolve('build/asm-fuzz');
  fs.mkdirSync(outDir, { recursive: true });
  const N = 100;
  for (let i = 0; i < N; i++) {
    const mod = genCoreJSON(i);
    const p = path.join(outDir, `fuzz_${i}.json`);
    fs.writeFileSync(p, JSON.stringify(mod));
    sh(`node dist/scripts/emit-classfiles-core.js '${p}'`);
  }
  // Verify classes under -Xverify:all
  sh('node dist/scripts/verify-classes.js');
  console.log('Fuzz verify passed');
}

main();
