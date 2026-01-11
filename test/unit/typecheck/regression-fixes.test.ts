/**
 * 回归测试：覆盖 typecheck 模块重构后修复的关键问题
 *
 * 本文件测试以下修复点：
 * 1. 重复符号检测 - defineSymbol 应报告 DUPLICATE_SYMBOL 错误
 * 2. 补偿效应推断 - workflow 步骤的 compensate 块效应应被合并
 * 3. 效应参数诊断 - 未声明的效应变量应触发 EFFECT_VAR_UNDECLARED
 * 4. KNOWN_SCALARS 扩展 - 内置标量与容器类型不应被误判为未声明的类型变量
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Core, Effect } from '../../../src/core/core_ir.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Core as CoreTypes, Span } from '../../../src/types.js';
import { SymbolTable } from '../../../src/typecheck/symbol_table.js';
import { DiagnosticBuilder } from '../../../src/typecheck/diagnostics.js';
import { defineSymbol, type TypecheckWalkerContext, type ModuleContext } from '../../../src/typecheck/context.js';

// 辅助函数：创建类型
const typeName = (name: string): CoreTypes.TypeName => Core.TypeName(name);
const resultType = (ok: CoreTypes.Type, err: CoreTypes.Type): CoreTypes.Result => Core.Result(ok, err);

// 辅助函数：创建 Span
const createSpan = (): Span => ({
  start: { line: 1, col: 1 },
  end: { line: 1, col: 10 },
});

// 辅助函数：创建基本的 ModuleContext
function createModuleContext(): ModuleContext {
  return {
    datas: new Map(),
    enums: new Map(),
    imports: new Map(),
    funcSignatures: new Map(),
    importedEffects: new Map(),
    moduleSearchPaths: [],
  };
}

// 辅助函数：创建 TypecheckWalkerContext
function createWalkerContext(): TypecheckWalkerContext {
  return {
    module: createModuleContext(),
    symbols: new SymbolTable(),
    diagnostics: new DiagnosticBuilder(),
  };
}

describe('回归测试：重复符号检测', () => {
  it('defineSymbol 应在同一作用域重复定义时报告 DUPLICATE_SYMBOL 错误', () => {
    const context = createWalkerContext();
    const span = createSpan();

    // 第一次定义应成功
    defineSymbol(context, 'myVar', typeName('Int'), 'var', span);
    assert.ok(context.symbols.lookup('myVar'), '第一次定义应成功');
    assert.strictEqual(context.diagnostics.getDiagnostics().length, 0, '无错误');

    // 第二次定义同名符号应报告错误
    defineSymbol(context, 'myVar', typeName('Text'), 'var', span);

    const diagnostics = context.diagnostics.getDiagnostics();
    assert.strictEqual(diagnostics.length, 1, '应产生一个诊断');
    assert.strictEqual(diagnostics[0]?.code, ErrorCode.DUPLICATE_SYMBOL, '应为 DUPLICATE_SYMBOL 错误');
    assert.strictEqual(diagnostics[0]?.severity, 'error');
  });

  it('不同作用域定义同名符号不应报错（遮蔽场景）', () => {
    const context = createWalkerContext();
    const span = createSpan();

    // 外层定义
    defineSymbol(context, 'value', typeName('Int'), 'var', span);

    // 进入新作用域
    context.symbols.enterScope('function');

    // 内层定义同名符号（遮蔽，非重复）
    defineSymbol(context, 'value', typeName('Text'), 'var', span);

    const diagnostics = context.diagnostics.getDiagnostics();
    assert.strictEqual(diagnostics.length, 0, '遮蔽不应报错');

    // 内层符号应为 Text 类型
    const inner = context.symbols.lookupInCurrentScope('value');
    assert.ok(inner, '内层符号应存在');
    assert.strictEqual((inner.type as CoreTypes.TypeName).name, 'Text');
  });

  it('通过完整类型检查流程验证重复参数定义', () => {
    // 构造一个函数有两个同名参数的场景
    const func: CoreTypes.Func = {
      kind: 'Func',
      name: 'badFunc',
      typeParams: [],
      params: [
        { name: 'x', type: typeName('Int'), annotations: [] },
        { name: 'x', type: typeName('Text'), annotations: [] }, // 重复参数名
      ],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Int'),
      body: {
        kind: 'Block',
        statements: [
          { kind: 'Return', expr: Core.Int(0) },
        ],
      },
    };

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.duplicate_param',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);
    assert.ok(
      diagnostics.some(d => d.code === ErrorCode.DUPLICATE_SYMBOL),
      '重复参数名应触发 DUPLICATE_SYMBOL 错误'
    );
  });
});

describe('回归测试：补偿效应推断', () => {
  it('workflow 效应应包含 compensate 块的效应', () => {
    // 创建一个 workflow，其中 step body 是 pure，但 compensate 调用了 io 函数
    const step: CoreTypes.Step = {
      kind: 'step',
      name: 'step1',
      dependencies: [],
      effectCaps: [],
      body: {
        kind: 'Block',
        statements: [
          // 纯计算，无 IO
          { kind: 'Return', expr: Core.Ok(Core.Int(42)) },
        ],
      },
      compensate: {
        kind: 'Block',
        statements: [
          // compensate 调用 IO 函数（使用标准 IO 前缀格式）
          Core.Let('_cleanup', Core.Call(Core.Name('IO.cleanup'), [])),
          { kind: 'Return', expr: Core.Ok(Core.Null()) },
        ],
      },
    };

    const workflow: CoreTypes.Workflow = {
      kind: 'workflow',
      steps: [step],
      effectCaps: [],
    };

    const func: CoreTypes.Func = {
      kind: 'Func',
      name: 'workflowWithCompensate',
      typeParams: [],
      params: [],
      effects: [Effect.IO], // 声明 IO 效应
      effectCaps: [],
      effectCapsExplicit: false,
      ret: {
        kind: 'TypeApp',
        base: 'Workflow',
        args: [resultType(typeName('Int'), typeName('Text')), typeName('IO')],
      },
      body: {
        kind: 'Block',
        statements: [workflow],
      },
    };

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.compensate_effect',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);

    // 不应有 EFF_SUPERFLUOUS_IO 警告，因为 compensate 块确实有 IO 效应
    const superfluousIO = diagnostics.find(d => d.code === ErrorCode.EFF_SUPERFLUOUS_IO);
    assert.strictEqual(
      superfluousIO,
      undefined,
      'compensate 块的 IO 效应应被正确识别，不应报告多余的 @io 声明'
    );
  });

  it('compensate 块的 IO 效应应触发 EFF_MISSING_IO（正向断言）', () => {
    // 正向断言：如果 compensate 有 IO 但函数未声明 IO，应报错
    // 这证明 compensate 效应确实被合并到函数效应推断中
    const step: CoreTypes.Step = {
      kind: 'step',
      name: 'stepWithIOCompensate',
      dependencies: [],
      effectCaps: [],
      body: {
        kind: 'Block',
        statements: [
          // 纯计算，无 IO
          { kind: 'Return', expr: Core.Ok(Core.Int(42)) },
        ],
      },
      compensate: {
        kind: 'Block',
        statements: [
          // compensate 调用 IO 函数
          Core.Let('_cleanup', Core.Call(Core.Name('IO.cleanup'), [])),
          { kind: 'Return', expr: Core.Ok(Core.Null()) },
        ],
      },
    };

    const workflow: CoreTypes.Workflow = {
      kind: 'workflow',
      steps: [step],
      effectCaps: [],
    };

    const func: CoreTypes.Func = {
      kind: 'Func',
      name: 'workflowMissingIODeclaration',
      typeParams: [],
      params: [],
      effects: [], // 故意不声明 IO 效应
      effectCaps: [],
      effectCapsExplicit: false,
      ret: {
        kind: 'TypeApp',
        base: 'Workflow',
        args: [resultType(typeName('Int'), typeName('Text')), typeName('Unit')],
      },
      body: {
        kind: 'Block',
        statements: [workflow],
      },
    };

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.compensate_effect_positive',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);

    // 正向断言：应有 EFF_MISSING_IO 错误，证明 compensate 的 IO 效应被正确检测
    assert.ok(
      diagnostics.some(d => d.code === ErrorCode.EFF_MISSING_IO),
      'compensate 块的 IO 效应应被检测，触发 EFF_MISSING_IO 错误（正向证明效应合并生效）'
    );
  });

  it('缺少 compensate 的步骤在有副作用时应发出警告', () => {
    const step: CoreTypes.Step = {
      kind: 'step',
      name: 'dangerousStep',
      dependencies: [],
      effectCaps: [],
      body: {
        kind: 'Block',
        statements: [
          // 调用 IO 函数（使用标准 IO 前缀格式）
          Core.Let('result', Core.Call(Core.Name('IO.write'), [Core.String('data')])),
          { kind: 'Return', expr: Core.Ok(Core.Int(1)) },
        ],
      },
      // 无 compensate 块
    };

    const workflow: CoreTypes.Workflow = {
      kind: 'workflow',
      steps: [step],
      effectCaps: [],
    };

    const func: CoreTypes.Func = {
      kind: 'Func',
      name: 'workflowWithoutCompensate',
      typeParams: [],
      params: [],
      effects: [Effect.IO],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: {
        kind: 'TypeApp',
        base: 'Workflow',
        args: [resultType(typeName('Int'), typeName('Text')), typeName('IO')],
      },
      body: {
        kind: 'Block',
        statements: [workflow],
      },
    };

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.missing_compensate',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);

    // 应有 WORKFLOW_COMPENSATE_MISSING 警告
    assert.ok(
      diagnostics.some(d => d.code === ErrorCode.WORKFLOW_COMPENSATE_MISSING),
      '有 IO 副作用但无 compensate 的步骤应触发警告'
    );
  });
});

describe('回归测试：效应参数诊断', () => {
  it('未声明的效应变量应触发 EFFECT_VAR_UNDECLARED', () => {
    // 创建一个使用了未声明效应变量的函数
    // 通过 declaredEffects 在函数上直接使用一个未声明的效应变量
    const effectVar: CoreTypes.EffectVar = { kind: 'EffectVar', name: 'E' };
    const func = {
      kind: 'Func',
      name: 'funcWithUndeclaredEffect',
      typeParams: [],
      effectParams: [], // 空的效应参数列表
      params: [],
      effects: [],
      declaredEffects: [effectVar], // 使用了效应变量 E，但未在 effectParams 中声明
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Unit'),
      body: {
        kind: 'Block',
        statements: [
          { kind: 'Return', expr: Core.Null() },
        ],
      },
    } as CoreTypes.Func;

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.undeclared_effect_var',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);
    assert.ok(
      diagnostics.some(d => d.code === ErrorCode.EFFECT_VAR_UNDECLARED),
      '使用未声明的效应变量应触发 EFFECT_VAR_UNDECLARED'
    );
  });

  it('已声明的效应变量不应报错', () => {
    // 创建一个正确声明了效应变量的函数
    const effectVar: CoreTypes.EffectVar = { kind: 'EffectVar', name: 'E' };
    const func = {
      kind: 'Func',
      name: 'funcWithDeclaredEffect',
      typeParams: [],
      effectParams: ['E'], // 声明效应参数 E
      params: [],
      effects: [],
      declaredEffects: [effectVar], // 函数自身使用 E
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Unit'),
      body: {
        kind: 'Block',
        statements: [
          { kind: 'Return', expr: Core.Null() },
        ],
      },
    } as CoreTypes.Func;

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.declared_effect_var',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);
    assert.ok(
      !diagnostics.some(d => d.code === ErrorCode.EFFECT_VAR_UNDECLARED),
      '已声明的效应变量不应触发 EFFECT_VAR_UNDECLARED'
    );
  });

  it('声明但未使用的效应变量应触发警告', () => {
    const func = {
      kind: 'Func',
      name: 'funcWithUnusedEffect',
      typeParams: [],
      effectParams: ['E'], // 声明效应参数 E，但未使用
      params: [
        { name: 'x', type: typeName('Int'), annotations: [] },
      ],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Int'),
      body: {
        kind: 'Block',
        statements: [
          { kind: 'Return', expr: Core.Name('x') },
        ],
      },
    } as CoreTypes.Func;

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.unused_effect_var',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);
    assert.ok(
      diagnostics.some(d => d.code === ErrorCode.TYPE_PARAM_UNUSED),
      '声明但未使用的效应变量应触发 TYPE_PARAM_UNUSED 警告'
    );
  });
});

describe('回归测试：KNOWN_SCALARS 扩展', () => {
  it('使用 Long/Double/Unit 类型不应触发 TYPEVAR_LIKE_UNDECLARED', () => {
    const func: CoreTypes.Func = {
      kind: 'Func',
      name: 'useBuiltinTypes',
      typeParams: [],
      params: [
        { name: 'a', type: typeName('Long'), annotations: [] },
        { name: 'b', type: typeName('Double'), annotations: [] },
      ],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Unit'),
      body: {
        kind: 'Block',
        statements: [
          { kind: 'Return', expr: Core.Null() },
        ],
      },
    };

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.known_scalars',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);
    assert.ok(
      !diagnostics.some(d => d.code === ErrorCode.TYPEVAR_LIKE_UNDECLARED),
      'Long/Double/Unit 是内置类型，不应被误认为未声明的类型变量'
    );
  });

  it('使用 Result/Option/List/Map/Set/Workflow 类型不应触发 TYPEVAR_LIKE_UNDECLARED', () => {
    // 构造 Map<Text, Int> 类型
    const mapType: CoreTypes.TypeApp = { kind: 'TypeApp', base: 'Map', args: [typeName('Text'), typeName('Int')] };
    // 构造 Set<Int> 类型
    const setType: CoreTypes.TypeApp = { kind: 'TypeApp', base: 'Set', args: [typeName('Int')] };
    // 构造 Workflow<Result<Int, Text>, Unit> 类型（第二个参数是效应标记，使用 Unit 避免效应类型检查）
    const workflowType: CoreTypes.TypeApp = {
      kind: 'TypeApp',
      base: 'Workflow',
      args: [resultType(typeName('Int'), typeName('Text')), typeName('Unit')],
    };

    const func: CoreTypes.Func = {
      kind: 'Func',
      name: 'useContainerTypes',
      typeParams: [],
      params: [
        { name: 'r', type: resultType(typeName('Int'), typeName('Text')), annotations: [] },
        { name: 'o', type: Core.Option(typeName('Int')), annotations: [] },
        { name: 'l', type: Core.List(typeName('Int')), annotations: [] },
        { name: 'm', type: mapType, annotations: [] },
        { name: 's', type: setType, annotations: [] },
        { name: 'w', type: workflowType, annotations: [] },
      ],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Unit'),
      body: {
        kind: 'Block',
        statements: [
          { kind: 'Return', expr: Core.Null() },
        ],
      },
    };

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.container_types',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);
    assert.ok(
      !diagnostics.some(d => d.code === ErrorCode.TYPEVAR_LIKE_UNDECLARED),
      'Result/Option/List/Map/Set/Workflow 容器类型不应被误认为未声明的类型变量'
    );
  });

  it('未知类型名应触发 TYPEVAR_LIKE_UNDECLARED（负例验证）', () => {
    // 使用一个未在 KNOWN_SCALARS 中且未定义的类型名
    const func: CoreTypes.Func = {
      kind: 'Func',
      name: 'useUnknownType',
      typeParams: [],
      params: [
        { name: 'x', type: typeName('UnknownCustomType'), annotations: [] },
      ],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Unit'),
      body: {
        kind: 'Block',
        statements: [
          { kind: 'Return', expr: Core.Null() },
        ],
      },
    };

    const mod: CoreTypes.Module = {
      kind: 'Module',
      name: 'test.regression.unknown_type',
      decls: [func],
    };

    const diagnostics = typecheckModule(mod);
    assert.ok(
      diagnostics.some(d => d.code === ErrorCode.TYPEVAR_LIKE_UNDECLARED),
      '未知类型名 UnknownCustomType 应触发 TYPEVAR_LIKE_UNDECLARED 错误'
    );
  });
});
