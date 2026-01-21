#!/usr/bin/env node

/**
 * Build script for browser/edge-compatible bundle
 *
 * Creates a minified, self-contained bundle that can be used in:
 * - Browser environments
 * - Cloudflare Workers/Pages
 * - Edge runtimes (Vercel Edge, Deno Deploy, etc.)
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

async function build() {
  console.log('Building browser bundle...');

  const startTime = Date.now();

  // Build minified bundle
  const result = await esbuild.build({
    entryPoints: [join(projectRoot, 'dist/src/browser.js')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    sourcemap: true,
    metafile: true,
    outfile: join(projectRoot, 'dist/browser.bundle.js'),
    // Tree-shake unused code
    treeShaking: true,
    // Don't include Node.js built-ins (will error if used)
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    // Banner for license info
    banner: {
      js: '/* @aster-cloud/aster-lang-ts - Browser Bundle - MIT License */',
    },
  });

  // Also build non-minified version for debugging
  await esbuild.build({
    entryPoints: [join(projectRoot, 'dist/src/browser.js')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: false,
    sourcemap: true,
    outfile: join(projectRoot, 'dist/browser.bundle.dev.js'),
    treeShaking: true,
    define: {
      'process.env.NODE_ENV': '"development"',
    },
    banner: {
      js: '/* @aster-cloud/aster-lang-ts - Browser Bundle (Dev) - MIT License */',
    },
  });

  const duration = Date.now() - startTime;

  // Analyze bundle size
  const outputs = result.metafile.outputs;
  const bundleStats = Object.entries(outputs).map(([file, info]) => ({
    file: file.replace(projectRoot, ''),
    size: info.bytes,
    sizeKB: (info.bytes / 1024).toFixed(2),
  }));

  console.log('\nBundle created:');
  bundleStats.forEach(({ file, sizeKB }) => {
    console.log(`  ${file}: ${sizeKB} KB`);
  });

  // Check gzipped size
  const bundleContent = readFileSync(join(projectRoot, 'dist/browser.bundle.js'));
  const { gzipSync } = await import('node:zlib');
  const gzipped = gzipSync(bundleContent);
  console.log(`  gzipped: ${(gzipped.length / 1024).toFixed(2)} KB`);

  console.log(`\nBuild completed in ${duration}ms`);

  // Write bundle metadata
  const metadata = {
    version: JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8')).version,
    buildTime: new Date().toISOString(),
    bundleSize: bundleStats[0]?.size || 0,
    gzippedSize: gzipped.length,
    target: 'es2022',
    format: 'esm',
    platform: 'browser',
  };
  writeFileSync(
    join(projectRoot, 'dist/browser.bundle.meta.json'),
    JSON.stringify(metadata, null, 2)
  );
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
