import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 验证 CNL → JSON 转换并检查 JSON → Core IR 格式化输出
 */
function testConversion(asterFile: string): { json: string; coreIR: string } {
  const projectRoot = path.join(__dirname, '../../..');
  const asterPath = path.join(projectRoot, 'test/policy-converter', asterFile);

  // Step 1: CNL → JSON
  const json = execSync(`node dist/src/cli/policy-converter.js compile-to-json ${asterPath}`, {
    encoding: 'utf8',
    cwd: projectRoot,
  });

  // Step 2: JSON → Core IR (验证反序列化能成功)
  const coreIR = execSync(
    'node dist/src/cli/policy-converter.js json-to-cnl -',
    {
      input: json,
      encoding: 'utf8',
      cwd: projectRoot,
    }
  );

  return { json, coreIR };
}

describe('Policy JSON ↔ CNL Converter', () => {
  describe('CNL → JSON 编译', () => {
    it('simple_policy.aster: 成功编译为 JSON', () => {
      const { json, coreIR } = testConversion('simple_policy.aster');

      // 验证 JSON 可以正确解析
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.version, '1.0');
      assert.strictEqual(parsed.module.kind, 'Module');
      assert.strictEqual(parsed.module.name, 'test.simple');

      // 验证 Core IR 输出不为空
      assert.ok(coreIR.length > 0);
      assert.ok(coreIR.includes('test.simple'));
    });

    it('data_policy.aster: 成功编译为 JSON', () => {
      const { json, coreIR } = testConversion('data_policy.aster');

      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.version, '1.0');
      assert.strictEqual(parsed.module.name, 'test.data');

      // 验证包含数据类型定义
      assert.ok(parsed.module.decls.some((d: any) => d.kind === 'Data'));
      assert.ok(coreIR.includes('Person'));
    });

    it('effects_policy.aster: 成功编译为 JSON', () => {
      const { json, coreIR } = testConversion('effects_policy.aster');

      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.module.name, 'test.effects');

      // 验证包含函数声明
      assert.ok(parsed.module.decls.some((d: any) => d.kind === 'Func'));
      assert.ok(coreIR.includes('pureFunction'));
      assert.ok(coreIR.includes('ioFunction'));
    });

    it('async_policy.aster: 成功编译为 JSON', () => {
      const { json, coreIR } = testConversion('async_policy.aster');

      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.module.name, 'test.async');

      assert.ok(coreIR.includes('processAsync'));
      assert.ok(coreIR.includes('loadUser'));
    });
  });

  describe('JSON → Core IR 反序列化', () => {
    it('验证 JSON 结构完整性', () => {
      const { json } = testConversion('simple_policy.aster');
      const parsed = JSON.parse(json);

      // 检查版本字段
      assert.ok(parsed.version);
      assert.strictEqual(parsed.version, '1.0');

      // 检查模块字段
      assert.ok(parsed.module);
      assert.strictEqual(parsed.module.kind, 'Module');

      // 检查 metadata 字段
      assert.ok(parsed.metadata);
      assert.ok(parsed.metadata.generatedAt);
      assert.ok(parsed.metadata.compilerVersion);
    });
  });
});
