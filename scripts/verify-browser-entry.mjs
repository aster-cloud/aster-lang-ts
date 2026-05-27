#!/usr/bin/env node
/**
 * P0-R15: artifact-level browser entry verification.
 *
 * 验证 `dist/src/browser.js` 及其所有 transitive imports 都不依赖 Node 内置模块
 * （`node:fs`, `node:path`, `node:perf_hooks`, `node:module` 等）。这是
 * R14 codex review 提的盲点：源码层 AST scanner 看不到编译产物层的真实
 * 依赖闭包。Next.js webpack 通过 nodejs_compat 处理 node: scheme 没炸，
 * 但任何更严格的 bundler（pure browser bundle / 严格 edge runtime）会被卡住。
 *
 * 用法：
 *   pnpm run build  # 先编译 dist/
 *   node scripts/verify-browser-entry.mjs
 *
 * 退出码：
 *   0 = browser entry 闭包干净
 *   1 = 发现 node:* import 违规
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist', 'src');
const ENTRY = path.join(DIST_ROOT, 'browser.js');

if (!fs.existsSync(ENTRY)) {
  console.error(`ERROR: ${ENTRY} not found. Run "pnpm build" first.`);
  process.exit(1);
}

/**
 * 解析 import 路径到 absolute file path（仅本地路径；node: scheme / 外部包不解析）
 */
function resolveLocal(fromFile, spec) {
  if (spec.startsWith('node:')) return null; // external — recorded as violation
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // external pkg
  const baseAbs = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    baseAbs,
    baseAbs + '.js',
    path.join(baseAbs, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * 提取一个编译后 JS 文件的所有 import specifier（ESM + dynamic + re-export + CJS require）.
 * 先剥离注释 + 字符串字面量，再 regex 抽取，避免 docstring/字符串里的 'node:xxx' 误报.
 */
function extractImports(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  // 剥离多行注释 /* ... */
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 剥离单行注释 // ...
  src = src.replace(/(^|[^:])\/\/.*$/gm, '$1');

  // 先抽出 import/require 的字符串参数 — 这一步必须在剥离普通字符串之前!
  const specs = new Set();
  const esmRe = /\b(?:import|export)\s+(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const cjsRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [esmRe, dynRe, cjsRe]) {
    let m;
    while ((m = re.exec(src)) !== null) {
      specs.add(m[1]);
    }
  }
  return [...specs];
}

/**
 * BFS 收集 entry 的 transitive 本地闭包，同时记录所有 node:* import 违规。
 */
function transitiveClosure(entry) {
  const visited = new Set();
  const queue = [entry];
  const nodeViolations = [];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const spec of extractImports(cur)) {
      if (spec.startsWith('node:')) {
        nodeViolations.push({ file: cur.replace(REPO_ROOT + '/', ''), spec });
        continue;
      }
      const resolved = resolveLocal(cur, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return { visited, nodeViolations };
}

console.log(`Scanning browser entry transitive closure: ${ENTRY.replace(REPO_ROOT + '/', '')}`);
const { visited, nodeViolations } = transitiveClosure(ENTRY);
console.log(`  files in closure: ${visited.size}`);

if (nodeViolations.length > 0) {
  console.error('');
  console.error(`ERROR: ${nodeViolations.length} node:* import(s) found in browser entry transitive closure:`);
  for (const v of nodeViolations) {
    console.error(`  ${v.file} imports '${v.spec}'`);
  }
  console.error('');
  console.error('Browser entry must not transitively depend on Node built-in modules.');
  console.error('Webpack edge target / strict browser bundles will throw UnhandledSchemeError.');
  process.exit(1);
}

console.log('OK: browser entry closure is free of node:* imports');
