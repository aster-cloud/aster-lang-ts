#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

function sh(cmd: string, opts: cp.ExecSyncOptions = {}): void {
  cp.execSync(cmd, { stdio: 'inherit', ...opts });
}

function runEmit(inputs: string[]): void {
  for (const inp of inputs) {
    sh(`node dist/scripts/emit-classfiles.js ${inp}`);
  }
}

function rmrf(p: string): void {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src: string, dst: string): void {
  rmrf(dst);
  fs.mkdirSync(dst, { recursive: true });
  // Node 22: fs.cpSync available
  (fs as any).cpSync ? (fs as any).cpSync(src, dst, { recursive: true }) : copyDirManual(src, dst);
}

function copyDirManual(src: string, dst: string): void {
  for (const ent of fs.readdirSync(src)) {
    const s = path.join(src, ent);
    const d = path.join(dst, ent);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDirManual(s, d);
    } else if (st.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  function rec(d: string): void {
    for (const ent of fs.readdirSync(d)) {
      const p = path.join(d, ent);
      const st = fs.statSync(p);
      if (st.isDirectory()) rec(p);
      else if (st.isFile() && p.endsWith('.class')) out.push(path.relative(root, p));
    }
  }
  rec(root);
  out.sort();
  return out;
}

function compareDirs(a: string, b: string): { ok: boolean; errors: string[] } {
  const errs: string[] = [];
  const fa = listFiles(a);
  const fb = listFiles(b);
  if (fa.length !== fb.length || fa.some((v, i) => v !== fb[i])) {
    const sa = new Set(fa), sb = new Set(fb);
    for (const f of fa) if (!sb.has(f)) errs.push(`only in run1: ${f}`);
    for (const f of fb) if (!sa.has(f)) errs.push(`only in run2: ${f}`);
  }
  const common = fa.filter(f => fb.includes(f));
  for (const rel of common) {
    const ab = fs.readFileSync(path.join(a, rel));
    const bb = fs.readFileSync(path.join(b, rel));
    if (ab.length !== bb.length) {
      errs.push(`size differs: ${rel} (${ab.length} vs ${bb.length})`);
      continue;
    }
    let diffAt = -1;
    for (let i = 0; i < ab.length; i++) {
      if (ab[i] !== bb[i]) { diffAt = i; break; }
    }
    if (diffAt >= 0) {
      errs.push(`bytes differ at offset ${diffAt}: ${rel}`);
    }
  }
  return { ok: errs.length === 0, errors: errs };
}

async function main(): Promise<void> {
  const inputs = [
    'test/cnl/programs/examples/login.aster',
    'test/cnl/programs/examples/greet.aster',
    'test/cnl/programs/patterns/enum_exhaustiveness.aster',
    'test/cnl/programs/patterns/match_enum.aster',
    'test/cnl/programs/error-handling/result_trycatch.aster',
    'test/cnl/programs/collections/list_ops.aster',
    'test/cnl/programs/collections/map_ops.aster',
  ];
  // Ensure build
  sh('npm run build');

  const out = path.resolve('build/jvm-classes');
  const r1 = path.resolve('build/determinism/run1');
  const r2 = path.resolve('build/determinism/run2');

  // Run 1
  rmrf(out);
  runEmit(inputs);
  copyDir(out, r1);

  // Run 2
  rmrf(out);
  runEmit(inputs);
  copyDir(out, r2);

  // Compare
  const { ok, errors } = compareDirs(r1, r2);
  if (!ok) {
    console.error('Determinism check FAILED:');
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('Determinism check passed: classfiles identical across runs');
}

main().catch(e => {
  console.error('determinism script failed:', e);
  process.exit(1);
});
