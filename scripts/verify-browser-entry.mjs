#!/usr/bin/env node
/**
 * P0-R15/R16: artifact-level browser entry verification.
 *
 * 验证 `dist/src/browser.js` 及其所有 transitive imports 都不依赖 Node 内置模块.
 * 这是 R14 codex review 提的盲点: 源码层 AST scanner 看不到编译产物层的
 * 真实依赖闭包. Next.js webpack 通过 nodejs_compat 处理 node: scheme 没炸,
 * 但任何更严格的 bundler (pure browser bundle / 严格 edge runtime) 会被卡住.
 *
 * R16 升级 (codex round 15 Medium):
 *   - 解析器从 regex 升级为 TypeScript compiler API AST.
 *     Regex 对模板字面量 dynamic import / minified / import attributes /
 *     注释里的字符串等形态没有强保证. AST 一次升级覆盖所有合法 ES module
 *     语法形态 (含未来的 top-level await / decorator).
 *   - violation deny list 从 `node:*` 扩展到 bare Node builtin specifier
 *     (`fs`, `path`, `module`, `perf_hooks`, `crypto`, `child_process`, etc.).
 *     之前合同只挡 `node:` scheme; 如果未来某文件改用 bare specifier
 *     `require('fs')` 而非 `require('node:fs')`, 当前 scanner 会放过.
 *
 * 用法:
 *   pnpm run build  # 先编译 dist/
 *   node scripts/verify-browser-entry.mjs
 *
 * 退出码:
 *   0 = browser entry 闭包干净
 *   1 = 发现 Node 内置模块 import 违规
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist', 'src');
const ENTRY = path.join(DIST_ROOT, 'browser.js');

/**
 * Node.js 内置模块清单 (Node 24 LTS).
 * 任何 bare specifier 命中 = browser bundle 违规.
 *
 * 注: 不含 `node:test` (testing framework) 或 `node:repl` (REPL) 等典型
 * 不该出现在生产 bundle 的模块——但本列表只关心"在场即违规"语义, 不区分模块类别.
 */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'readline/promises',
  'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web',
  'string_decoder', 'sys', 'test', 'timers', 'timers/promises', 'tls',
  'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);

/**
 * 判断一个 import specifier 是否触发 Node 内置违规:
 *   - `node:fs` / `node:path` 等 node: scheme  ← 显式 Node 内置
 *   - `fs` / `path` 等 bare specifier 命中 NODE_BUILTINS ← 隐式 Node 内置
 *   - 否则 (相对路径 / 第三方包) 不算违规
 */
function isNodeBuiltinSpec(spec) {
  if (spec.startsWith('node:')) {
    return { violation: true, reason: 'node: scheme' };
  }
  if (NODE_BUILTINS.has(spec)) {
    return { violation: true, reason: 'bare Node builtin' };
  }
  return { violation: false };
}

if (!fs.existsSync(ENTRY)) {
  console.error(`ERROR: ${ENTRY} not found. Run "pnpm build" first.`);
  process.exit(1);
}

/**
 * 解析 import 路径到 absolute file path (仅本地路径; node:/bare/第三方包不解析)
 */
function resolveLocal(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
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
 * 用 TypeScript compiler API AST 提取一个 JS/TS 文件的所有 import specifier.
 *
 * 覆盖:
 *   - `import x from '...'` / `import * as x from '...'` / `import '...'`
 *   - `export { x } from '...'` / `export * from '...'` (re-export)
 *   - `import('...')` 动态 import (literal argument)
 *   - `require('...')` CommonJS (literal argument)
 *   - `import type { X } from '...'` (type-only)
 *
 * AST 抽取避免了 regex 的盲点 (模板字面量 dynamic / minified / import
 * attributes / 注释里的字符串). 注意: 非 literal 参数 (variable / template)
 * 仍无法静态解析——这是任何 static analyzer 的语义边界.
 */
function extractImports(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS,
  );
  const specs = new Set();

  function visit(node) {
    // ES static import: import ... from '...'  /  import '...'
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.add(node.moduleSpecifier.text);
    }
    // ES re-export: export ... from '...'  /  export * from '...'
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.add(node.moduleSpecifier.text);
    }
    // ES dynamic: import('...')
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.add(node.arguments[0].text);
    }
    // CommonJS: require('...')
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return [...specs];
}

/**
 * BFS 收集 entry 的 transitive 本地闭包, 同时记录所有 Node 内置 import 违规.
 */
function transitiveClosure(entry) {
  const visited = new Set();
  const queue = [entry];
  const violations = [];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const spec of extractImports(cur)) {
      const check = isNodeBuiltinSpec(spec);
      if (check.violation) {
        violations.push({
          file: cur.replace(REPO_ROOT + '/', ''),
          spec,
          reason: check.reason,
        });
        continue;
      }
      const resolved = resolveLocal(cur, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return { visited, violations };
}

console.log(`Scanning browser entry transitive closure: ${ENTRY.replace(REPO_ROOT + '/', '')}`);
console.log(`  parser: TypeScript compiler API (AST)`);
console.log(`  deny: node:* scheme + bare Node builtin specifier (${NODE_BUILTINS.size} modules)`);
const { visited, violations } = transitiveClosure(ENTRY);
console.log(`  files in closure: ${visited.size}`);

if (violations.length > 0) {
  console.error('');
  console.error(`ERROR: ${violations.length} Node builtin import(s) found in browser entry transitive closure:`);
  for (const v of violations) {
    console.error(`  ${v.file} imports '${v.spec}' (${v.reason})`);
  }
  console.error('');
  console.error('Browser entry must not transitively depend on Node built-in modules.');
  console.error('Webpack edge target / strict browser bundles will throw UnhandledSchemeError.');
  process.exit(1);
}

console.log('OK: browser entry closure is free of Node builtin imports');
