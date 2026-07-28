/**
 * `collectEffects` 的前缀注入（issue #88）。
 *
 * **缺陷**：`typecheck/effects.ts` 读的是 `pure.ts` 的**硬编码常量**，而
 * `effects/effect_inference.ts` 早已走 `getIOPrefixes()` 读配置——同一份用户自定义
 * effect 配置在两条路径上结果不一致，配置对 typecheck 侧完全不生效。
 *
 * **为什么用注入而不是直接 import 配置**：`browser.ts:134` 直接
 * `import { checkEffects } from './effects.js'`，而读配置的 `typecheck/utils.ts`
 * 静态引用了 `node:module` / `node:path`。effects.ts 一旦 import 它，Node 内置模块
 * 就会被拉进浏览器 bundle 闭包——`pure.ts` 头注释（R15）明确记载：打包器会看到该引用，
 * **即使它被包在 try/catch 里**。`verify-browser-entry` 守卫会因此红灯。
 *
 * 所以前缀由调用方注入：Node 入口（`module.ts`）传配置值，浏览器入口不传、
 * 回落 `pure.ts` 内置默认值。本测试直接验证这个契约。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectEffects } from '../../../src/typecheck/effects.js';
import type { ModuleContext } from '../../../src/typecheck/context.js';
import type { Core } from '../../../src/types.js';

function baseContext(): ModuleContext {
  return {
    datas: new Map(),
    enums: new Map(),
    imports: new Map(),
    funcSignatures: new Map(),
    importedEffects: new Map(),
    moduleSearchPaths: [],
  };
}

function blockCalling(name: string): Core.Block {
  const call: Core.Call = {
    kind: 'Call',
    target: { kind: 'Name', name } as Core.Name,
    args: [],
  } as Core.Call;
  return { kind: 'Block', statements: [{ kind: 'Return', expr: call }] } as unknown as Core.Block;
}

describe('collectEffects 前缀注入（issue #88）', () => {
  it('注入自定义 IO 前缀后，该调用被识别为 io', () => {
    const block = blockCalling('MyCustomIo.fetch');

    // 不注入：自定义前缀不在 pure.ts 内置默认里 → 识别不出效果
    assert.deepEqual([...collectEffects(baseContext(), block)], [],
      '未注入时不应识别自定义前缀（这正是修复前的行为）');

    // 注入：配置驱动的前缀生效
    const ctx: ModuleContext = {
      ...baseContext(),
      effectPrefixes: { io: ['MyCustomIo.'], cpu: [] },
    };
    assert.deepEqual([...collectEffects(ctx, block)], ['io'],
      '注入自定义 IO 前缀后必须识别为 io');
  });

  it('注入自定义 CPU 前缀同样生效', () => {
    const ctx: ModuleContext = {
      ...baseContext(),
      effectPrefixes: { io: [], cpu: ['MyCpu.'] },
    };
    assert.deepEqual([...collectEffects(ctx, blockCalling('MyCpu.crunch'))], ['cpu']);
  });

  it('反向守卫：不注入时回落内置默认值，Http. 仍被识别为 io', () => {
    // 浏览器路径就是这条——effects.ts 保持 browser-safe，仍有可用的默认行为
    assert.deepEqual([...collectEffects(baseContext(), blockCalling('Http.get'))], ['io'],
      '未注入时必须回落 pure.ts 内置默认前缀，而不是什么都识别不出');
  });

  it('反向守卫：注入的前缀是**替换**而非追加内置默认', () => {
    // 契约明确：注入什么就用什么。调用方（module.ts）负责传入完整集合，
    // 避免"注入了却仍受内置默认影响"这种难以推理的半生效状态。
    const ctx: ModuleContext = {
      ...baseContext(),
      effectPrefixes: { io: ['OnlyThis.'], cpu: [] },
    };
    assert.deepEqual([...collectEffects(ctx, blockCalling('Http.get'))], [],
      '显式注入后不应再叠加内置默认前缀');
  });
});
