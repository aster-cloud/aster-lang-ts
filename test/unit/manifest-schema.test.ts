/**
 * manifest.schema.json 验证测试
 *
 * 测试目标：
 * 1. 验证合法的manifest.json（含dependencies）通过schema验证
 * 2. 验证缺失dependencies字段的manifest.json仍然合法（向后兼容）
 * 3. 验证非法版本约束被schema拒绝
 * 4. 验证additionalProperties: false严格验证
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 从 dist/test/unit/ 回到项目根目录需要 ../../../
const projectRoot = join(__dirname, '..', '..', '..');

// 加载 manifest.schema.json
const schemaPath = join(projectRoot, 'manifest.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

test('manifest.schema.json 验证测试', async (t) => {
  await t.test('应接受完整的合法manifest（含dependencies）', () => {
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

    const isValid = validate(validManifest);
    assert.strictEqual(
      isValid,
      true,
      `验证应该通过，但失败了：${JSON.stringify(validate.errors, null, 2)}`
    );
  });

  await t.test('应接受缺失dependencies字段的manifest（向后兼容）', () => {
    const backwardCompatibleManifest = {
      capabilities: {
        allow: ['Http', 'Files'],
      },
    };

    const isValid = validate(backwardCompatibleManifest);
    assert.strictEqual(
      isValid,
      true,
      `向后兼容验证应该通过，但失败了：${JSON.stringify(validate.errors, null, 2)}`
    );
  });

  await t.test('应接受只包含capabilities的旧版manifest', () => {
    const legacyManifest = {
      capabilities: {
        allow: ['Http', 'Sql', 'Files'],
        deny: ['Secrets'],
      },
    };

    const isValid = validate(legacyManifest);
    assert.strictEqual(
      isValid,
      true,
      `旧版manifest验证应该通过，但失败了：${JSON.stringify(validate.errors, null, 2)}`
    );
  });

  await t.test('应拒绝非法的版本约束（字母）', () => {
    const invalidVersionManifest = {
      dependencies: {
        'aster.http': 'abc', // 非法版本
      },
    };

    const isValid = validate(invalidVersionManifest);
    assert.strictEqual(
      isValid,
      false,
      '非法版本约束应该被拒绝'
    );
    assert.ok(
      validate.errors?.some((err) => err.keyword === 'pattern'),
      '错误应该是pattern验证失败'
    );
  });

  await t.test('应拒绝非法的包名称（大写字母开头）', () => {
    const invalidNameManifest = {
      name: 'Aster.finance', // 大写字母开头
      version: '1.0.0',
    };

    const isValid = validate(invalidNameManifest);
    assert.strictEqual(
      isValid,
      false,
      '非法包名称应该被拒绝'
    );
  });

  await t.test('应拒绝非法的包版本（缺少patch版本）', () => {
    const invalidVersionManifest = {
      name: 'aster.test',
      version: '1.0', // 缺少patch版本
    };

    const isValid = validate(invalidVersionManifest);
    assert.strictEqual(
      isValid,
      false,
      '非法包版本应该被拒绝'
    );
  });

  await t.test('应接受各种SemVer版本约束前缀', () => {
    const validPrefixes = {
      dependencies: {
        'aster.http': '^2.1.0', // caret
        'aster.time': '~1.5.3', // tilde
        'aster.files': '3.0.0', // exact
      },
    };

    const isValid = validate(validPrefixes);
    assert.strictEqual(
      isValid,
      true,
      `各种版本约束前缀应该被接受，但失败了：${JSON.stringify(validate.errors, null, 2)}`
    );
  });

  await t.test('应接受空的dependencies对象', () => {
    const emptyDepsManifest = {
      name: 'aster.test',
      version: '1.0.0',
      dependencies: {},
    };

    const isValid = validate(emptyDepsManifest);
    assert.strictEqual(
      isValid,
      true,
      `空dependencies应该被接受，但失败了：${JSON.stringify(validate.errors, null, 2)}`
    );
  });

  await t.test('应拒绝包含未定义字段的manifest（additionalProperties: false）', () => {
    const extraFieldManifest = {
      name: 'aster.test',
      version: '1.0.0',
      unknownField: 'should be rejected', // 未定义字段
    };

    const isValid = validate(extraFieldManifest);
    assert.strictEqual(
      isValid,
      false,
      'additionalProperties: false应该拒绝未定义字段'
    );
    assert.ok(
      validate.errors?.some((err) => err.keyword === 'additionalProperties'),
      '错误应该是additionalProperties验证失败'
    );
  });

  await t.test('应接受合法的effects数组（PascalCase标识符）', () => {
    const validEffects = {
      effects: ['HttpRequest', 'DatabaseQuery', 'AiModel'],
    };

    const isValid = validate(validEffects);
    assert.strictEqual(
      isValid,
      true,
      `合法effects应该被接受，但失败了：${JSON.stringify(validate.errors, null, 2)}`
    );
  });

  await t.test('应拒绝非法的effects（lowercase开头）', () => {
    const invalidEffects = {
      effects: ['httpRequest'], // 小写开头
    };

    const isValid = validate(invalidEffects);
    assert.strictEqual(
      isValid,
      false,
      'effects必须是PascalCase，应该拒绝小写开头'
    );
  });

  await t.test('应拒绝dependencies中的版本范围（暂不支持）', () => {
    const rangeVersionManifest = {
      dependencies: {
        'aster.http': '>=1.0.0 <2.0.0', // 版本范围
      },
    };

    const isValid = validate(rangeVersionManifest);
    assert.strictEqual(
      isValid,
      false,
      '复杂版本范围暂不支持，应该被拒绝'
    );
  });

  await t.test('应接受合法的包名称（点号分隔）', () => {
    const validNames = [
      { name: 'aster' },
      { name: 'aster.finance' },
      { name: 'aster.finance.loan' },
      { name: 'aster.finance.credit_check' }, // 下划线合法
    ];

    for (const manifest of validNames) {
      const isValid = validate(manifest);
      assert.strictEqual(
        isValid,
        true,
        `包名称 "${manifest.name}" 应该被接受，但失败了：${JSON.stringify(validate.errors, null, 2)}`
      );
    }
  });

  await t.test('应拒绝非法的包名称（连字符、数字开头等）', () => {
    const invalidNames = [
      { name: 'Aster' }, // 大写开头
      { name: 'aster-finance' }, // 连字符
      { name: '1aster' }, // 数字开头
      { name: 'aster.Finance' }, // 段中大写
      { name: 'aster.' }, // 末尾点号
      { name: '.aster' }, // 开头点号
    ];

    for (const manifest of invalidNames) {
      const isValid = validate(manifest);
      assert.strictEqual(
        isValid,
        false,
        `包名称 "${manifest.name}" 应该被拒绝`
      );
    }
  });
});
