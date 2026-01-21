/**
 * 输入值生成器单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateFieldValue,
  generateInputValues,
  getFieldValueHint,
  ParameterInfo,
} from '../../../src/parser/input-generator.js';

describe('generateFieldValue', () => {
  describe('金融领域字段', () => {
    it('应生成信用评分', () => {
      const value = generateFieldValue('creditScore', 'Int');
      assert.strictEqual(value, 720);
    });

    it('应生成贷款金额', () => {
      const value = generateFieldValue('loanAmount', 'Float');
      assert.strictEqual(value, 50000.0);
    });

    it('应生成收入', () => {
      const value = generateFieldValue('annualIncome', 'Float');
      assert.strictEqual(value, 85000.0);
    });

    it('应生成利率', () => {
      const value = generateFieldValue('interestRate', 'Float');
      assert.strictEqual(value, 5.5);
    });

    it('应生成贷款期限', () => {
      const value = generateFieldValue('termMonths', 'Int');
      assert.strictEqual(value, 36);
    });

    it('应生成 DTI', () => {
      const value = generateFieldValue('debtToIncomeRatio', 'Float');
      assert.strictEqual(value, 0.35);
    });

    it('应生成 LTV', () => {
      const value = generateFieldValue('loanToValueRatio', 'Float');
      assert.strictEqual(value, 0.80);
    });
  });

  describe('保险领域字段', () => {
    it('应生成保费', () => {
      const value = generateFieldValue('annualPremium', 'Int');
      assert.strictEqual(value, 1200);
    });

    it('应生成免赔额', () => {
      const value = generateFieldValue('deductible', 'Int');
      assert.strictEqual(value, 500);
    });

    it('应生成驾龄', () => {
      const value = generateFieldValue('yearsLicensed', 'Int');
      assert.strictEqual(value, 8);
    });
  });

  describe('个人信息字段', () => {
    it('应生成年龄', () => {
      const value = generateFieldValue('age', 'Int');
      assert.strictEqual(value, 35);
    });

    it('应生成用户 ID', () => {
      const value = generateFieldValue('applicantId', 'Text');
      assert.strictEqual(value, 'USR-2024-001');
    });

    it('应生成姓名', () => {
      const value = generateFieldValue('applicantName', 'Text');
      assert.strictEqual(value, 'John Smith');
    });

    it('应生成邮箱', () => {
      const value = generateFieldValue('email', 'Text');
      assert.strictEqual(value, 'john.smith@example.com');
    });

    it('应生成电话', () => {
      const value = generateFieldValue('phone', 'Text');
      assert.strictEqual(value, '+1-555-123-4567');
    });
  });

  describe('车辆信息字段', () => {
    it('应生成车辆品牌', () => {
      const value = generateFieldValue('vehicleMake', 'Text');
      assert.strictEqual(value, 'Toyota');
    });

    it('应生成车辆型号', () => {
      const value = generateFieldValue('vehicleModel', 'Text');
      assert.strictEqual(value, 'Camry');
    });

    it('应生成车辆年份', () => {
      const value = generateFieldValue('vehicleYear', 'Int');
      assert.strictEqual(value, 2022);
    });

    it('应生成 VIN', () => {
      const value = generateFieldValue('vin', 'Text');
      assert.strictEqual(value, '1HGBH41JXMN109186');
    });
  });

  describe('医疗健康字段', () => {
    it('应生成患者 ID', () => {
      const value = generateFieldValue('patientId', 'Text');
      assert.strictEqual(value, 'PAT-2024-001');
    });

    it('应生成诊断代码', () => {
      const value = generateFieldValue('diagnosisCode', 'Text');
      assert.strictEqual(value, 'J06.9');
    });

    it('应生成索赔金额', () => {
      const value = generateFieldValue('claimAmount', 'Float');
      assert.strictEqual(value, 2500.0);
    });
  });

  describe('布尔类型字段', () => {
    it('应生成审批状态为 true', () => {
      const value = generateFieldValue('isApproved', 'Bool');
      assert.strictEqual(value, true);
    });

    it('应生成验证状态为 true', () => {
      const value = generateFieldValue('isVerified', 'Bool');
      assert.strictEqual(value, true);
    });

    it('应生成拒绝状态为 false', () => {
      const value = generateFieldValue('isRejected', 'Bool');
      assert.strictEqual(value, false);
    });

    it('应生成 has 前缀为 true', () => {
      const value = generateFieldValue('hasInsurance', 'Bool');
      assert.strictEqual(value, true);
    });
  });

  describe('日期时间字段', () => {
    it('应生成出生日期', () => {
      const value = generateFieldValue('birthDate', 'DateTime');
      assert.strictEqual(value, '1990-01-15');
    });

    it('应生成创建日期', () => {
      const value = generateFieldValue('createdAt', 'DateTime');
      assert.strictEqual(value, '2024-01-01T10:00:00Z');
    });

    it('应生成过期日期', () => {
      const value = generateFieldValue('expiresAt', 'DateTime');
      assert.strictEqual(value, '2025-12-31');
    });
  });

  describe('类型转换', () => {
    it('应将浮点数转换为整数', () => {
      // 贷款金额是 50000.0，但类型是 Int
      const value = generateFieldValue('loanAmount', 'Int');
      assert.strictEqual(value, 50000);
      assert.ok(Number.isInteger(value), '应该是整数');
    });

    it('应将整数转换为浮点数', () => {
      // 年龄是 35，但类型是 Float
      const value = generateFieldValue('age', 'Float');
      assert.strictEqual(value, 35);
    });

    it('应将布尔值转换为字符串', () => {
      const value = generateFieldValue('isApproved', 'Text');
      assert.strictEqual(value, 'true');
    });
  });

  describe('默认值生成', () => {
    it('应为未知字段生成整数默认值', () => {
      const value = generateFieldValue('unknownField', 'Int');
      assert.strictEqual(value, 0);
    });

    it('应为未知字段生成浮点数默认值', () => {
      const value = generateFieldValue('unknownField', 'Float');
      assert.strictEqual(value, 0.0);
    });

    it('应为未知字段生成布尔默认值', () => {
      const value = generateFieldValue('unknownField', 'Bool');
      assert.strictEqual(value, false);
    });

    it('应为未知字段生成文本默认值', () => {
      const value = generateFieldValue('unknownField', 'Text');
      assert.strictEqual(value, '');
    });

    it('应为 struct 类型生成空对象', () => {
      const value = generateFieldValue('userInfo', 'Object', 'struct');
      assert.deepStrictEqual(value, {});
    });

    it('应为 list 类型生成空数组', () => {
      const value = generateFieldValue('items', 'Array', 'list');
      assert.deepStrictEqual(value, []);
    });
  });
});

describe('generateInputValues', () => {
  it('应为参数列表生成完整输入', () => {
    const parameters: ParameterInfo[] = [
      { name: 'creditScore', type: 'Int', typeKind: 'primitive', optional: false, position: 0 },
      { name: 'loanAmount', type: 'Float', typeKind: 'primitive', optional: false, position: 1 },
      { name: 'isApproved', type: 'Bool', typeKind: 'primitive', optional: false, position: 2 },
    ];

    const result = generateInputValues(parameters);

    assert.deepStrictEqual(result, {
      creditScore: 720,
      loanAmount: 50000.0,
      isApproved: true,
    });
  });

  it('应为嵌套结构生成输入', () => {
    const parameters: ParameterInfo[] = [
      {
        name: 'applicant',
        type: 'Applicant',
        typeKind: 'struct',
        optional: false,
        position: 0,
        fields: [
          { name: 'age', type: 'Int', typeKind: 'primitive' },
          { name: 'creditScore', type: 'Int', typeKind: 'primitive' },
          { name: 'annualIncome', type: 'Float', typeKind: 'primitive' },
        ],
      },
    ];

    const result = generateInputValues(parameters);

    assert.deepStrictEqual(result, {
      applicant: {
        age: 35,
        creditScore: 720,
        annualIncome: 85000.0,
      },
    });
  });

  it('应为列表类型生成包含示例元素的数组', () => {
    const parameters: ParameterInfo[] = [
      { name: 'scores', type: 'Int', typeKind: 'list', optional: false, position: 0 },
    ];

    const result = generateInputValues(parameters);

    assert.ok(Array.isArray(result.scores), '应该是数组');
    assert.strictEqual((result.scores as unknown[]).length, 1);
  });
});

describe('getFieldValueHint', () => {
  it('应返回字段值提示', () => {
    const hint = getFieldValueHint('creditScore', 'Int');
    assert.strictEqual(hint, '720');
  });

  it('应返回字符串类型的提示', () => {
    const hint = getFieldValueHint('applicantName', 'Text');
    assert.strictEqual(hint, 'John Smith');
  });
});
