/**
 * manifest-parser.ts 单元测试
 *
 * 测试目标：
 * 1. 验证parseManifest能正确解析合法manifest.json
 * 2. 验证文件不存在时返回M002错误
 * 3. 验证JSON解析失败时返回M001错误
 * 4. 验证schema验证失败时返回相应错误
 * 5. 验证validateManifest语义验证逻辑
 */

import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest, validateManifest } from '../../src/package/manifest-parser.js';
import type { Manifest } from '../../src/manifest.js';
import { DiagnosticCode, type Diagnostic } from '../../src/diagnostics/diagnostics.js';

const TEST_DIR = '/tmp/aster-manifest-test';

test('manifest-parser 测试套件', async (t) => {
  // 准备测试目录
  await t.before(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {
      // 目录不存在，忽略
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  // 清理测试目录
  await t.after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {
      // 忽略清理错误
    }
  });

  await t.test('应成功解析合法的完整manifest.json', () => {
    const manifestPath = join(TEST_DIR, 'valid-full.json');
    const validManifest = {
      name: 'aster.finance.loan',
      version: '1.0.0',
      dependencies: {
        'aster.http': '^2.1.0',
        'aster.time': '~1.5.3',
      },
      devDependencies: {
        'aster.test': '^3.0.0',
      },
      effects: ['CreditCheck', 'FraudDetection'],
      capabilities: {
        allow: ['Http', 'Sql', 'Time'],
        deny: ['Secrets'],
      },
    };

    writeFileSync(manifestPath, JSON.stringify(validManifest, null, 2), 'utf-8');

    const result = parseManifest(manifestPath);
    assert.ok(!Array.isArray(result), '不应返回诊断错误数组');

    const manifest = result as Manifest;
    assert.strictEqual(manifest.name, 'aster.finance.loan');
    assert.strictEqual(manifest.version, '1.0.0');
    assert.ok(manifest.dependencies, 'dependencies应该存在');
    assert.deepStrictEqual(manifest.dependencies, {
      'aster.http': '^2.1.0',
      'aster.time': '~1.5.3',
    });
  });

  await t.test('应成功解析最小合法manifest（只有capabilities）', () => {
    const manifestPath = join(TEST_DIR, 'minimal.json');
    const minimalManifest = {
      capabilities: {
        allow: ['Http'],
      },
    };

    writeFileSync(manifestPath, JSON.stringify(minimalManifest, null, 2), 'utf-8');

    const result = parseManifest(manifestPath);
    assert.ok(!Array.isArray(result), '不应返回诊断错误数组');

    const manifest = result as Manifest;
    assert.ok(manifest.capabilities, 'capabilities应该存在');
    assert.deepStrictEqual(manifest.capabilities.allow, ['Http']);
  });

  await t.test('文件不存在时应返回M002错误', () => {
    const nonExistentPath = join(TEST_DIR, 'non-existent.json');

    const result = parseManifest(nonExistentPath);
    assert.ok(Array.isArray(result), '应返回诊断错误数组');

    const diagnostics = result as Diagnostic[];
    assert.strictEqual(diagnostics.length, 1);
    assert.ok(diagnostics[0], '应该返回至少一个诊断');
    assert.strictEqual(diagnostics[0].code, DiagnosticCode.M002_ManifestFileNotFound);
    assert.ok(diagnostics[0].message.includes('找不到清单文件'));
  });

  await t.test('JSON格式错误时应返回M001错误', () => {
    const manifestPath = join(TEST_DIR, 'invalid-json.json');
    writeFileSync(manifestPath, '{ invalid json }', 'utf-8');

    const result = parseManifest(manifestPath);
    assert.ok(Array.isArray(result), '应返回诊断错误数组');

    const diagnostics = result as Diagnostic[];
    assert.strictEqual(diagnostics.length, 1);
    assert.ok(diagnostics[0], '应该返回至少一个诊断');
    assert.strictEqual(diagnostics[0].code, DiagnosticCode.M001_ManifestParseError);
    assert.ok(diagnostics[0].message.includes('JSON解析失败'));
  });

  await t.test('未知字段应返回M007错误', () => {
    const manifestPath = join(TEST_DIR, 'unknown-field.json');
    const invalidManifest = {
      name: 'aster.test',
      version: '1.0.0',
      unknownField: 'should be rejected',
    };

    writeFileSync(manifestPath, JSON.stringify(invalidManifest, null, 2), 'utf-8');

    const result = parseManifest(manifestPath);
    assert.ok(Array.isArray(result), '应返回诊断错误数组');

    const diagnostics = result;
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.M007_UnknownManifestField));
  });

  await t.test('非法包名称应返回M003错误', () => {
    const invalidManifest: Manifest = {
      name: 'Aster.finance', // 大写开头
    };

    const diagnostics = validateManifest(invalidManifest);
    assert.strictEqual(diagnostics.length, 1);
    assert.ok(diagnostics[0], '应该返回至少一个诊断');
    assert.strictEqual(diagnostics[0].code, DiagnosticCode.M003_InvalidPackageName);
    assert.ok(diagnostics[0].message.includes('包名称格式无效'));
  });

  await t.test('应拒绝各种非法包名称格式', () => {
    const invalidNames = [
      'Aster', // 大写开头
      'aster-finance', // 连字符
      '1aster', // 数字开头
      'aster.Finance', // 段中大写
      'aster.', // 末尾点号
      '.aster', // 开头点号
    ];

    for (const name of invalidNames) {
      const diagnostics = validateManifest({ name });
      assert.ok(
        diagnostics.length > 0,
        `包名称 "${name}" 应该被拒绝`
      );
      assert.ok(diagnostics[0], '应该返回至少一个诊断');
      assert.strictEqual(diagnostics[0].code, DiagnosticCode.M003_InvalidPackageName);
    }
  });

  await t.test('应接受合法的包名称格式', () => {
    const validNames = [
      'aster',
      'aster.finance',
      'aster.finance.loan',
      'aster.finance.credit_check', // 下划线合法
    ];

    for (const name of validNames) {
      const diagnostics = validateManifest({ name });
      assert.strictEqual(
        diagnostics.length,
        0,
        `包名称 "${name}" 应该被接受，但返回错误：${JSON.stringify(diagnostics)}`
      );
    }
  });

  await t.test('非法版本格式应返回M004错误', () => {
    const invalidVersions = [
      '1.0', // 缺少patch版本
      'v1.0.0', // 带v前缀
      '1', // 只有major版本
    ];

    for (const version of invalidVersions) {
      const diagnostics = validateManifest({ version });
      assert.ok(
        diagnostics.length > 0,
        `版本 "${version}" 应该被拒绝`
      );
      assert.ok(diagnostics[0], '应该返回至少一个诊断');
      assert.strictEqual(diagnostics[0].code, DiagnosticCode.M004_InvalidVersion);
    }
  });

  await t.test('应接受合法的SemVer版本', () => {
    const validVersions = ['1.0.0', '2.3.4', '0.0.1'];

    for (const version of validVersions) {
      const diagnostics = validateManifest({ version });
      assert.strictEqual(
        diagnostics.length,
        0,
        `版本 "${version}" 应该被接受，但返回错误：${JSON.stringify(diagnostics)}`
      );
    }
  });

  await t.test('非法版本约束应返回M005错误', () => {
    const invalidConstraints = [
      'abc', // 非法字符
      '>=1.0.0 <2.0.0', // 版本范围（暂不支持）
    ];

    for (const constraint of invalidConstraints) {
      const manifest: Manifest = {
        dependencies: {
          'aster.http': constraint,
        },
      };

      const diagnostics = validateManifest(manifest);
      assert.ok(
        diagnostics.length > 0,
        `版本约束 "${constraint}" 应该被拒绝`
      );
      assert.ok(diagnostics[0], '应该返回至少一个诊断');
      assert.strictEqual(diagnostics[0].code, DiagnosticCode.M005_InvalidVersionConstraint);
    }
  });

  await t.test('应接受各种合法版本约束前缀', () => {
    const manifest: Manifest = {
      dependencies: {
        'aster.http': '^2.1.0', // caret
        'aster.time': '~1.5.3', // tilde
        'aster.files': '3.0.0', // exact
      },
    };

    const diagnostics = validateManifest(manifest);
    assert.strictEqual(
      diagnostics.length,
      0,
      `合法版本约束应该被接受，但返回错误：${JSON.stringify(diagnostics)}`
    );
  });

  await t.test('非法effect名称应返回M006错误', () => {
    const invalidEffects = [
      'httpRequest', // 小写开头
      'HTTP_REQUEST', // 下划线分隔
      '1Effect', // 数字开头
    ];

    for (const effect of invalidEffects) {
      const manifest: Manifest = {
        effects: [effect],
      };

      const diagnostics = validateManifest(manifest);
      assert.ok(
        diagnostics.length > 0,
        `effect "${effect}" 应该被拒绝`
      );
      assert.ok(diagnostics[0], '应该返回至少一个诊断');
      assert.strictEqual(diagnostics[0].code, DiagnosticCode.M006_InvalidEffectName);
    }
  });

  await t.test('应接受合法的PascalCase effect名称', () => {
    const validEffects = [
      'HttpRequest',
      'DatabaseQuery',
      'AiModel',
      'CreditCheck',
    ];

    for (const effect of validEffects) {
      const manifest: Manifest = {
        effects: [effect],
      };

      const diagnostics = validateManifest(manifest);
      assert.strictEqual(
        diagnostics.length,
        0,
        `effect "${effect}" 应该被接受，但返回错误：${JSON.stringify(diagnostics)}`
      );
    }
  });

  await t.test('非法capability应返回M008错误', () => {
    const invalidCapabilities = ['Network', 'Database', 'Invalid'];

    for (const cap of invalidCapabilities) {
      const manifest: Manifest = {
        capabilities: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          allow: [cap as any],
        },
      };

      const diagnostics = validateManifest(manifest);
      assert.ok(
        diagnostics.length > 0,
        `capability "${cap}" 应该被拒绝`
      );
      assert.ok(diagnostics[0], '应该返回至少一个诊断');
      assert.strictEqual(diagnostics[0].code, DiagnosticCode.M008_InvalidCapability);
    }
  });

  await t.test('应接受所有合法的capability值', () => {
    const manifest: Manifest = {
      capabilities: {
        allow: ['Http', 'Sql', 'Time', 'Files', 'Secrets', 'AiModel', 'Cpu'],
      },
    };

    const diagnostics = validateManifest(manifest);
    assert.strictEqual(
      diagnostics.length,
      0,
      `合法capabilities应该被接受，但返回错误：${JSON.stringify(diagnostics)}`
    );
  });

  await t.test('应接受空依赖对象', () => {
    const manifest: Manifest = {
      name: 'aster.test',
      version: '1.0.0',
      dependencies: {},
      devDependencies: {},
    };

    const diagnostics = validateManifest(manifest);
    assert.strictEqual(
      diagnostics.length,
      0,
      `空依赖对象应该被接受，但返回错误：${JSON.stringify(diagnostics)}`
    );
  });

  await t.test('应返回多个验证错误', () => {
    const manifest: Manifest = {
      name: 'Invalid.Name', // 大写字母
      version: '1.0', // 缺少patch
      effects: ['lowercase'], // 小写开头
      capabilities: {
        allow: ['Invalid' as any], // 非法capability
      },
    };

    const diagnostics = validateManifest(manifest);
    assert.ok(diagnostics.length >= 4, '应该返回至少4个错误');

    const codes = diagnostics.map((d) => d.code);
    assert.ok(codes.includes(DiagnosticCode.M003_InvalidPackageName));
    assert.ok(codes.includes(DiagnosticCode.M004_InvalidVersion));
    assert.ok(codes.includes(DiagnosticCode.M006_InvalidEffectName));
    assert.ok(codes.includes(DiagnosticCode.M008_InvalidCapability));
  });
});
