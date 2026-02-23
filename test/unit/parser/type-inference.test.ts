/**
 * 类型推断引擎单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  inferFieldType,
  inferTypeFromConstraints,
  refineInferredType,
  BASE_NAMING_RULES,
} from '../../../src/parser/type-inference.js';
import type { Constraint, ConstraintRange, ConstraintPattern, Type } from '../../../src/types.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { attachTypeInferenceRules } from '../../../src/config/lexicons/type-inference-rules.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

/** en-US lexicon 附带类型推断规则 */
const enUS: Lexicon = attachTypeInferenceRules(EN_US);

/** 辅助函数：创建 span */
const freshSpan = () => ({ start: { line: 1, col: 1 }, end: { line: 1, col: 1 } });

/** 辅助函数：获取类型名称 */
function getTypeName(type: Type): string {
  if (type.kind === 'TypeName') {
    return type.name;
  }
  return type.kind;
}

describe('类型推断引擎', () => {
  describe('BASE_NAMING_RULES 基线规则', () => {
    it('基线规则应包含语言无关的通用类型', () => {
      const typesCovered = new Set(BASE_NAMING_RULES.map(r => r.type));
      assert.ok(typesCovered.has('Text'), '应包含 Text 规则');
      assert.ok(typesCovered.has('Int'), '应包含 Int 规则');
      assert.ok(typesCovered.has('Float'), '应包含 Float 规则');
    });

    it('附加 en-US overlay 后应包含所有类型', () => {
      const rules = enUS.typeInferenceRules!;
      const overlayTypes = new Set(rules.map(r => r.type));
      const baseTypes = new Set(BASE_NAMING_RULES.map(r => r.type));
      const allTypes = new Set([...baseTypes, ...overlayTypes]);
      assert.ok(allTypes.has('Bool'), '应包含 Bool 规则');
      assert.ok(allTypes.has('DateTime'), '应包含 DateTime 规则');
    });
  });

  describe('inferFieldType 字段类型推断', () => {
    describe('ID 类型推断', () => {
      it('应该将 *Id 后缀推断为 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('applicantId')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('userId')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('orderId')), 'Text');
      });

      it('应该将 *ID 后缀推断为 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('userID')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('transactionID')), 'Text');
      });

      it('应该将 *Identifier 后缀推断为 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('taxIdentifier')), 'Text');
      });

      it('应该将 *Code/*Key/*Token 推断为 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('productCode')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('apiKey')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('accessToken')), 'Text');
      });
    });

    describe('金额类型推断', () => {
      it('应该将 *Amount 后缀推断为 Float', () => {
        assert.strictEqual(getTypeName(inferFieldType('loanAmount')), 'Float');
        assert.strictEqual(getTypeName(inferFieldType('totalAmount')), 'Float');
      });

      it('应该将 *Price/*Cost/*Fee 后缀推断为 Float', () => {
        assert.strictEqual(getTypeName(inferFieldType('unitPrice')), 'Float');
        assert.strictEqual(getTypeName(inferFieldType('shippingCost')), 'Float');
        assert.strictEqual(getTypeName(inferFieldType('serviceFee')), 'Float');
      });

      it('应该将 *Balance/*Salary/*Income 后缀推断为 Float', () => {
        assert.strictEqual(getTypeName(inferFieldType('accountBalance')), 'Float');
        assert.strictEqual(getTypeName(inferFieldType('monthlySalary')), 'Float');
        assert.strictEqual(getTypeName(inferFieldType('annualIncome')), 'Float');
      });

      it('应该将 *Rate/*Percentage 后缀推断为 Float', () => {
        assert.strictEqual(getTypeName(inferFieldType('interestRate')), 'Float');
        assert.strictEqual(getTypeName(inferFieldType('taxPercentage')), 'Float');
      });
    });

    describe('整数类型推断', () => {
      it('应该将 *Count/*Number/*Qty 后缀推断为 Int', () => {
        assert.strictEqual(getTypeName(inferFieldType('itemCount')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('orderNumber')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('productQty')), 'Int');
      });

      it('应该将 *Age/*Score/*Level 后缀推断为 Int', () => {
        assert.strictEqual(getTypeName(inferFieldType('age')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('creditScore')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('memberLevel')), 'Int');
      });

      it('应该将时间单位后缀推断为 Int', () => {
        assert.strictEqual(getTypeName(inferFieldType('termMonths')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('remainingDays')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('expiryYears')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('timeoutMinutes')), 'Int');
      });

      it('应该将 *Size/*Length/*Index 后缀推断为 Int', () => {
        assert.strictEqual(getTypeName(inferFieldType('pageSize')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('arrayLength')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('currentIndex')), 'Int');
      });
    });

    describe('布尔类型推断（需要 en-US overlay）', () => {
      it('应该将 is* 前缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('isActive', [], enUS)), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('isApproved', [], enUS)), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('isVerified', [], enUS)), 'Bool');
      });

      it('应该将 has* 前缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('hasPermission', [], enUS)), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('hasAccess', [], enUS)), 'Bool');
      });

      it('应该将 can*/should*/allow* 前缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('canEdit', [], enUS)), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('shouldNotify', [], enUS)), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('allowAccess', [], enUS)), 'Bool');
      });

      it('应该将 *Flag/*Enabled/*Active 后缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('debugFlag', [], enUS)), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('featureEnabled', [], enUS)), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('accountActive', [], enUS)), 'Bool');
      });

      it('无 lexicon 时不应推断 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('isActive')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('hasPermission')), 'Text');
      });
    });

    describe('日期时间类型推断（需要 en-US overlay）', () => {
      it('应该将 *Date/*Time 后缀推断为 DateTime', () => {
        assert.strictEqual(getTypeName(inferFieldType('birthDate', [], enUS)), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('startTime', [], enUS)), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('expiryDate', [], enUS)), 'DateTime');
      });

      it('应该将 *At/*Timestamp 后缀推断为 DateTime', () => {
        assert.strictEqual(getTypeName(inferFieldType('createdAt', [], enUS)), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('updatedAt', [], enUS)), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('eventTimestamp', [], enUS)), 'DateTime');
      });

      it('应该将 *Created/*Updated/*Modified 后缀推断为 DateTime', () => {
        assert.strictEqual(getTypeName(inferFieldType('dateCreated', [], enUS)), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('lastUpdated', [], enUS)), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('lastModified', [], enUS)), 'DateTime');
      });

      it('无 lexicon 时不应推断 DateTime', () => {
        assert.strictEqual(getTypeName(inferFieldType('birthDate')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('createdAt')), 'Text');
      });
    });

    describe('默认类型推断', () => {
      it('无法匹配规则时应该返回 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('data')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('xyz')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('info')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('something')), 'Text');
      });

      it('*Value 后缀应该推断为 Int（需要 en-US overlay）', () => {
        assert.strictEqual(getTypeName(inferFieldType('value', [], enUS)), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('vehicleValue', [], enUS)), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('totalValue', [], enUS)), 'Int');
      });

      it('明确的文本字段应该返回 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('firstName')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('description')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('emailAddress')), 'Text');
      });
    });
  });

  describe('inferTypeFromConstraints 约束驱动推断', () => {
    it('Range 约束（整数边界）应该推断为 Int', () => {
      const constraints: Constraint[] = [
        { kind: 'Range', min: 0, max: 100, span: freshSpan() },
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), 'Int');
    });

    it('Range 约束（小数边界）应该推断为 Float', () => {
      const constraints: Constraint[] = [
        { kind: 'Range', min: 0.5, max: 1.5, span: freshSpan() },
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), 'Float');
    });

    it('Range 约束（仅最小值，整数）应该推断为 Int', () => {
      const constraints: Constraint[] = [
        { kind: 'Range', min: 18, span: freshSpan() },
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), 'Int');
    });

    it('Range 约束（仅最大值，小数）应该推断为 Float', () => {
      const constraints: Constraint[] = [
        { kind: 'Range', max: 99.99, span: freshSpan() },
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), 'Float');
    });

    it('Pattern 约束应该推断为 Text', () => {
      const constraints: Constraint[] = [
        { kind: 'Pattern', regexp: '^[A-Z]+$', span: freshSpan() },
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), 'Text');
    });

    it('Required 约束不应该影响类型推断', () => {
      const constraints: Constraint[] = [
        { kind: 'Required', span: freshSpan() },
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), null);
    });

    it('多个约束时应该综合考虑', () => {
      const constraints: Constraint[] = [
        { kind: 'Required', span: freshSpan() },
        { kind: 'Range', min: 0, max: 100, span: freshSpan() },
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), 'Int');
    });

    it('Int + Float 应该提升为 Float', () => {
      const constraints: Constraint[] = [
        { kind: 'Range', min: 0, max: 100, span: freshSpan() }, // Int
        { kind: 'Range', min: 0.5, span: freshSpan() }, // Float
      ];
      assert.strictEqual(inferTypeFromConstraints(constraints), 'Float');
    });
  });

  describe('refineInferredType 类型修正', () => {
    it('默认 Text 类型应该被 Range 约束修正为 Int', () => {
      const textType = inferFieldType('value'); // 默认 Text
      const constraints: Constraint[] = [
        { kind: 'Range', min: 0, max: 100, span: freshSpan() },
      ];
      const refined = refineInferredType(textType, constraints);
      assert.strictEqual(getTypeName(refined), 'Int');
    });

    it('默认 Text 类型应该被小数 Range 约束修正为 Float', () => {
      const textType = inferFieldType('value');
      const constraints: Constraint[] = [
        { kind: 'Range', min: 0.1, max: 1.5, span: freshSpan() },
      ];
      const refined = refineInferredType(textType, constraints);
      assert.strictEqual(getTypeName(refined), 'Float');
    });

    it('Int 类型应该被小数 Range 约束提升为 Float', () => {
      const intType = inferFieldType('itemCount'); // Int
      const constraints: Constraint[] = [
        { kind: 'Range', min: 0.5, max: 10.5, span: freshSpan() },
      ];
      const refined = refineInferredType(intType, constraints);
      assert.strictEqual(getTypeName(refined), 'Float');
    });

    it('一致的类型不应该被修改', () => {
      const intType = inferFieldType('itemCount'); // Int
      const constraints: Constraint[] = [
        { kind: 'Range', min: 0, max: 100, span: freshSpan() },
      ];
      const refined = refineInferredType(intType, constraints);
      assert.strictEqual(getTypeName(refined), 'Int');
    });

    it('无约束时不应该修改类型', () => {
      const textType = inferFieldType('name');
      const refined = refineInferredType(textType, []);
      assert.strictEqual(getTypeName(refined), 'Text');
    });

    it('仅 Required 约束不应该修改类型', () => {
      const textType = inferFieldType('name');
      const constraints: Constraint[] = [
        { kind: 'Required', span: freshSpan() },
      ];
      const refined = refineInferredType(textType, constraints);
      assert.strictEqual(getTypeName(refined), 'Text');
    });
  });

  describe('约束与命名联合推断', () => {
    it('约束优先于命名推断', () => {
      // name 字段名默认推断为 Text
      // 但有 Range 约束时应该推断为 Int
      const constraints: Constraint[] = [
        { kind: 'Range', min: 1, max: 100, span: freshSpan() },
      ];
      const type = inferFieldType('data', constraints);
      assert.strictEqual(getTypeName(type), 'Int');
    });

    it('无约束时使用命名推断', () => {
      const type = inferFieldType('loanAmount', []);
      assert.strictEqual(getTypeName(type), 'Float');
    });
  });
});
