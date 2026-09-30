#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gradleEnv } from '../src/cli/utils/gradle-env.js';

function sh(cmd: string, opts: cp.ExecSyncOptions = {}): void {
  cp.execSync(cmd, { stdio: 'inherit', ...opts, env: { ...gradleEnv(), ...opts.env } });
}

async function main(): Promise<void> {
  // Ensure emitter built (use gradle if no wrapper)
  const hasWrapper = fs.existsSync('./gradlew');
  const buildDir = 'aster-asm-emitter/build/libs';
  if (
    !fs.existsSync(buildDir) ||
    fs.readdirSync(buildDir).filter(f => f.endsWith('.jar')).length === 0
  ) {
    const buildCmd = hasWrapper
      ? './gradlew :aster-asm-emitter:build'
      : 'gradle :aster-asm-emitter:build';
    try {
      sh(buildCmd);
    } catch (e) {
      console.error('Failed to build ASM emitter:', e);
      process.exit(1);
    }
  }

  const input = process.argv[2];
  if (!input) {
    console.error('Usage: emit-classfiles-core <file.core.json>');
    process.exit(2);
  }
  const src = fs.readFileSync(input, 'utf8');
  // Generate primitive hints sidecar
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['dist/scripts/emit-hints.js', input], { stdio: 'inherit' });
    if (r.status !== 0) console.error('WARN: hints generation failed');
  } catch (e) {
    console.error('WARN: hints generation error:', (e as Error).message);
  }
  // Basic sanity check: expect a Module JSON
  if (!src.trim().startsWith('{')) {
    console.error('Input does not look like JSON:', input);
    process.exit(2);
  }

  fs.mkdirSync('build', { recursive: true });
  fs.writeFileSync('build/last-core.json', src);

  const runCmd = fs.existsSync('./gradlew') ? './gradlew' : 'gradle';
  const outDir = path.resolve('build/jvm-classes');
  // Clean output dir to avoid stale classes triggering javap checks
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  await new Promise<void>((resolve, reject) => {
    // HINTS_PATH / ASTER_ROOT 写在 ...gradleEnv() 之后，因此优先于宿主环境中的同名变量
    //（#201 之前 ...process.env 置于末尾，宿主值会覆盖这两项；现在以项目内路径为准）。
    const env = {
      ...gradleEnv(),
      HINTS_PATH: path.resolve('build/hints.json'),
      ASTER_ROOT: process.cwd(),
    };
    const proc = cp.spawn(runCmd, [':aster-asm-emitter:run', `--args=${outDir}`], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env,
    });
    proc.on('error', reject);
    proc.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`emitter exited ${code}`))
    );
    proc.stdin.write(src);
    proc.stdin.end();
  });
  console.log('Emitted classes to build/jvm-classes');
}

main().catch(e => {
  console.error('emit-classfiles-core failed:', e);
  process.exit(1);
});
