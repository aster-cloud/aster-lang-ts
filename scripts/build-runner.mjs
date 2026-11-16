#!/usr/bin/env node
/**
 * 构建单文件 runner：dist/runner/aster.mjs 与 dist/runner/aster.mjs.sha256（ADR 0059 P1 T5，修订 1 A3）。
 *
 * esbuild --bundle --platform=node --format=esm --target=node24 --minify --legal-comments=eof；
 * 版本经 define 注入 __ASTER_CLI_VERSION__。体积预算 1 MiB（node-a，修订 1 A3），超出即构建失败。
 * 产物只 import Node 内置模块（由 test/package-v1/runner-bundle.test.ts 断言）。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const RUNNER_BUDGET_BYTES = 1024 * 1024;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'runner');
const outfile = join(outDir, 'aster.mjs');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [join(root, 'scripts', 'runner-entry.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: true,
  legalComments: 'eof',
  define: { __ASTER_CLI_VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
});

const bytes = readFileSync(outfile);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(`${outfile}.sha256`, `${sha256}  aster.mjs\n`);
console.log(`Built runner → dist/runner/aster.mjs（${bytes.length} 字节，sha256 ${sha256}）`);
if (bytes.length > RUNNER_BUDGET_BYTES) {
  console.error(`dist/runner/aster.mjs 超过体积预算 ${RUNNER_BUDGET_BYTES} 字节（ADR 0059 修订 1 A3）`);
  process.exit(1);
}
