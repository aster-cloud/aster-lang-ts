import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import { typecheckModule } from '../../src/typecheck.js';
import { emitJava } from '../../src/jvm/emitter.js';
import { ErrorCode } from '../../src/diagnostics/error_codes.js';
import type {
  Module as AstModule,
  WorkflowStmt,
  TypecheckDiagnostic,
  Core as CoreTypes,
} from '../../src/types.js';

function parseModuleFromSource(source: string): AstModule {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  return parse(tokens);
}

function findWorkflowInAst(module: AstModule, funcName = 'orchestrate'): WorkflowStmt {
  const func = module.decls.find(
    (decl): decl is Extract<AstModule['decls'][number], { kind: 'Func' }> =>
      decl.kind === 'Func' && decl.name === funcName
  );
  assert.ok(func, `应该找到函数 ${funcName}`);
  assert.ok(func.body, `函数 ${funcName} 需要包含 workflow 语句`);
  const workflow = func.body?.statements.find(
    (stmt): stmt is WorkflowStmt => stmt.kind === 'workflow'
  );
  assert.ok(workflow, '应该解析出 workflow 语句');
  return workflow!;
}

function findWorkflowInCore(module: CoreTypes.Module, funcName = 'orchestrate'): CoreTypes.Workflow {
  const func = module.decls.find(
    (decl): decl is CoreTypes.Func => decl.kind === 'Func' && decl.name === funcName
  );
  assert.ok(func, `Core IR 中应该存在函数 ${funcName}`);
  const workflow = func.body.statements.find(
    (stmt): stmt is CoreTypes.Workflow => stmt.kind === 'workflow'
  );
  assert.ok(workflow, 'Core IR 中应该包含 workflow 语句');
  return workflow!;
}

function lowerCoreFromSource(source: string): { ast: AstModule; core: CoreTypes.Module } {
  const ast = parseModuleFromSource(source);
  const core = lowerModule(ast);
  return { ast, core };
}

function workflowSource(moduleName: string, steps: string): string {
  return `
Module ${moduleName}.

Rule orchestrate, produce Result of Text with IO. It performs io:

  workflow:
${steps}
  .

`;
}

function runTypecheckFromSource(source: string): TypecheckDiagnostic[] {
  const { core } = lowerCoreFromSource(source);
  return typecheckModule(core);
}

async function emitWorkflowJava(
  source: string,
  moduleName: string,
  funcName = 'orchestrate'
): Promise<string> {
  const { core } = lowerCoreFromSource(source);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-dep-'));
  try {
    await emitJava(core, outDir);
    const relative = [...moduleName.split('.'), `${funcName}_fn.java`];
    const filePath = path.join(outDir, ...relative);
    return fs.readFileSync(filePath, 'utf8');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

describe('depends on DSL 全链路', () => {
  it('解析器与 Core IR 应保留显式依赖并支持并发 fan-out', () => {
    const moduleName = 'test.compiler.depends.ast_ir';
    const steps = `    step init:
      return ok of "init".

    step fanout_a depends on ["init"]:
      return ok of "fanout_a".

    step fanout_b depends on ["init"]:
      return ok of "fanout_b".
`;
    const source = workflowSource(moduleName, steps);
    const { ast, core } = lowerCoreFromSource(source);
    const workflowAst = findWorkflowInAst(ast);
    assert.deepEqual(workflowAst.steps[0]?.dependencies ?? [], []);
    assert.deepEqual(workflowAst.steps[1]?.dependencies ?? [], ['init']);
    assert.deepEqual(workflowAst.steps[2]?.dependencies ?? [], ['init']);

    const workflowCore = findWorkflowInCore(core);
    assert.deepEqual(workflowCore.steps[0]?.dependencies ?? [], []);
    assert.deepEqual(workflowCore.steps[1]?.dependencies ?? [], ['init']);
    assert.deepEqual(workflowCore.steps[2]?.dependencies ?? [], ['init']);
  });

  it('未声明 depends on 时应自动依赖上一个步骤以保持串行兼容', () => {
    const moduleName = 'test.compiler.depends.legacy';
    const steps = `    step first:
      return ok of "one".

    step second:
      return ok of "two".

    step third:
      return ok of "three".
`;
    const source = workflowSource(moduleName, steps);
    const { core } = lowerCoreFromSource(source);
    const workflow = findWorkflowInCore(core);
    assert.deepEqual(workflow.steps[0]?.dependencies ?? [], []);
    assert.deepEqual(workflow.steps[1]?.dependencies ?? [], ['first']);
    assert.deepEqual(workflow.steps[2]?.dependencies ?? [], ['second']);
  });

  it('合法 DAG 应在类型检查阶段通过', () => {
    const moduleName = 'test.compiler.depends.dag';
    const steps = `    step init:
      return ok of "init".

    step fanout_a depends on ["init"]:
      return ok of "fanout_a".

    step fanout_b depends on ["init"]:
      return ok of "fanout_b".

    step finalize depends on ["fanout_a", "fanout_b"]:
      return ok of "done".
`;
    const source = workflowSource(moduleName, steps);
    const diagnostics = runTypecheckFromSource(source);
    assert.equal(diagnostics.length, 0);
  });

  it('A→B→C→A 的循环依赖应触发 WORKFLOW_CIRCULAR_DEPENDENCY', () => {
    const moduleName = 'test.compiler.depends.cycle';
    const steps = `    step alpha depends on ["gamma"]:
      return ok of "alpha".

    step beta depends on ["alpha"]:
      return ok of "beta".

    step gamma depends on ["beta"]:
      return ok of "gamma".
`;
    const source = workflowSource(moduleName, steps);
    const diagnostics = runTypecheckFromSource(source);
    const codes = diagnostics.map(diag => diag.code);
    assert.equal(
      codes.includes(ErrorCode.WORKFLOW_CIRCULAR_DEPENDENCY),
      true,
      '应检测到循环依赖'
    );
  });

  it('步骤自依赖应视为循环并报告 WORKFLOW_CIRCULAR_DEPENDENCY', () => {
    const moduleName = 'test.compiler.depends.self';
    const steps = `    step solo depends on ["solo"]:
      return ok of "solo".
`;
    const source = workflowSource(moduleName, steps);
    const diagnostics = runTypecheckFromSource(source);
    assert.equal(
      diagnostics.some(diag => diag.code === ErrorCode.WORKFLOW_CIRCULAR_DEPENDENCY),
      true,
      '自依赖也应触发循环诊断'
    );
  });

  it('未知步骤依赖应触发 WORKFLOW_UNKNOWN_STEP_DEPENDENCY', () => {
    const moduleName = 'test.compiler.depends.unknown';
    const steps = `    step prepare:
      return ok of "ready".

    step worker depends on ["ghost"]:
      return ok of "work".
`;
    const source = workflowSource(moduleName, steps);
    const diagnostics = runTypecheckFromSource(source);
    assert.equal(
      diagnostics.some(diag => diag.code === ErrorCode.WORKFLOW_UNKNOWN_STEP_DEPENDENCY),
      true,
      '不存在的依赖名称必须报错'
    );
  });

  it('Emitter 应将依赖集合传入 registerTaskWithDependencies', async () => {
    const moduleName = 'test.compiler.depends.emitter';
    const steps = `    step init:
      return ok of "init".

    step parallel_a depends on ["init"]:
      return ok of "A".

    step parallel_b depends on ["init"]:
      return ok of "B".

    step merge depends on ["parallel_a", "parallel_b"]:
      return ok of "merged".
`;
    const source = workflowSource(moduleName, steps);
    const content = await emitWorkflowJava(source, moduleName);
    assert.equal(content.includes('registerTaskWithDependencies("init"'), true);
    assert.equal(content.includes('java.util.Collections.emptySet()'), true);
    assert.equal(content.includes('java.util.Arrays.asList("init")'), true);
    assert.equal(content.includes('java.util.Arrays.asList("parallel_a", "parallel_b")'), true);
  });
});
