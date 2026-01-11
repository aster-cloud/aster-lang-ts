#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sh(cmd: string, env?: Record<string, string>): void {
  cp.execSync(cmd, {
    stdio: 'inherit',
    env: { ...process.env, ASTER_ROOT: process.cwd(), ...env },
  });
}

// Example configurations: each example needs specific aster sources
interface ExampleConfig {
  name: string;
  sources: string[];
}

const examples: ExampleConfig[] = [
  {
    name: 'login-jvm',
    sources: [
      'test/cnl/programs/examples/login.aster',
      'test/cnl/programs/business/policy/policy_engine.aster',
      'test/cnl/programs/business/policy/policy_demo.aster',
    ],
  },
  {
    name: 'text-jvm',
    sources: ['test/cnl/programs/collections/text_ops.aster'],
  },
  {
    name: 'list-jvm',
    sources: ['test/cnl/programs/collections/list_ops.aster'],
  },
  {
    name: 'map-jvm',
    sources: ['test/cnl/programs/collections/map_ops.aster'],
  },
];

function main(): void {
  // Pre-generate JARs for each example
  // This avoids Gradle calling npm (which may fail in CI due to PATH issues)
  console.log('Pre-generating JARs for examples...');

  for (const example of examples) {
    const outDir = `examples/${example.name}/build/aster-out`;
    fs.mkdirSync(outDir, { recursive: true });

    console.log(`\n=== ${example.name} ===`);

    // Compile aster sources for this example
    for (const source of example.sources) {
      if (!fs.existsSync(source)) {
        console.log(`  ⚠ Source not found: ${source}`);
        continue;
      }
      try {
        sh(`node dist/scripts/emit-classfiles.js ${source}`);
        console.log(`  ✓ Compiled ${path.basename(source)}`);
      } catch (e) {
        console.error(`  ✗ Failed to compile ${source}: ${(e as Error).message}`);
      }
    }

    // Build JAR for this example
    try {
      sh('npm run jar:jvm', { ASTER_OUT_DIR: outDir });
      console.log(`  ✓ Built ${outDir}/aster.jar`);
    } catch (e) {
      console.error(`  ✗ Failed to build JAR: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  // Compile+run JVM examples against package map
  // Use --no-configuration-cache to avoid stale cache issues in CI
  console.log('\nBuilding examples with Gradle...');
  const targets = examples.map((e) => `:examples:${e.name}:build`);
  try {
    sh(`./gradlew ${targets.join(' ')} --no-configuration-cache`);
  } catch (e) {
    console.error('Examples build failed:', (e as Error).message);
    process.exit(1);
  }
  console.log('\nExamples compile against package map: OK');
}

main();
