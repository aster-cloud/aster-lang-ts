import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Effect } from '../../../src/types.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { ConfigService } from '../../../src/config/config-service.js';
import type { Core, Origin } from '../../../src/types.js';

type InferEffectsFn = typeof import('../../../src/effects/effect_inference.js')['inferEffects'];

let inferEffects: InferEffectsFn;
let tempDir = '';
let defaultConfigPath = '';

const UNIT_TYPE: Core.Type = { kind: 'TypeName', name: 'Unit' };
const NULL_EXPR: Core.Null = { kind: 'Null' };
type Diagnostic = ReturnType<InferEffectsFn>[number];

async function importEffectInference(cacheBust: string): Promise<{ inferEffects: InferEffectsFn }>
{
  const url = new URL('../../../src/effects/effect_inference.js', import.meta.url);
  url.searchParams.set('cacheBust', cacheBust);
  return import(url.href) as Promise<{ inferEffects: InferEffectsFn }>;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-effects-'));
  const configPath = path.join(tempDir, 'effects.json');
  const configContent = {
    patterns: {
      io: {
        http: ['IO.', 'AuthRepo.', 'ProfileSvc.', 'FeedSvc.', 'Http.'],
        sql: ['Db.'],
        files: [],
        secrets: ['UUID.randomUUID'],
        time: [],
      },
      cpu: ['CpuTask.', 'Analytics.'],
      ai: [],
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(configContent), 'utf8');
  process.env.ASTER_EFFECT_CONFIG = configPath;
  defaultConfigPath = configPath;
  ConfigService.resetForTesting();
  const mod = await import('../../../src/effects/effect_inference.js');
  inferEffects = mod.inferEffects;
});

after(() => {
  ConfigService.resetForTesting();
  delete process.env.ASTER_EFFECT_CONFIG;
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeOrigin(label: string): Origin {
  return {
    file: `${label}.aster`,
    start: { line: 1, col: 1 },
    end: { line: 1, col: 10 },
  };
}

function makeName(name: string): Core.Name {
  return { kind: 'Name', name };
}

function makeCall(name: string, args: Core.Expression[] = []): Core.Call {
  return {
    kind: 'Call',
    target: makeName(name),
    args,
    origin: makeOrigin(name),
  };
}

function makeReturn(expr: Core.Expression): Core.Return {
  return { kind: 'Return', expr };
}

function makeLet(name: string, expr: Core.Expression): Core.Let {
  return { kind: 'Let', name, expr };
}

function makeBlock(statements: Core.Statement[]): Core.Block {
  return { kind: 'Block', statements };
}

function makeLambda(body: Core.Block): Core.Lambda {
  return {
    kind: 'Lambda',
    params: [],
    retType: UNIT_TYPE,
    ret: UNIT_TYPE,
    body,
  };
}

interface FuncOptions {
  name: string;
  declaredEffects?: ReadonlyArray<Effect>;
  body?: Core.Block;
}

function makeFunc({ name, declaredEffects = [], body }: FuncOptions): Core.Func {
  return {
    kind: 'Func',
    name,
    typeParams: [],
    params: [],
    effects: declaredEffects,
    effectCaps: [],
    effectCapsExplicit: false,
    ret: UNIT_TYPE,
    body: body ?? makeBlock([makeReturn(NULL_EXPR)]),
  };
}

function buildModule(funcs: Core.Func[]): Core.Module {
  return {
    kind: 'Module',
    name: 'test.effect.inference',
    decls: funcs,
  };
}

function runInference(funcs: Core.Func[], imports?: Map<string, string>): ReturnType<InferEffectsFn> {
  const options = imports && imports.size > 0 ? { imports } : undefined;
  return inferEffects(buildModule(funcs), options);
}

function matchesFuncDiagnostic(diag: Diagnostic, code: ErrorCode, funcName: string): boolean {
  if (diag.code !== code) return false;
  const payload = diag.data as Record<string, unknown> | undefined;
  if (!payload) return false;
  const target = payload.func;
  return typeof target === 'string' && target === funcName;
}

function findDiagnostic(
  diagnostics: ReturnType<InferEffectsFn>,
  code: ErrorCode,
  funcName: string
): boolean {
  return diagnostics.some(d => matchesFuncDiagnostic(d, code, funcName));
}

describe('effect_inference 推断', () => {
  it('内置 IO 调用缺失声明应报错', () => {
    const fetcher = makeFunc({
      name: 'fetchData',
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const diagnostics = runInference([fetcher]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'fetchData'));
  });

  it('内置 CPU 调用缺失声明应报错', () => {
    const compute = makeFunc({
      name: 'heavyCompute',
      body: makeBlock([makeReturn(makeCall('CpuTask.run'))]),
    });
    const diagnostics = runInference([compute]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_CPU, 'heavyCompute'));
  });

  it('导入别名指向内置 IO 前缀应被识别', () => {
    const aliasFunc = makeFunc({
      name: 'aliasCall',
      body: makeBlock([makeReturn(makeCall('Api.fetch'))]),
    });
    const imports = new Map<string, string>([['Api', 'Http']]);
    const diagnostics = runInference([aliasFunc], imports);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'aliasCall'));
  });

  it('导入别名指向模块内函数应生成调用约束', () => {
    const helper = makeFunc({
      name: 'Helper.process',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const caller = makeFunc({
      name: 'runTask',
      body: makeBlock([makeReturn(makeCall('Util.process'))]),
    });
    const imports = new Map<string, string>([['Util', 'Helper']]);
    const diagnostics = runInference([helper, caller], imports);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'runTask'));
    assert.equal(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'Helper.process'), false);
  });

  it('直接调用应继承被调函数的效果', () => {
    const worker = makeFunc({
      name: 'worker',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const entry = makeFunc({
      name: 'entry',
      body: makeBlock([makeReturn(makeCall('worker'))]),
    });
    const diagnostics = runInference([worker, entry]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'entry'));
    assert.equal(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'worker'), false);
  });

  it('链式调用应逐级传播效果', () => {
    const source = makeFunc({
      name: 'source',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const middle = makeFunc({
      name: 'middle',
      body: makeBlock([makeReturn(makeCall('source'))]),
    });
    const sink = makeFunc({
      name: 'sink',
      body: makeBlock([makeReturn(makeCall('middle'))]),
    });
    const diagnostics = runInference([source, middle, sink]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'middle'));
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'sink'));
  });

  it('相互递归应在强连通分量内收敛效果', () => {
    const alpha = makeFunc({
      name: 'alpha',
      body: makeBlock([
        makeLet('_tmp', makeCall('Http.get')),
        makeReturn(makeCall('beta')),
      ]),
    });
    const beta = makeFunc({
      name: 'beta',
      body: makeBlock([makeReturn(makeCall('alpha'))]),
    });
    const diagnostics = runInference([alpha, beta]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'alpha'));
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'beta'));
  });

  it('SCC 外的调用者应按拓扑顺序继承效果', () => {
    const alpha = makeFunc({
      name: 'alpha',
      body: makeBlock([
        makeLet('_tmp', makeCall('Http.get')),
        makeReturn(makeCall('beta')),
      ]),
    });
    const beta = makeFunc({
      name: 'beta',
      body: makeBlock([makeReturn(makeCall('alpha'))]),
    });
    const gamma = makeFunc({
      name: 'gamma',
      body: makeBlock([makeReturn(makeCall('alpha'))]),
    });
    const delta = makeFunc({
      name: 'delta',
      body: makeBlock([makeReturn(makeCall('gamma'))]),
    });
    const diagnostics = runInference([alpha, beta, gamma, delta]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'gamma'));
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'delta'));
  });

  it('自递归函数应在自环中收敛效果', () => {
    const loop = makeFunc({
      name: 'loop',
      body: makeBlock([
        makeLet('_tmp', makeCall('Http.get')),
        makeReturn(makeCall('loop')),
      ]),
    });
    const diagnostics = runInference([loop]);
    const ioErrors = diagnostics.filter(d => matchesFuncDiagnostic(d, ErrorCode.EFF_INFER_MISSING_IO, 'loop'));
    assert.equal(ioErrors.length, 1);
  });

  it('完全声明效果的函数不应产生诊断', () => {
    const safe = makeFunc({
      name: 'safeFetch',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const diagnostics = runInference([safe]);
    assert.equal(diagnostics.length, 0);
  });

  it('冗余效果声明应产生警告', () => {
    const redundant = makeFunc({
      name: 'redundantIo',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(NULL_EXPR)]),
    });
    const diagnostics = runInference([redundant]);
    assert.ok(diagnostics.some(d => matchesFuncDiagnostic(d, ErrorCode.EFF_INFER_REDUNDANT_IO, 'redundantIo')));
  });

  it('声明 @cpu 但调用链引入 IO 应报告缺失 IO 与冗余 CPU', () => {
    const provider = makeFunc({
      name: 'ioProvider',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const cpuWrapper = makeFunc({
      name: 'cpuPipeline',
      declaredEffects: [Effect.CPU],
      body: makeBlock([makeReturn(makeCall('ioProvider'))]),
    });

    const diagnostics = runInference([provider, cpuWrapper]);
    const wrapperDiags = diagnostics.filter(d => matchesFuncDiagnostic(d, d.code, 'cpuPipeline'));
    const codes = wrapperDiags.map(d => d.code);

    assert.deepStrictEqual(codes, [ErrorCode.EFF_INFER_MISSING_IO, ErrorCode.EFF_INFER_REDUNDANT_CPU_WITH_IO]);
  });

  it('未绑定的效应变量应报 E211', () => {
    const poly = makeFunc({ name: 'polyVar' });
    (poly as any).effectParams = ['E'];
    (poly as any).declaredEffects = [{ kind: 'EffectVar', name: 'E' } as Core.EffectVar];

    const diagnostics = runInference([poly]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFFECT_VAR_UNRESOLVED, 'polyVar'));
  });

  it('效应变量绑定到传递效果时不报未解析错误', () => {
    const callee = makeFunc({
      name: 'ioProvider',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const wrapper = makeFunc({ name: 'wrapper' });
    (wrapper as any).effectParams = ['E'];
    (wrapper as any).declaredEffects = [{ kind: 'EffectVar', name: 'E' } as Core.EffectVar];
    (wrapper as any).body = makeBlock([makeReturn(makeCall('ioProvider'))]);

    const diagnostics = runInference([callee, wrapper]);
    assert.equal(findDiagnostic(diagnostics, ErrorCode.EFFECT_VAR_UNRESOLVED, 'wrapper'), false);
  });

  it('菱形拓扑应同时传播 CPU 与 IO', () => {
    const ioLeaf = makeFunc({
      name: 'network.fetch',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const cpuLeaf = makeFunc({
      name: 'analytics.compute',
      declaredEffects: [Effect.CPU],
      body: makeBlock([makeReturn(makeCall('CpuTask.run'))]),
    });
    const left = makeFunc({
      name: 'leftBranch',
      body: makeBlock([makeReturn(makeCall('network.fetch'))]),
    });
    const right = makeFunc({
      name: 'rightBranch',
      body: makeBlock([makeReturn(makeCall('analytics.compute'))]),
    });
    const entry = makeFunc({
      name: 'diamondEntry',
      body: makeBlock([
        makeLet('_io', makeCall('leftBranch')),
        makeLet('_cpu', makeCall('rightBranch')),
        makeReturn(NULL_EXPR),
      ]),
    });

    const diagnostics = runInference([ioLeaf, cpuLeaf, left, right, entry]);
    const entryDiags = diagnostics.filter(d => matchesFuncDiagnostic(d, d.code, 'diamondEntry'));
    const codes = entryDiags.map(d => d.code);

    assert.deepStrictEqual(codes, [ErrorCode.EFF_INFER_MISSING_IO, ErrorCode.EFF_INFER_MISSING_CPU]);
  });

  it('导入别名重映射 CPU 前缀应识别 CPU 效果', () => {
    const compute = makeFunc({
      name: 'cpuAliasCaller',
      body: makeBlock([makeReturn(makeCall('Perf.runner.execute'))]),
    });
    const imports = new Map<string, string>([['Perf', 'Analytics']]);

    const diagnostics = runInference([compute], imports);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_CPU, 'cpuAliasCaller'));
  });

  it('多级导入别名应继承被调函数效果', () => {
    const provider = makeFunc({
      name: 'Remote.Service.fetch',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeReturn(makeCall('Http.get'))]),
    });
    const caller = makeFunc({
      name: 'loadViaAlias',
      body: makeBlock([makeReturn(makeCall('Api.Service.fetch'))]),
    });
    const imports = new Map<string, string>([['Api', 'Remote']]);

    const diagnostics = runInference([provider, caller], imports);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'loadViaAlias'));
  });

  it('配置重置后应识别最新效果配置', { concurrency: false }, async () => {
    const firstConfigPath = path.join(tempDir, 'effects-cache-first.json');
    const secondConfigPath = path.join(tempDir, 'effects-cache-second.json');
    fs.writeFileSync(
      firstConfigPath,
      JSON.stringify({
        patterns: {
          io: {
            http: ['Http.'],
            sql: [],
            files: [],
            secrets: [],
            time: [],
          },
          cpu: [],
          ai: [],
        },
      }),
      'utf8'
    );
    fs.writeFileSync(
      secondConfigPath,
      JSON.stringify({
        patterns: {
          io: {
            http: ['ExternalIO.'],
            sql: [],
            files: [],
            secrets: [],
            time: [],
          },
          cpu: ['HeavyCpu.'],
          ai: [],
        },
      }),
      'utf8'
    );

    const originalConfig = process.env.ASTER_EFFECT_CONFIG;

    try {
      process.env.ASTER_EFFECT_CONFIG = firstConfigPath;
      ConfigService.resetForTesting();
      const firstModule = await importEffectInference(`cache-first-${Date.now()}`);
      const firstDiagnostics = firstModule.inferEffects(
        buildModule([
          makeFunc({
            name: 'heavyComputeBefore',
            body: makeBlock([makeReturn(makeCall('HeavyCpu.run'))]),
          }),
        ])
      );
      assert.equal(
        findDiagnostic(firstDiagnostics, ErrorCode.EFF_INFER_MISSING_CPU, 'heavyComputeBefore'),
        false
      );

      process.env.ASTER_EFFECT_CONFIG = secondConfigPath;
      ConfigService.resetForTesting();
      const secondModule = await importEffectInference(`cache-second-${Date.now()}`);
      const updatedDiagnostics = secondModule.inferEffects(
        buildModule([
          makeFunc({
            name: 'externalProbe',
            body: makeBlock([makeReturn(makeCall('ExternalIO.fetch'))]),
          }),
          makeFunc({
            name: 'heavyComputeAfter',
            body: makeBlock([makeReturn(makeCall('HeavyCpu.run'))]),
          }),
        ])
      );
      assert.equal(
        findDiagnostic(updatedDiagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'externalProbe'),
        true
      );
      assert.equal(
        findDiagnostic(updatedDiagnostics, ErrorCode.EFF_INFER_MISSING_CPU, 'heavyComputeAfter'),
        true
      );
    } finally {
      process.env.ASTER_EFFECT_CONFIG = originalConfig ?? defaultConfigPath;
      ConfigService.resetForTesting();
    }
  });

  it('冗余效果诊断输出顺序应稳定', () => {
    const redundantBoth = makeFunc({
      name: 'redundantBoth',
      declaredEffects: [Effect.IO, Effect.CPU],
      body: makeBlock([makeReturn(NULL_EXPR)]),
    });

    const diagnostics = runInference([redundantBoth]);
    const relevant = diagnostics.filter(d => d.data && (d.data as Record<string, unknown>).func === 'redundantBoth');
    const codes = relevant.map(d => d.code);

    assert.deepStrictEqual(codes, [ErrorCode.EFF_INFER_REDUNDANT_IO, ErrorCode.EFF_INFER_REDUNDANT_CPU]);
  });

  it('Lambda body 的 IO 效应应传播到外层函数', () => {
    // Lambda body 调用 Http.get (IO)
    const lambdaBody = makeBlock([makeReturn(makeCall('Http.get'))]);
    const lambda = makeLambda(lambdaBody);

    // 外层函数定义 Lambda 但未声明 IO 效应
    const withLambda = makeFunc({
      name: 'withLambda',
      body: makeBlock([makeLet('f', lambda), makeReturn(NULL_EXPR)]),
    });

    const diagnostics = runInference([withLambda]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'withLambda'));
  });

  it('Lambda body 的 CPU 效应应传播到外层函数', () => {
    // Lambda body 调用 CpuTask.run (CPU)
    const lambdaBody = makeBlock([makeReturn(makeCall('CpuTask.run'))]);
    const lambda = makeLambda(lambdaBody);

    // 外层函数定义 Lambda 但未声明 CPU 效应
    const withLambda = makeFunc({
      name: 'withLambda',
      body: makeBlock([makeLet('f', lambda), makeReturn(NULL_EXPR)]),
    });

    const diagnostics = runInference([withLambda]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_CPU, 'withLambda'));
  });

  it('嵌套 Lambda 的效应应传播到最外层函数', () => {
    // 内层 Lambda 调用 Http.get
    const innerLambdaBody = makeBlock([makeReturn(makeCall('Http.get'))]);
    const innerLambda = makeLambda(innerLambdaBody);

    // 外层 Lambda 包含内层 Lambda
    const outerLambdaBody = makeBlock([makeLet('inner', innerLambda), makeReturn(NULL_EXPR)]);
    const outerLambda = makeLambda(outerLambdaBody);

    // 最外层函数定义嵌套 Lambda 但未声明 IO 效应
    const withNestedLambda = makeFunc({
      name: 'withNestedLambda',
      body: makeBlock([makeLet('outer', outerLambda), makeReturn(NULL_EXPR)]),
    });

    const diagnostics = runInference([withNestedLambda]);
    assert.ok(findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'withNestedLambda'));
  });

  it('声明了 IO 效应的函数不应对 Lambda 的 IO 调用报错', () => {
    // Lambda body 调用 Http.get
    const lambdaBody = makeBlock([makeReturn(makeCall('Http.get'))]);
    const lambda = makeLambda(lambdaBody);

    // 外层函数已声明 IO 效应
    const withLambda = makeFunc({
      name: 'withLambda',
      declaredEffects: [Effect.IO],
      body: makeBlock([makeLet('f', lambda), makeReturn(NULL_EXPR)]),
    });

    const diagnostics = runInference([withLambda]);
    assert.ok(!findDiagnostic(diagnostics, ErrorCode.EFF_INFER_MISSING_IO, 'withLambda'));
  });
});
