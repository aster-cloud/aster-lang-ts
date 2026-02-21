import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ModuleCache } from '../../src/lsp/module_cache.js';
import type { EffectSignature } from '../../src/effects/effect_signature.js';
import { Effect } from '../../src/config/semantic.js';

function buildSignature(moduleName: string, functionName: string, effect: Effect): Map<string, EffectSignature> {
  const qualifiedName = `${moduleName}.${functionName}`;
  const declared = new Set<Effect>([effect]);
  const signature: EffectSignature = {
    module: moduleName,
    function: functionName,
    qualifiedName,
    declared,
    inferred: new Set(declared),
    required: new Set(declared),
  };
  return new Map([[qualifiedName, signature]]);
}

function writePackageModule(root: string, moduleName: string, effectText: string): string {
  const segments = moduleName.split('.').filter(Boolean);
  const filePath = join(root, ...segments) + '.aster';
  mkdirSync(dirname(filePath), { recursive: true });
  const functionName = segments[segments.length - 1];
  const source = `Module ${moduleName}.

Rule ${functionName}, produce Text. It performs ${effectText}:
  Return "ok".
`;
  writeFileSync(filePath, source, 'utf8');
  return filePath;
}

describe('ModuleCache 包加载', () => {
  let tempDir: string;
  let packagesRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'module-cache-'));
    packagesRoot = join(tempDir, '.aster', 'packages');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('工作区缓存优先于包缓存', () => {
    const cache = new ModuleCache();
    const moduleName = 'demo.priority';
    cache.cacheModuleEffectSignatures({
      moduleName,
      signatures: buildSignature(moduleName, 'preferWorkspace', Effect.IO),
    });

    writePackageModule(packagesRoot, moduleName, 'cpu');
    const result = cache.getModuleEffectSignatures(moduleName, [packagesRoot]);
    assert.ok(result, '应该返回缓存签名');
    const signature = result.get(`${moduleName}.preferWorkspace`);
    assert.ok(signature, '签名应存在');
    assert.equal([...signature.required][0], Effect.IO, '需要返回工作区版本');
  });

  it('可以从 .aster/packages 加载 effect 签名', () => {
    const cache = new ModuleCache();
    const moduleName = 'pkg.sample';
    writePackageModule(packagesRoot, moduleName, 'io');

    const loaded = cache.loadModule(moduleName, [packagesRoot]);
    assert.ok(!(loaded instanceof Error), '加载应成功');
    const map = loaded as ReadonlyMap<string, EffectSignature>;
    const signature = map.get(`${moduleName}.sample`);
    assert.ok(signature, '应产生命名函数签名');
    assert.equal([...signature.required][0], Effect.IO, '解析出的效果应为 IO');
  });

  it('invalidatePackageCache 之后会重新读取包文件', () => {
    const cache = new ModuleCache();
    const moduleName = 'pkg.reload';
    const filePath = writePackageModule(packagesRoot, moduleName, 'io');

    const firstLoad = cache.getModuleEffectSignatures(moduleName, [packagesRoot]);
    assert.ok(firstLoad, '首次加载应该成功');
    const firstSignature = firstLoad.get(`${moduleName}.reload`);
    assert.equal([...firstSignature!.required][0], Effect.IO);

    writeFileSync(
      filePath,
      `Module ${moduleName}.

Rule reload, produce Text. It performs cpu:
  Return "ok".
`,
      'utf8'
    );

    const cached = cache.getModuleEffectSignatures(moduleName, [packagesRoot]);
    assert.ok(cached, '仍应命中旧缓存');
    assert.equal([...cached.get(`${moduleName}.reload`)!.required][0], Effect.IO, '失效前应保持旧值');

    cache.invalidatePackageCache(moduleName);
    const refreshed = cache.getModuleEffectSignatures(moduleName, [packagesRoot]);
    assert.ok(refreshed, '重新加载后应获得新值');
    assert.equal([...refreshed.get(`${moduleName}.reload`)!.required][0], Effect.CPU, '缓存失效后应看到 CPU');
  });

  it('模块不存在时返回 MODULE_NOT_FOUND 错误', () => {
    const cache = new ModuleCache();
    const result = cache.loadModule('pkg.missing', [packagesRoot]);
    assert.ok(result instanceof Error, '应返回错误');
    assert.ok(result.message.includes('MODULE_NOT_FOUND'), '错误信息应包含 MODULE_NOT_FOUND');
  });

  it('加载十个包签名耗时低于 1 秒', () => {
    const cache = new ModuleCache();
    const moduleNames: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const moduleName = `pkg.batch${index}`;
      moduleNames.push(moduleName);
      writePackageModule(packagesRoot, moduleName, 'io');
    }

    const start = performance.now();
    for (const name of moduleNames) {
      const outcome = cache.loadModule(name, [packagesRoot]);
      assert.ok(!(outcome instanceof Error), `加载 ${name} 不应失败`);
    }
    const duration = performance.now() - start;
    assert.ok(duration < 1_000, `批量加载耗时 ${duration}ms，应低于 1000ms`);
  });
});
