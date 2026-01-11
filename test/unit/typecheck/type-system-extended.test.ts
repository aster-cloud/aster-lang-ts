/**
 * TypeSystem 扩展测试
 *
 * 覆盖 effect lattice、EffectVar 绑定冲突、list 字面推断、
 * declaredEffects/effectParams 列表比较以及 Workflow 子类型逻辑。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TypeSystem } from '../../../src/typecheck/type_system.js';
import { Effect } from '../../../src/config/semantic.js';
import type { Core } from '../../../src/types.js';

const makeFuncType = (override: Partial<Core.FuncType> = {}): Core.FuncType => ({
  kind: 'FuncType',
  params: [],
  ret: { kind: 'TypeName', name: 'Int' },
  ...override,
});

const makeWorkflow = (
  resultName: string,
  effect: Core.Type,
  options: { lazyBase?: boolean } = {}
): Core.TypeApp => {
  const args = [
    { kind: 'TypeName', name: resultName } satisfies Core.Type,
    effect,
  ] as readonly Core.Type[];
  if (!options.lazyBase) {
    return {
      kind: 'TypeApp',
      base: 'Workflow',
      args,
    };
  }
  let baseAccess = 0;
  return {
    kind: 'TypeApp',
    get base() {
      baseAccess += 1;
      return baseAccess === 2 ? 'NotWorkflow' : 'Workflow';
    },
    args,
  } as Core.TypeApp;
};

describe('TypeSystem effect lattice 与 EffectVar 绑定', () => {
  it('应该按照 PURE→CPU→IO→Workflow 偏序判断子类型', () => {
    // 验证 effectRank 处理 TypeName 与 TypeApp Workflow 的顺序
    const pure: Core.TypeName = { kind: 'TypeName', name: 'PURE' };
    const cpu: Core.TypeName = { kind: 'TypeName', name: 'CPU' };
    const io: Core.TypeName = { kind: 'TypeName', name: 'IO' };
    const workflowEffect: Core.TypeName = { kind: 'TypeName', name: 'Workflow' };
    const workflowType = makeWorkflow('Text', io);

    assert.ok(TypeSystem.isSubtype(pure, cpu));
    assert.ok(TypeSystem.isSubtype(cpu, io));
    assert.ok(TypeSystem.isSubtype(io, workflowEffect));
    assert.ok(TypeSystem.isSubtype(io, workflowType));
    assert.strictEqual(TypeSystem.isSubtype(workflowEffect, io), false);
    assert.strictEqual(TypeSystem.isSubtype(workflowType, pure), false);
  });

  it('应该拒绝 EffectVar 绑定到不同的 effect', () => {
    // 绑定 CPU 后，尝试再绑定 IO，触发 bindEffectVar 冲突路径
    const fx: Core.EffectVar = { kind: 'EffectVar', name: 'FX' };
    const bindings = new Map<string, Core.Type>();
    const cpu: Core.TypeName = { kind: 'TypeName', name: 'CPU' };
    const io: Core.TypeName = { kind: 'TypeName', name: 'IO' };

    assert.ok(TypeSystem.unify(fx, cpu, bindings));
    assert.deepStrictEqual(bindings.get('$effect:FX'), cpu);

    // 再次绑定相同 effect 应保持成功
    assert.ok(TypeSystem.unify(fx, cpu, bindings));

    // 换成不同 effect 应立即返回 false
    assert.strictEqual(TypeSystem.unify(fx, io, bindings), false);
  });
});

describe('TypeSystem.inferListElementType', () => {
  it('应该在所有元素类型一致时返回该类型', () => {
    // list 字面全部是 Int 时返回 Int
    const ints: Core.Expression[] = [
      { kind: 'Int', value: 1 },
      { kind: 'Int', value: 2 },
      { kind: 'Int', value: 3 },
    ];
    const inferred = TypeSystem.inferListElementType(ints);

    assert.deepStrictEqual(inferred, { kind: 'TypeName', name: 'Int' });
  });

  it('应该在元素类型不一致时退回 Unknown', () => {
    // list 字面混合 Int 与 Text 必须回退 Unknown
    const mixed: Core.Expression[] = [
      { kind: 'Int', value: 1 },
      { kind: 'String', value: 'oops' },
    ];
    const inferred = TypeSystem.inferListElementType(mixed);

    assert.deepStrictEqual(inferred, TypeSystem.unknown());
  });
});

describe('normalizeEffectList / effectListsEqual / stringListsEqual', () => {
  it('应该把空 declaredEffects 与 undefined 视为相等', () => {
    // normalizeEffectList 会把 undefined 转成空数组
    const withoutDeclared = makeFuncType();
    const withEmptyDeclared = makeFuncType({ declaredEffects: [] });

    assert.ok(TypeSystem.equals(withoutDeclared, withEmptyDeclared));
    assert.ok(TypeSystem.unify(withoutDeclared, withEmptyDeclared));
  });

  it('应该在 declaredEffects 长度不同时报错', () => {
    // effectListsEqual 遇到长度不同直接失败
    const singleEffect = makeFuncType({ declaredEffects: [Effect.IO] });
    const doubleEffect = makeFuncType({ declaredEffects: [Effect.IO, Effect.CPU] });

    assert.strictEqual(TypeSystem.equals(singleEffect, doubleEffect), false);
    assert.strictEqual(TypeSystem.unify(singleEffect, doubleEffect), false);
  });

  it('应该检测 declaredEffects 内容差异', () => {
    // 内容差异的 effect 列表应被视为不同
    const cpuEffect = makeFuncType({ declaredEffects: [Effect.CPU] });
    const pureEffect = makeFuncType({ declaredEffects: [Effect.PURE] });

    assert.strictEqual(TypeSystem.equals(cpuEffect, pureEffect), false);
  });

  it('应该在 effectParams 内容不同时时返回 false', () => {
    // stringListsEqual 需比较 effect 参数名称
    const effectF = makeFuncType({ effectParams: ['F'] });
    const effectG = makeFuncType({ effectParams: ['G'] });

    assert.strictEqual(TypeSystem.equals(effectF, effectG), false);
  });
});

describe('Workflow 子类型 effect row 检查', () => {
  it('应该在 result 一致且 effect row 是子类型时返回 true', () => {
    // Workflow<Text, CPU>（effect 较弱）是 Workflow<Text, IO> 的子类型
    const workflowCpu = makeWorkflow('Text', { kind: 'TypeName', name: 'CPU' }, { lazyBase: true });
    const workflowIo = makeWorkflow('Text', { kind: 'TypeName', name: 'IO' });

    assert.ok(TypeSystem.isSubtype(workflowCpu, workflowIo));
  });

  it('应该在 effect row 更强时返回 false', () => {
    // Workflow<Text, IO>（effect 较强）不能赋值给 Workflow<Text, CPU>
    const workflowCpu = makeWorkflow('Text', { kind: 'TypeName', name: 'CPU' });
    const workflowIo = makeWorkflow('Text', { kind: 'TypeName', name: 'IO' }, { lazyBase: true });

    assert.strictEqual(TypeSystem.isSubtype(workflowIo, workflowCpu), false);
  });
});
