import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import { typecheckModule } from '../../src/typecheck.js';
import type { Module as AstModule, Core, TypecheckDiagnostic } from '../../src/types.js';
import { ModuleCache } from '../../src/lsp/module_cache.js';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test/type-checker/cross-module');
// Use 'external-packages' instead of '.aster/packages' to ensure fixtures are tracked by git
// (directories starting with .aster are git-ignored)
const PACKAGE_ROOT = path.join(FIXTURE_ROOT, 'external-packages');
const MODULE_SEARCH_PATHS = [FIXTURE_ROOT, PACKAGE_ROOT] as const;

function loadCoreModule(relativePath: string): Core.Module {
  const absolutePath = path.join(FIXTURE_ROOT, relativePath);
  const source = readFileSync(absolutePath, 'utf8');
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  const ast = parse(tokens) as AstModule;
  return lowerModule(ast);
}

function runTypecheck(fileName: string, cache: ModuleCache): TypecheckDiagnostic[] {
  const module = loadCoreModule(fileName);
  return typecheckModule(module, {
    moduleCache: cache,
    moduleSearchPaths: MODULE_SEARCH_PATHS,
  });
}

describe('跨模块类型检查加载包签名', () => {
  it('工作区模块导入不会破坏类型检查', () => {
    const cache = new ModuleCache();
    const moduleADiagnostics = runTypecheck('module_a.aster', cache);
    assert.equal(moduleADiagnostics.length, 0, '工作区 module_a 应无诊断');

    const moduleBDiagnostics = runTypecheck('module_b.aster', cache);
    assert.equal(moduleBDiagnostics.length, 0, '工作区 module_b 应通过类型检查');
  });

  it('可以从 external-packages 加载外部模块签名', () => {
    const cache = new ModuleCache();
    const diagnostics = runTypecheck('module_b_external.aster', cache);
    assert.equal(diagnostics.length, 0, '导入外部包应通过类型检查');
  });

  it('缺失的包会返回 MODULE_NOT_FOUND 诊断', () => {
    const cache = new ModuleCache();
    const diagnostics = runTypecheck('module_b_missing_pkg.aster', cache);
    assert.ok(diagnostics.length > 0, '缺失包应产生诊断');
    const missing = diagnostics[0]!;
    assert.equal(missing.severity, 'error', '缺失包应报错');
    assert.ok(
      missing.message.includes('MODULE_NOT_FOUND') && missing.message.includes('mock.pkg.analytics.missing'),
      '错误信息应包含 MODULE_NOT_FOUND 与模块名'
    );
  });
});
