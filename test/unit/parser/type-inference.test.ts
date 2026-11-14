/**
 * 类型推断引擎单元测试（ADR 0056 §3.2：分词 + 词表，与词法表无关）。
 * 全量对照见 type-inference-vectors.test.ts（aster-lang-locales 共用测试向量）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { inferFieldType, tokenize, constraintType, refine } from '../../../src/parser/type-inference.js';
import type { Constraint, Type } from '../../../src/types.js';

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
  describe('分词', () => {
    it('驼峰、全大写缩写、snake_case 与数字', () => {
      assert.deepStrictEqual(tokenize('interestRateAPR'), ['interest', 'rate', 'apr']);
      assert.deepStrictEqual(tokenize('userID'), ['user', 'id']);
      assert.deepStrictEqual(tokenize('days_since_consent'), ['days', 'since', 'consent']);
      assert.deepStrictEqual(tokenize('pre_auth__Code'), ['pre', 'auth', 'code']);
      assert.deepStrictEqual(tokenize('abc123Score'), ['abc', '123', 'score']);
    });

    it('含非 ASCII 字符的名字词列表为空', () => {
      assert.deepStrictEqual(tokenize('是否成年'), []);
      assert.deepStrictEqual(tokenize('kundeGültig'), []);
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

    describe('布尔类型推断', () => {
      it('应该将 is* 前缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('isActive')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('isApproved')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('isVerified')), 'Bool');
      });

      it('应该将 has* 前缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('hasPermission')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('hasAccess')), 'Bool');
      });

      it('应该将 can*/should*/allow* 前缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('canEdit')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('shouldNotify')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('allowAccess')), 'Bool');
      });

      it('应该将 *Flag/*Enabled/*Active 后缀推断为 Bool', () => {
        assert.strictEqual(getTypeName(inferFieldType('debugFlag')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('featureEnabled')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('accountActive')), 'Bool');
      });

    });

    describe('日期时间类型推断', () => {
      it('应该将 *Date/*Time 后缀推断为 DateTime', () => {
        assert.strictEqual(getTypeName(inferFieldType('birthDate')), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('startTime')), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('expiryDate')), 'DateTime');
      });

      it('应该将 *At/*Timestamp 后缀推断为 DateTime', () => {
        assert.strictEqual(getTypeName(inferFieldType('createdAt')), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('updatedAt')), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('eventTimestamp')), 'DateTime');
      });

      it('应该将 *Created/*Updated/*Modified 后缀推断为 DateTime', () => {
        assert.strictEqual(getTypeName(inferFieldType('dateCreated')), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('lastUpdated')), 'DateTime');
        assert.strictEqual(getTypeName(inferFieldType('lastModified')), 'DateTime');
      });

    });

    describe('与词法表无关：三种语言的规则对所有名字生效', () => {
      it('中文、德语名字照常推断', () => {
        assert.strictEqual(getTypeName(inferFieldType('是否成年')), 'Bool');
        assert.strictEqual(getTypeName(inferFieldType('信用评分')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('kundeGueltig')), 'Bool');
      });
    });

    describe('默认类型推断', () => {
      it('无法匹配规则时应该返回 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('data')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('xyz')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('info')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('something')), 'Text');
      });

      it('*Value 后缀应该推断为 Int', () => {
        assert.strictEqual(getTypeName(inferFieldType('value')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('vehicleValue')), 'Int');
        assert.strictEqual(getTypeName(inferFieldType('totalValue')), 'Int');
      });

      it('明确的文本字段应该返回 Text', () => {
        assert.strictEqual(getTypeName(inferFieldType('firstName')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('description')), 'Text');
        assert.strictEqual(getTypeName(inferFieldType('emailAddress')), 'Text');
      });
    });
  });

  const pattern: Constraint = { kind: 'Pattern', regexp: '^[A-Z]+$', span: freshSpan() };
  const required: Constraint = { kind: 'Required', span: freshSpan() };

  describe('约束类型（第 5 步）', () => {

    it('Range 按端点规范十进制串是否含小数点区分 Int / Float', () => {
      assert.strictEqual(constraintType([{ kind: 'Range', min: 0, minRaw: '0', max: 100, maxRaw: '100', span: freshSpan() }]), 'Int');
      assert.strictEqual(constraintType([{ kind: 'Range', min: 0.5, minRaw: '0.5', max: 1.5, maxRaw: '1.5', span: freshSpan() }]), 'Float');
      assert.strictEqual(constraintType([{ kind: 'Range', min: 18, minRaw: '18', span: freshSpan() }]), 'Int');
      assert.strictEqual(constraintType([{ kind: 'Range', max: 99.99, maxRaw: '99.99', span: freshSpan() }]), 'Float');
    });

    it('端点原文 1.0 的规范串是 1，不算小数', () => {
      assert.strictEqual(constraintType([{ kind: 'Range', min: 1, minRaw: '1.0', max: 2, maxRaw: '2.00', span: freshSpan() }]), 'Int');
    });

    it('Pattern 得 Text，Required 不影响', () => {
      assert.strictEqual(constraintType([pattern]), 'Text');
      assert.strictEqual(constraintType([required]), null);
      assert.strictEqual(constraintType([required, { kind: 'Range', min: 0, minRaw: '0', max: 100, maxRaw: '100', span: freshSpan() }]), 'Int');
    });

    it('Range 优先于 Pattern，与书写顺序无关', () => {
      assert.strictEqual(constraintType([pattern, { kind: 'Range', min: 1, minRaw: '1', max: 10, maxRaw: '10', span: freshSpan() }]), 'Int');
      assert.strictEqual(constraintType([{ kind: 'Range', min: 1, minRaw: '1', max: 10, maxRaw: '10', span: freshSpan() }, pattern]), 'Int');
    });

    it('多个 Range 中任一端点为小数即 Float', () => {
      assert.strictEqual(constraintType([{ kind: 'Range', min: 0, minRaw: '0', max: 100, maxRaw: '100', span: freshSpan() }, { kind: 'Range', min: 0.5, minRaw: '0.5', span: freshSpan() }]), 'Float');
    });
  });

  describe('名字结果与约束合并', () => {
    it('合并规则', () => {
      assert.strictEqual(refine('Text', 'Int'), 'Int');
      assert.strictEqual(refine('Text', 'Float'), 'Float');
      assert.strictEqual(refine('Int', 'Float'), 'Float');
      assert.strictEqual(refine('Float', 'Int'), 'Float');
      assert.strictEqual(refine('Bool', 'Int'), 'Bool');
      assert.strictEqual(refine('Int', 'Text'), 'Int');
      assert.strictEqual(refine('Text', null), 'Text');
    });

    it('inferFieldType 先按名字、再按约束修正', () => {
      assert.strictEqual(getTypeName(inferFieldType('data', [{ kind: 'Range', min: 1, minRaw: '1', max: 100, maxRaw: '100', span: freshSpan() }])), 'Int');
      assert.strictEqual(getTypeName(inferFieldType('score', [pattern])), 'Int');
      assert.strictEqual(getTypeName(inferFieldType('approved', [{ kind: 'Range', min: 0, minRaw: '0', max: 1, maxRaw: '1', span: freshSpan() }])), 'Bool');
      assert.strictEqual(getTypeName(inferFieldType('loanAmount', [])), 'Float');
    });
  });

  /**
   * 双引擎 parity 回归（aster-lang-core issue #80 / #82 / #83）。
   *
   * 下表与 aster-lang-core `TypeInferenceTest.shouldMatchTsEngineInference` 逐字对应；
   * 规则统一后（ADR 0056）两侧还共同运行 locales 的共用测试向量。
   */
  describe('双引擎 parity 回归', () => {
    const CASES: ReadonlyArray<readonly [string, string]> = [
      // #80：-age 结尾的普通单词曾被 Age$ 规则误判为 Int
      ['usage', 'Text'],
      ['language', 'Text'],
      ['package', 'Text'],
      ['storage', 'Text'],
      ['voltage', 'Text'],
      ['mileage', 'Text'],
      ['coverage', 'Text'],
      // #80：Message/Dosage 需为 Text（dosage 还同时踩 -age 陷阱）
      ['errorMessage', 'Text'],
      ['message', 'Text'],
      ['dosage', 'Text'],
      // Age 作为完整词或 camelCase 词段仍应是 Int
      ['age', 'Int'],
      ['userAge', 'Int'],
      ['personAge', 'Int'],
      // #82：布尔前缀缺驼峰边界，把这些误判为 Bool
      ['canceledAt', 'DateTime'],
      ['validatedAt', 'DateTime'],
      ['wasteAmount', 'Float'],
      ['isbnCode', 'Text'],
      // 真正的布尔前缀必须仍然有效
      ['isValid', 'Bool'],
      ['hasErrors', 'Bool'],
      ['canSubmit', 'Bool'],
      ['is', 'Bool'],
      // #83：Success/Passed/Verified 后缀
      ['loginVerified', 'Bool'],
      ['taskPassed', 'Bool'],
      ['paymentSuccess', 'Bool'],
      // *Valid 不得被 Id$ 规则吞掉（此前 /(?:Id)$/i 让 "Val-id" 命中 → Text）
      ['approvedValid', 'Bool'],
      ['expiredValid', 'Bool'],
      // camelCase 的真 Id 仍是 Text
      ['userId', 'Text'],
      ['orderIdentifier', 'Text'],
      // snake_case 也必须走词边界（corpus hipaa-validation-demo 用 requires_consent，
      // 该字段被赋 true/false，若推成 Text 会让整份合规样本编译失败）
      ['requires_consent', 'Bool'],
      ['is_active', 'Bool'],
      ['has_consent', 'Bool'],
      ['validated_at', 'DateTime'],
      // 时间单位支持中间位置匹配
      ['daysRemaining', 'Int'],
      ['termMonths', 'Int'],
      ['days', 'Int'],
    ];

    for (const [fieldName, expected] of CASES) {
      it(`${fieldName} → ${expected}`, () => {
        assert.strictEqual(getTypeName(inferFieldType(fieldName)), expected);
      });
    }
  });
});
