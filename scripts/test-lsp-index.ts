#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function main(): void {
  const root = process.cwd();
  const fixture = path.join(root, 'test', 'lsp-index-fixture');
  if (!fs.existsSync(fixture)) fail('Fixture not found');
  // Build index inside fixture
  const res = spawnSync(process.execPath, [path.join(root, 'dist', 'scripts', 'lsp-build-index.js')], {
    cwd: fixture,
    stdio: 'pipe',
    env: process.env,
  });
  if (res.status !== 0) fail(`Indexer failed: ${res.stderr?.toString() ?? ''}`);
  const idxPath = path.join(fixture, '.asteri', 'lsp-index.json');
  if (!fs.existsSync(idxPath)) fail('Index file not created');
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')) as { files?: any[] };
  const files = Array.isArray(idx.files) ? idx.files : [];
  if (files.length < 2) fail(`Unexpected index size: ${files.length}`);
  // Assert symbols from unopened files exist
  const hasFoo = files.some(f => /fixture.foo/.test(f.moduleName) && f.decls?.some((d: any) => d.name === 'greet'));
  const hasBar = files.some(f => /fixture.bar/.test(f.moduleName) && f.decls?.some((d: any) => d.name === 'idOf'));
  if (!hasFoo || !hasBar) fail('Missing expected symbols in index');
  console.log('LSP index test OK:', { files: files.length, hasFoo, hasBar });
}

main();

