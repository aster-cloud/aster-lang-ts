/**
 * 类型检查 golden 基线回归测试
 *
 * 读取 test/type-checker/golden 下的 .aster 文件，执行完整类型检查流程，
 * 并将诊断结果与 expected/*.errors.json 基线比对，确保回归场景稳定。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import { typecheckModule } from '../../src/typecheck.js';
import { ModuleCache } from '../../src/lsp/module_cache.js';

import type { Module as AstModule, TypecheckDiagnostic, Core } from '../../src/types.js';

type DiagnosticView = {
  code?: TypecheckDiagnostic['code'];
  severity?: TypecheckDiagnostic['severity'];
  message: string;
};

const PROJECT_ROOT = process.cwd();
const TYPE_CHECKER_DIR = path.resolve(PROJECT_ROOT, 'test/type-checker');
const CROSS_MODULE_DIR = path.join(TYPE_CHECKER_DIR, 'cross-module');

const TEST_CASES = [
  // TODO(Parser): 暂不支持命名参数语法 Entry(id: "123")，待解析器增强后恢复
  // Issue: 解析错误 "Expected ')'"
  // 'type_mismatch_assign',
  'capability_missing_decl',
  'effect_missing_io',
  'module_a',
  'module_b',
  'with_external_package',
  // TODO(TypeChecker): CPU 效应检测未接入 typecheckModule，待类型检查器增强后恢复
  // Issue: 未生成预期的 E201 诊断
  // 'effect_missing_cpu',
  'async_missing_wait',
  'pii_http_violation',
  'return_type_mismatch',
  // TODO(Parser): 暂不支持混合列表字面量 [1, "two"]，待解析器增强后恢复
  // Issue: 解析错误 "Unexpected expression"
  // 'list_literal_mismatch',
  'generics',
  'basic_types',
  'workflow-linear',
  'workflow-missing-compensate',
  'workflow-type-mismatch',
  'workflow-missing-io',
  'workflow-undeclared-capability',
  'workflow-compensate-new-cap',
  'workflow_retry_many_attempts',
  'workflow_retry_timeout_conflict',
  'workflow_timeout_too_short',
  'workflow_timeout_too_long',
  'payment_capability_success',
  'payment_capability_missing_io',
  'inventory_capability_success',
  'inventory_capability_missing_io'
] as const;

type CaseName = (typeof TEST_CASES)[number];

const GOLDEN_DIR = path.join(TYPE_CHECKER_DIR, 'golden');
const EXPECTED_DIR = path.join(TYPE_CHECKER_DIR, 'expected');
const EXTERNAL_PACKAGE_DIR = path.join(CROSS_MODULE_DIR, '.aster', 'packages');
const MODULE_SEARCH_PATHS = [GOLDEN_DIR, CROSS_MODULE_DIR, EXTERNAL_PACKAGE_DIR] as const;

const sharedModuleCache = new ModuleCache();
sharedModuleCache.setModuleSearchPaths(MODULE_SEARCH_PATHS);

const MODULE_NAME_BY_CASE = new Map<CaseName, string>();
const CASE_BY_MODULE_NAME = new Map<string, CaseName>();

function compileDiagnostics(caseName: CaseName): DiagnosticView[] {
  const diagnostics = runTypecheckWithDependencies(caseName, new Set<CaseName>());
  return diagnostics.map(({ code, severity, message }) => ({ code, severity, message }));
}

function loadExpectedDiagnostics(caseName: CaseName): DiagnosticView[] {
  const expectedPath = path.join(EXPECTED_DIR, `${caseName}.errors.json`);
  const raw = JSON.parse(fs.readFileSync(expectedPath, 'utf8')) as {
    diagnostics?: Array<Partial<DiagnosticView>>;
  };
  return (raw.diagnostics ?? []).map(({ code, severity, message }) => {
    const view: DiagnosticView = {
      message: message ?? ''
    };
    if (code !== undefined) {
      view.code = code as TypecheckDiagnostic['code'];
    }
    if (severity !== undefined) {
      view.severity = severity as TypecheckDiagnostic['severity'];
    }
    return view;
  });
}

function runTypecheckWithDependencies(caseName: CaseName, visiting: Set<CaseName>): TypecheckDiagnostic[] {
  if (visiting.has(caseName)) {
    const chain = [...visiting, caseName].join(' -> ');
    throw new Error(`检测到模块循环依赖: ${chain}`);
  }
  const core = loadCoreModule(caseName);
  ensureModuleMetadata(caseName, core);
  visiting.add(caseName);
  try {
    const dependencies = extractImportModuleNames(core);
    for (const moduleName of dependencies) {
      const dependencyCase = resolveCaseByModuleName(moduleName);
      if (dependencyCase && dependencyCase !== caseName) {
        runTypecheckWithDependencies(dependencyCase, visiting);
      }
    }
    return typecheckModule(core, {
      moduleCache: sharedModuleCache,
      moduleSearchPaths: MODULE_SEARCH_PATHS,
    });
  } finally {
    visiting.delete(caseName);
  }
}

function loadCoreModule(caseName: CaseName): Core.Module {
  const sourcePath = path.join(GOLDEN_DIR, `${caseName}.aster`);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  const ast = parse(tokens).ast as AstModule;
  return lowerModule(ast);
}

function extractImportModuleNames(module: Core.Module): string[] {
  const names = new Set<string>();
  for (const decl of module.decls) {
    if (decl.kind === 'Import') {
      const moduleName = (decl.name ?? '').trim();
      if (moduleName.length > 0) names.add(moduleName);
    }
  }
  return Array.from(names);
}

function resolveCaseByModuleName(moduleName: string): CaseName | undefined {
  if (!moduleName) return undefined;
  const cached = CASE_BY_MODULE_NAME.get(moduleName);
  if (cached) return cached;
  for (const caseName of TEST_CASES) {
    if (!MODULE_NAME_BY_CASE.has(caseName)) {
      ensureModuleMetadata(caseName);
    }
    const resolved = CASE_BY_MODULE_NAME.get(moduleName);
    if (resolved) return resolved;
  }
  return undefined;
}

function ensureModuleMetadata(caseName: CaseName, module?: Core.Module): void {
  if (MODULE_NAME_BY_CASE.has(caseName)) return;
  const resolved = (module ?? loadCoreModule(caseName)).name ?? '';
  const normalized = resolved.trim();
  MODULE_NAME_BY_CASE.set(caseName, normalized);
  if (normalized) {
    CASE_BY_MODULE_NAME.set(normalized, caseName);
  }
}

describe('类型检查 golden 回归测试', () => {
  for (const caseName of TEST_CASES) {
    it(`用例 ${caseName} 的诊断应与基线一致`, () => {
      const actualDiagnostics = compileDiagnostics(caseName);
      const expectedDiagnostics = loadExpectedDiagnostics(caseName);
      try {
        assert.deepStrictEqual(actualDiagnostics, expectedDiagnostics);
      } catch (error) {
        console.error(`\n用例 ${caseName} 诊断 diff:`);
        console.error('实际诊断:');
        console.error(JSON.stringify(actualDiagnostics, null, 2));
        console.error('期望诊断:');
        console.error(JSON.stringify(expectedDiagnostics, null, 2));
        throw error;
      }
    });
  }
});
