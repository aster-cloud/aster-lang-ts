#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sh(cmd: string): void {
  cp.execSync(cmd, { stdio: 'inherit' });
}

function findRuntimeJar(): string {
  const dir = 'aster-runtime/build/libs';
  if (!fs.existsSync(dir)) return '';
  const jars = fs.readdirSync(dir).filter(f => f.endsWith('.jar'));
  return jars.length > 0 ? path.join(dir, jars[0]!) : '';
}

function main(): void {
  // Ensure runtime jar exists
  sh('./gradlew :aster-runtime:jar');
  const rt = findRuntimeJar();
  if (!rt) {
    console.error('aster-runtime jar not found');
    process.exit(2);
  }
  const classesDir = path.resolve('build/jvm-classes');
  if (!fs.existsSync(classesDir)) {
    console.error('classes not found at ' + classesDir);
    process.exit(2);
  }
  const cp = `${rt}:${classesDir}`;
  sh(`java -Xverify:all -cp '${cp}' aster.runtime.VerifyClasses '${classesDir}'`);
}

main();

