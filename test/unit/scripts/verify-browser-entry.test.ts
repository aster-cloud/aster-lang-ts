// P0-R16/R17: self-tests for scripts/verify-browser-entry.mjs.
//
// 锁定 verifier 的拦截契约——证明未来 PR 时各种 Node 依赖形态都能被抓住,
// 同时不误报 local / 第三方包.
//
// R17 (codex round 17 High + Medium):
//   - 不再复制 verifier 的 deny list, 改用 `node:module.isBuiltin()` 作为
//     权威源. 这样 self-test 不会因复制同一份不全的清单而错过 regression
//     (如 codex 抓到的 `assert/strict` / `dns/promises` / `inspector/promises`).
//   - 新增 builtin set 完整性契约: verifier 必须接受 Node 当前所有 builtin
//     (用 builtinModules 全集断言).

import test from 'node:test';
import assert from 'node:assert/strict';
import { isBuiltin, builtinModules } from 'node:module';
import * as ts from 'typescript';

/**
 * 复制自 verify-browser-entry.mjs 的等价实现; 用 isBuiltin 而非手维护清单.
 * keep verifier .mjs 简单 (单文件不导出 helper), self-test 独立校对.
 */
function isNodeBuiltinSpec(spec: string): { violation: boolean; reason?: string } {
  if (!isBuiltin(spec)) return { violation: false };
  return {
    violation: true,
    reason: spec.startsWith('node:') ? 'node: scheme' : 'bare Node builtin',
  };
}

function extractFromSource(src: string, name = 'tmp.js'): string[] {
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true);
  const specs = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.add(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.add(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) {
        specs.add(arg0.text);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) {
        specs.add(arg0.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return [...specs];
}

test('isNodeBuiltinSpec: node: scheme triggers violation', () => {
  const r = isNodeBuiltinSpec('node:fs');
  assert.equal(r.violation, true);
  assert.equal(r.reason, 'node: scheme');
});

test('isNodeBuiltinSpec: bare Node builtin triggers violation', () => {
  for (const m of ['fs', 'path', 'perf_hooks', 'crypto', 'module', 'os', 'child_process']) {
    const r = isNodeBuiltinSpec(m);
    assert.equal(r.violation, true, `bare '${m}' should be violation`);
    assert.equal(r.reason, 'bare Node builtin');
  }
});

test('isNodeBuiltinSpec: subpath imports (fs/promises) triggers violation', () => {
  const r = isNodeBuiltinSpec('fs/promises');
  assert.equal(r.violation, true);
});

test('R17: isNodeBuiltinSpec catches Node 24 subpath builtins missed by R16 手写清单', () => {
  // codex round 17 High: 手写 NODE_BUILTINS 漏 `assert/strict` / `dns/promises` /
  // `inspector/promises`. 用 isBuiltin() 后这些都能拦.
  for (const m of ['assert/strict', 'dns/promises', 'inspector/promises']) {
    assert.equal(isNodeBuiltinSpec(m).violation, true, `subpath '${m}' should be violation`);
  }
});

test('R17 completeness: verifier 接受 builtinModules 全集 (no manual drift)', () => {
  // 契约: 当前 Node runtime 报告的所有 builtin (含 _http_agent / _http_common 等
  // 内部前缀) 都应被 verifier 视为违规. 这样未来 Node 升级新增 builtin 时
  // 不需要手动同步 deny list — Node API 是单一事实源.
  for (const m of builtinModules) {
    const r = isNodeBuiltinSpec(m);
    assert.equal(r.violation, true, `builtinModules entry '${m}' must be denied`);
  }
});

test('isNodeBuiltinSpec: relative imports do not trigger', () => {
  for (const m of ['./foo', '../bar/baz', './typecheck/pure.js']) {
    assert.equal(isNodeBuiltinSpec(m).violation, false);
  }
});

test('isNodeBuiltinSpec: third-party packages do not trigger', () => {
  for (const m of ['zod', 'react', '@aster-cloud/aster-lang-test', 'typescript']) {
    assert.equal(isNodeBuiltinSpec(m).violation, false);
  }
});

test('extractImports: ES static import', () => {
  const specs = extractFromSource(`import foo from 'fs';\nimport './bar';`);
  assert.deepEqual(specs.sort(), ['./bar', 'fs'].sort());
});

test('extractImports: ES re-export', () => {
  const specs = extractFromSource(`export { foo } from 'fs';\nexport * from './bar';`);
  assert.deepEqual(specs.sort(), ['./bar', 'fs'].sort());
});

test('extractImports: dynamic import()', () => {
  const specs = extractFromSource(`const m = import('fs');\nasync function f() { await import('./foo'); }`);
  assert.deepEqual(specs.sort(), ['./foo', 'fs'].sort());
});

test('extractImports: CJS require()', () => {
  const specs = extractFromSource(`const fs = require('fs');\nconst p = require('./util');`);
  assert.deepEqual(specs.sort(), ['./util', 'fs'].sort());
});

test('extractImports: type-only import', () => {
  const specs = extractFromSource(`import type { X } from 'fs';`);
  assert.deepEqual(specs, ['fs']);
});

test('extractImports: createRequire pattern (R15 regression)', () => {
  // R14/R15 实际事故: utils.ts 用 require('node:module') 然后 createRequire.
  // AST 必须捕捉 require('node:module') 这个 literal call.
  const src = `
    const { createRequire } = require('node:module');
    const require2 = createRequire(import.meta.url);
  `;
  const specs = extractFromSource(src);
  assert.ok(specs.includes('node:module'));
});

test('extractImports: ignores string literals NOT in import/require positions', () => {
  // Regex parser 会把任何 'fs' 字符串误判; AST 只看 import/require 的 argument
  const src = `
    const message = 'open fs from path';
    function foo() { return 'require("fs")'; }
    const obj = { lib: 'fs' };
  `;
  const specs = extractFromSource(src);
  assert.deepEqual(specs, []);
});

test('extractImports: comments do not pollute (AST level immune)', () => {
  const src = `
    // import fs from 'fs';
    /* require('fs') in comment */
    /** @example import foo from 'fs' */
    const x = 1;
  `;
  const specs = extractFromSource(src);
  assert.deepEqual(specs, []);
});

test('extractImports: template literal dynamic import is NOT captured (documented limit)', () => {
  // 已知限制: 非 literal 参数 (template / variable) AST 无法静态解析.
  // 这是任何 static analyzer 的语义边界. fixture 锁定行为, 提醒未来若
  // 真实代码出现此模式需要 runtime 验证 (build) 兜底.
  const src = `
    const mod = 'fs';
    const m1 = await import(\`\${mod}\`);
    const m2 = await import(mod);
  `;
  const specs = extractFromSource(src);
  assert.deepEqual(specs, []);
});

test('extractImports: side-effect-only import', () => {
  const specs = extractFromSource(`import 'fs';\nimport './polyfill.js';`);
  assert.deepEqual(specs.sort(), ['./polyfill.js', 'fs'].sort());
});

test('integration: violation detected for mixed Node + local imports', () => {
  const src = `
    import { x } from './local.js';
    import fs from 'fs';
    import 'node:path';
    const m = require('node:perf_hooks');
  `;
  const specs = extractFromSource(src);
  const violations = specs.filter((s) => isNodeBuiltinSpec(s).violation);
  assert.deepEqual(violations.sort(), ['fs', 'node:path', 'node:perf_hooks'].sort());
});
