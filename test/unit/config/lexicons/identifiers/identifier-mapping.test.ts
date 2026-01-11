/**
 * @module test/unit/config/lexicons/identifiers/identifier-mapping.test
 *
 * 标识符映射模块单元测试。
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  vocabularyRegistry,
  initBuiltinVocabularies,
  canonicalizeIdentifier,
  localizeIdentifier,
  hasIdentifierMapping,
  buildIdentifierIndex,
  validateVocabulary,
  IdentifierKind,
  INSURANCE_AUTO_ZH_CN,
  FINANCE_LOAN_ZH_CN,
} from '../../../../../src/config/lexicons/identifiers/index.js';

describe('标识符映射模块', () => {
  beforeEach(() => {
    vocabularyRegistry.clear();
    initBuiltinVocabularies();
  });

  describe('词汇表验证', () => {
    it('验证汽车保险词汇表', () => {
      const result = validateVocabulary(INSURANCE_AUTO_ZH_CN);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('验证贷款金融词汇表', () => {
      const result = validateVocabulary(FINANCE_LOAN_ZH_CN);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('检测无效的规范化名称', () => {
      const invalidVocab = {
        id: 'test',
        name: 'Test',
        locale: 'zh-CN',
        version: '1.0.0',
        structs: [
          {
            canonical: '无效名称', // 非 ASCII
            localized: '测试',
            kind: IdentifierKind.STRUCT,
          },
        ],
        fields: [],
        functions: [],
      };

      const result = validateVocabulary(invalidVocab);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('无效名称')));
    });
  });

  describe('索引构建', () => {
    it('构建双向映射索引', () => {
      const index = buildIdentifierIndex(INSURANCE_AUTO_ZH_CN);

      // 测试本地化 → 规范化
      assert.strictEqual(index.toCanonical.get('驾驶员'), 'Driver');
      assert.strictEqual(index.toCanonical.get('年龄'), 'age');
      assert.strictEqual(index.toCanonical.get('月保费'), 'monthlyPremium');

      // 测试规范化 → 本地化
      assert.strictEqual(index.toLocalized.get('driver'), '驾驶员');
      assert.strictEqual(index.toLocalized.get('quoteresult'), '报价结果');
    });

    it('支持别名映射', () => {
      const index = buildIdentifierIndex(INSURANCE_AUTO_ZH_CN);

      // 别名应该也能映射到规范化名称
      assert.strictEqual(index.toCanonical.get('司机'), 'Driver');
      assert.strictEqual(index.toCanonical.get('驾驶人'), 'Driver');
      assert.strictEqual(index.toCanonical.get('车牌'), 'plateNo');
    });

    it('按类型分类映射', () => {
      const index = buildIdentifierIndex(INSURANCE_AUTO_ZH_CN);

      const structs = index.byKind.get(IdentifierKind.STRUCT);
      assert.ok(structs?.has('驾驶员'));
      assert.ok(structs?.has('车辆'));

      const fields = index.byKind.get(IdentifierKind.FIELD);
      assert.ok(fields?.has('年龄'));
      assert.ok(fields?.has('驾龄'));

      const functions = index.byKind.get(IdentifierKind.FUNCTION);
      assert.ok(functions?.has('生成报价'));
    });

    it('按父结构体索引字段', () => {
      const index = buildIdentifierIndex(INSURANCE_AUTO_ZH_CN);

      const driverFields = index.fieldsByParent.get('Driver');
      assert.ok(driverFields?.has('年龄'));
      assert.ok(driverFields?.has('驾龄'));

      const vehicleFields = index.fieldsByParent.get('Vehicle');
      assert.ok(vehicleFields?.has('车牌号'));
      assert.ok(vehicleFields?.has('安全评分'));
    });
  });

  describe('标识符转换', () => {
    it('本地化到规范化', () => {
      const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN')!;

      assert.strictEqual(canonicalizeIdentifier(index, '驾驶员'), 'Driver');
      assert.strictEqual(canonicalizeIdentifier(index, '报价结果'), 'QuoteResult');
      assert.strictEqual(canonicalizeIdentifier(index, '计算保费'), 'calculatePremium');
    });

    it('规范化到本地化', () => {
      const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN')!;

      assert.strictEqual(localizeIdentifier(index, 'Driver'), '驾驶员');
      assert.strictEqual(localizeIdentifier(index, 'QuoteResult'), '报价结果');
      assert.strictEqual(localizeIdentifier(index, 'monthlyPremium'), '月保费');
    });

    it('未映射的标识符返回原值', () => {
      const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN')!;

      assert.strictEqual(canonicalizeIdentifier(index, '未知标识符'), '未知标识符');
      assert.strictEqual(localizeIdentifier(index, 'UnknownIdentifier'), 'UnknownIdentifier');
    });

    it('大小写不敏感', () => {
      const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN')!;

      assert.strictEqual(canonicalizeIdentifier(index, '驾驶员'), 'Driver');
      assert.strictEqual(localizeIdentifier(index, 'DRIVER'), '驾驶员');
      assert.strictEqual(localizeIdentifier(index, 'driver'), '驾驶员');
    });
  });

  describe('注册中心', () => {
    it('获取已注册的词汇表', () => {
      const entry = vocabularyRegistry.get('insurance.auto', 'zh-CN');
      assert.ok(entry);
      assert.strictEqual(entry?.vocabulary.id, 'insurance.auto');
      assert.strictEqual(entry?.vocabulary.locale, 'zh-CN');
    });

    it('列出所有领域', () => {
      const domains = vocabularyRegistry.listDomains('zh-CN');
      assert.ok(domains.includes('insurance.auto'));
      assert.ok(domains.includes('finance.loan'));
    });

    it('按语言列出词汇表', () => {
      const vocabs = vocabularyRegistry.listByLocale('zh-CN');
      assert.ok(vocabs.length >= 2);
      assert.ok(vocabs.some(v => v.id === 'insurance.auto'));
      assert.ok(vocabs.some(v => v.id === 'finance.loan'));
    });

    it('合并多个领域词汇表', () => {
      const merged = vocabularyRegistry.merge(
        ['insurance.auto', 'finance.loan'],
        'zh-CN'
      );

      assert.ok(merged);
      assert.strictEqual(merged!.id, 'insurance.auto+finance.loan');

      // 验证合并后包含两个领域的结构体
      const structNames = merged!.structs.map(s => s.canonical);
      assert.ok(structNames.includes('Driver'));
      assert.ok(structNames.includes('Applicant'));
    });
  });

  describe('自定义词汇表', () => {
    it('注册和使用租户自定义词汇表', () => {
      const customVocab = {
        id: 'insurance.auto',
        name: '自定义汽车保险',
        locale: 'zh-CN',
        version: '1.0.0',
        structs: [
          {
            canonical: 'CustomDriver',
            localized: '自定义驾驶员',
            kind: IdentifierKind.STRUCT,
          },
        ],
        fields: [],
        functions: [],
      };

      vocabularyRegistry.registerCustom('tenant-123', customVocab);

      // 使用租户 ID 查询时应返回自定义词汇表
      const entry = vocabularyRegistry.getWithCustom(
        'tenant-123',
        'insurance.auto',
        'zh-CN'
      );
      assert.strictEqual(entry?.vocabulary.name, '自定义汽车保险');

      // 不使用租户 ID 时应返回内置词汇表
      const builtinEntry = vocabularyRegistry.getWithCustom(
        undefined,
        'insurance.auto',
        'zh-CN'
      );
      assert.strictEqual(builtinEntry?.vocabulary.name, '汽车保险');
    });
  });

  describe('贷款金融领域', () => {
    it('贷款领域标识符转换', () => {
      const index = vocabularyRegistry.getIndex('finance.loan', 'zh-CN')!;

      assert.strictEqual(canonicalizeIdentifier(index, '申请人'), 'Applicant');
      assert.strictEqual(canonicalizeIdentifier(index, '贷款申请'), 'LoanRequest');
      assert.strictEqual(canonicalizeIdentifier(index, '信用评分'), 'creditScore');
      assert.strictEqual(canonicalizeIdentifier(index, '评估贷款'), 'evaluateLoan');
    });

    it('支持贷款领域别名', () => {
      const index = vocabularyRegistry.getIndex('finance.loan', 'zh-CN')!;

      assert.strictEqual(canonicalizeIdentifier(index, '借款人'), 'Applicant');
      assert.strictEqual(canonicalizeIdentifier(index, '征信分'), 'creditScore');
      assert.strictEqual(canonicalizeIdentifier(index, '工龄'), 'workYears');
    });
  });
});
