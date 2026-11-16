import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConformanceSuite } from './conformance-runner.js';

// 单文件 runner dist/runner/aster.mjs（ADR 0059 P1 T5）：拷到仓外的临时目录（没有 node_modules）后重跑全部一致性用例，
// 并断言体积预算（1 MiB，修订 1 A3）、sha256 文件与 bundle 只 import Node 内置模块（P0 结果 §2）。
const BUNDLE = join(process.cwd(), 'dist/runner/aster.mjs');
const isolated = join(mkdtempSync(join(tmpdir(), 'aster-runner-')), 'aster.mjs');
copyFileSync(BUNDLE, isolated);

test('runner：体积 ≤ 1 MiB，sha256 文件与产物一致', () => {
  const bytes = readFileSync(BUNDLE);
  assert.ok(statSync(BUNDLE).size <= 1024 * 1024, `aster.mjs ${bytes.length} 字节超过 1 MiB`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(readFileSync(`${BUNDLE}.sha256`, 'utf8'), `${sha}  aster.mjs\n`);
});

test('runner：全部 import 说明符都是 Node 内置模块', () => {
  const code = readFileSync(BUNDLE, 'utf8');
  const specs = new Set<string>();
  for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\bimport\s*["']([^"']+)["']/g]) {
    for (const m of code.matchAll(re)) specs.add(m[1]!);
  }
  assert.ok(specs.size > 0, '没有抽到任何 import 说明符');
  for (const s of specs) {
    const name = s.startsWith('node:') ? s.slice(5) : s;
    assert.ok(builtinModules.includes(name), `bundle import 了非内置模块 ${s}`);
  }
});

defineConformanceSuite('runner（dist/runner/aster.mjs，仓外拷贝）', [isolated]);
