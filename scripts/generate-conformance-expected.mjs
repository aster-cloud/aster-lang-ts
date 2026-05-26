#!/usr/bin/env node
// 生成 conformance/cjk-v2/*.expected.txt
//
// 读取每个 .aster 文件，用 TS 端 canonicalizer 跑一遍，输出到 .expected.txt。
// 这是 cross-impl 等价测试的"权威结果"——Java 端必须产生 byte-identical 输出。
//
// 用法：
//   cd aster-lang-ts && pnpm run build && node scripts/generate-conformance-expected.mjs

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCJKPunctuationOnly } from '../dist/src/frontend/canonicalizer.js';

const here = dirname(fileURLToPath(import.meta.url));
const conformanceDir = join(
  here,
  '..', '..',  // → IdeaProjects/
  'aster-lang-test', 'corpus', 'conformance', 'cjk-v2',
);

// conformance test 只验证 v2 新增的 CJK 标点归一化层。
// 不包含完整 canonicalize（关键字翻译、空格折叠等是双 parser 范畴的不同设计）。
const entries = await readdir(conformanceDir);
const asterFiles = entries.filter((f) => f.endsWith('.aster'));

let generated = 0;
for (const file of asterFiles) {
  const srcPath = join(conformanceDir, file);
  const dstPath = srcPath.replace(/\.aster$/, '.expected.txt');
  const source = await readFile(srcPath, 'utf8');
  // 只跑 CJK 标点归一化——这一步必须与 Java 端 byte-identical
  const normalized = normalizeCJKPunctuationOnly(source);
  await writeFile(dstPath, normalized, 'utf8');
  console.log(`✓ ${file} → ${file.replace(/\.aster$/, '.expected.txt')} (${normalized.length} bytes)`);
  generated++;
}

console.log(`\n生成完毕：${generated} 个 expected 文件`);
