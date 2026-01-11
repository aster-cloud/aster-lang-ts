#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../dist/src/frontend/canonicalizer.js';
import { lex } from '../dist/src/frontend/lexer.js';
import { parse } from '../dist/src/parser.js';
import { lowerModule } from '../dist/src/lower_to_core.js';

function sh(cmd, opts = {}) {
  const env = {
    GRADLE_USER_HOME: path.resolve('build/.gradle'),
    GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
    JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
    ...process.env,
    ...(opts.env || {}),
  };
  cp.execSync(cmd, { stdio: 'inherit', env, ...opts });
}

async function main() {
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
  const jars = fs.readdirSync(buildDir).filter(f => f.endsWith('.jar'));
  if (jars.length === 0) {
    console.error('Emitter jar not found in', buildDir);
    process.exit(2);
  }
  const jar = path.join(buildDir, jars[0]);

  const input = process.argv[2];
  if (!input) {
    console.error('Usage: emit-classfiles <file.aster>');
    process.exit(2);
  }
  const src = fs.readFileSync(input, 'utf8');
  const core = lowerModule(parse(lex(canonicalize(src))));
  const payload = JSON.stringify(core);

  const runCmd = hasWrapper ? './gradlew' : 'gradle';
  await new Promise((resolve, reject) => {
    const env = {
      GRADLE_USER_HOME: path.resolve('build/.gradle'),
      GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
      JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
      ...process.env,
    };
    const proc = cp.spawn(runCmd, [':aster-asm-emitter:run', '--args=build/jvm-classes'], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env,
    });
    proc.on('error', reject);
    proc.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`emitter exited ${code}`))
    );
    proc.stdin.write(payload);
    proc.stdin.end();
  });
  console.log('Emitted classes to build/jvm-classes');
}

main().catch(e => {
  console.error('emit-classfiles failed:', e);
  process.exit(1);
});
