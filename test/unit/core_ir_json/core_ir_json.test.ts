import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeCoreIR,
  deserializeCoreIR,
  isValidCoreIRJson,
  type CoreIREnvelope,
} from '../../../src/core/core_ir_json.js';
import type { Core } from '../../../src/types.js';
import { Effect } from '../../../src/config/semantic.js';

// 辅助函数：创建最小化 Core.Module 用于测试
function createMinimalModule(name: string | null = null): Core.Module {
  return {
    kind: 'Module',
    name,
    decls: [],
  };
}

// 辅助函数：创建带声明的 Core.Module
function createModuleWithDecls(): Core.Module {
  const funcDecl: Core.Func = {
    kind: 'Func',
    name: 'testFunc',
    typeParams: [],
    params: [],
    ret: { kind: 'TypeName', name: 'Int' },
    effects: [],
    effectCaps: [],
    effectCapsExplicit: false,
    body: { kind: 'Block', statements: [] },
  };

  return {
    kind: 'Module',
    name: 'TestModule',
    decls: [funcDecl],
  };
}

describe('Core IR JSON 序列化', () => {
  describe('serializeCoreIR', () => {
    it('应序列化最小化模块（无名称）', () => {
      const module = createMinimalModule(null);
      const json = serializeCoreIR(module);
      const parsed = JSON.parse(json) as CoreIREnvelope;

      assert.equal(parsed.version, '1.0');
      assert.equal(parsed.module.kind, 'Module');
      assert.equal(parsed.module.name, null);
      assert.deepEqual(parsed.module.decls, []);
    });

    it('应序列化带名称的模块', () => {
      const module = createMinimalModule('MyModule');
      const json = serializeCoreIR(module);
      const parsed = JSON.parse(json) as CoreIREnvelope;

      assert.equal(parsed.module.name, 'MyModule');
    });

    it('应序列化带声明的模块', () => {
      const module = createModuleWithDecls();
      const json = serializeCoreIR(module);
      const parsed = JSON.parse(json) as CoreIREnvelope;

      assert.equal(parsed.module.decls.length, 1);
      assert.equal((parsed.module.decls[0] as Core.Func).name, 'testFunc');
    });

    it('应包含可选的 metadata 字段', () => {
      const module = createMinimalModule();
      const metadata = {
        generatedAt: '2025-11-18T10:00:00Z',
        source: 'test.aster',
        compilerVersion: '0.2.0',
      };

      const json = serializeCoreIR(module, metadata);
      const parsed = JSON.parse(json) as CoreIREnvelope;

      assert.deepEqual(parsed.metadata, metadata);
    });

    it('当 metadata 为空对象时不应包含 metadata 字段', () => {
      const module = createMinimalModule();
      const json = serializeCoreIR(module);
      const parsed = JSON.parse(json) as CoreIREnvelope;

      assert.equal(parsed.metadata, undefined);
    });

    it('应格式化输出（2空格缩进）', () => {
      const module = createMinimalModule('Test');
      const json = serializeCoreIR(module);

      // 验证格式化输出包含换行符和缩进
      assert.ok(json.includes('\n'));
      assert.ok(json.includes('  "version"'));
    });
  });

  describe('deserializeCoreIR', () => {
    it('应正确反序列化有效的 Core IR JSON', () => {
      const module = createModuleWithDecls();
      const json = serializeCoreIR(module);
      const deserialized = deserializeCoreIR(json);

      assert.equal(deserialized.kind, 'Module');
      assert.equal(deserialized.name, 'TestModule');
      assert.equal(deserialized.decls.length, 1);
    });

    it('应拒绝非法 JSON 字符串', () => {
      assert.throws(
        () => deserializeCoreIR('invalid json'),
        { message: /Invalid JSON/ }
      );
    });

    it('应拒绝非对象的 JSON', () => {
      assert.throws(
        () => deserializeCoreIR('[]'),
        { message: /expected object/ }
      );

      assert.throws(
        () => deserializeCoreIR('"string"'),
        { message: /expected object/ }
      );

      assert.throws(
        () => deserializeCoreIR('123'),
        { message: /expected object/ }
      );
    });

    it('应拒绝缺少 version 字段的 JSON', () => {
      const invalidJson = JSON.stringify({ module: createMinimalModule() });

      assert.throws(
        () => deserializeCoreIR(invalidJson),
        { message: /Unsupported Core IR JSON version: missing/ }
      );
    });

    it('应拒绝不支持的 version', () => {
      const invalidJson = JSON.stringify({
        version: '2.0',
        module: createMinimalModule(),
      });

      assert.throws(
        () => deserializeCoreIR(invalidJson),
        { message: /Unsupported Core IR JSON version: 2.0/ }
      );
    });

    it('应拒绝缺少 module 字段的 JSON', () => {
      const invalidJson = JSON.stringify({ version: '1.0' });

      assert.throws(
        () => deserializeCoreIR(invalidJson),
        { message: /missing or invalid "module" field/ }
      );
    });

    it('应拒绝 module 字段为 null 的 JSON', () => {
      const invalidJson = JSON.stringify({ version: '1.0', module: null });

      assert.throws(
        () => deserializeCoreIR(invalidJson),
        { message: /missing or invalid "module" field/ }
      );
    });

    it('应拒绝 module.kind 不是 "Module" 的 JSON', () => {
      const invalidJson = JSON.stringify({
        version: '1.0',
        module: { kind: 'NotModule', decls: [] },
      });

      assert.throws(
        () => deserializeCoreIR(invalidJson),
        { message: /expected module.kind === 'Module'/ }
      );
    });

    it('应拒绝 module.decls 不是数组的 JSON', () => {
      const invalidJson = JSON.stringify({
        version: '1.0',
        module: { kind: 'Module', name: null, decls: 'not-an-array' },
      });

      assert.throws(
        () => deserializeCoreIR(invalidJson),
        { message: /module.decls must be an array/ }
      );
    });

    it('应忽略额外的顶层字段', () => {
      const json = JSON.stringify({
        version: '1.0',
        module: createMinimalModule(),
        extraField: 'should-be-ignored',
      });

      const deserialized = deserializeCoreIR(json);
      assert.equal(deserialized.kind, 'Module');
    });

    it('应正确解析带 metadata 的 JSON', () => {
      const module = createMinimalModule();
      const metadata = { source: 'test.aster' };
      const json = serializeCoreIR(module, metadata);

      // deserializeCoreIR 只返回 module，不返回 metadata
      const deserialized = deserializeCoreIR(json);
      assert.equal(deserialized.kind, 'Module');
    });
  });

  describe('isValidCoreIRJson', () => {
    it('应验证有效的 Core IR JSON 为 true', () => {
      const module = createMinimalModule();
      const json = serializeCoreIR(module);

      assert.equal(isValidCoreIRJson(json), true);
    });

    it('应验证无效的 JSON 为 false', () => {
      assert.equal(isValidCoreIRJson('invalid json'), false);
    });

    it('应验证缺少 version 的 JSON 为 false', () => {
      const invalidJson = JSON.stringify({ module: createMinimalModule() });
      assert.equal(isValidCoreIRJson(invalidJson), false);
    });

    it('应验证缺少 module 的 JSON 为 false', () => {
      const invalidJson = JSON.stringify({ version: '1.0' });
      assert.equal(isValidCoreIRJson(invalidJson), false);
    });

    it('应验证 module.kind 错误的 JSON 为 false', () => {
      const invalidJson = JSON.stringify({
        version: '1.0',
        module: { kind: 'NotModule', decls: [] },
      });
      assert.equal(isValidCoreIRJson(invalidJson), false);
    });

    it('应验证 module.decls 不是数组的 JSON 为 false', () => {
      const invalidJson = JSON.stringify({
        version: '1.0',
        module: { kind: 'Module', name: null, decls: null },
      });
      assert.equal(isValidCoreIRJson(invalidJson), false);
    });
  });

  describe('往返测试（round-trip）', () => {
    it('序列化后反序列化应得到相同的模块结构', () => {
      const original = createModuleWithDecls();
      const json = serializeCoreIR(original);
      const deserialized = deserializeCoreIR(json);

      assert.deepEqual(deserialized, original);
    });

    it('对空 decls 数组往返应保持一致', () => {
      const original = createMinimalModule('EmptyModule');
      const json = serializeCoreIR(original);
      const deserialized = deserializeCoreIR(json);

      assert.deepEqual(deserialized, original);
    });

    it('对 null 名称往返应保持一致', () => {
      const original = createMinimalModule(null);
      const json = serializeCoreIR(original);
      const deserialized = deserializeCoreIR(json);

      assert.equal(deserialized.name, null);
      assert.deepEqual(deserialized, original);
    });
  });

  describe('版本兼容性', () => {
    it('应拒绝未来版本（向前兼容性测试）', () => {
      const futureJson = JSON.stringify({
        version: '99.0',
        module: createMinimalModule(),
      });

      assert.throws(
        () => deserializeCoreIR(futureJson),
        { message: /Unsupported Core IR JSON version: 99.0/ }
      );
    });

    it('应拒绝旧版本（向后兼容性测试）', () => {
      const oldJson = JSON.stringify({
        version: '0.9',
        module: createMinimalModule(),
      });

      assert.throws(
        () => deserializeCoreIR(oldJson),
        { message: /Unsupported Core IR JSON version: 0.9/ }
      );
    });
  });
});
