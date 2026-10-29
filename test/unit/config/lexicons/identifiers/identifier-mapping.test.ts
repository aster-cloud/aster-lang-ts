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
  localizeIdentifier,
  buildIdentifierIndex,
  buildVocabularyScopes,
  lookup,
  validateVocabulary,
  IdentifierKind,
  INSURANCE_AUTO_ZH_CN,
  FINANCE_LOAN_ZH_CN,
} from '../../../../../src/config/lexicons/identifiers/index.js';
import type { IdentifierMapping, VocabularyScopes } from '../../../../../src/config/lexicons/identifiers/index.js';

/** 写法在类型 / 函数 / 各 struct 字段作用域中精确命中的规范名（按位置解析的候选集合）。 */
function canonicalsOf(scopes: VocabularyScopes, written: string): string[] {
  const maps = [scopes.types, scopes.functions, ...scopes.fields.values()];
  return [...new Set(maps.flatMap((m) => lookup(m, written).exact.map((c) => c.canonical)))];
}

function scopesOf(domain: string, tenantId?: string): VocabularyScopes {
  const scopes = vocabularyRegistry.getWithCustom(tenantId, domain, 'zh-CN');
  assert.ok(scopes, `${domain} 应已注册`);
  return scopes;
}

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

  describe('词汇表验证：按角色与作用域判定冲突（ADR 0051）', () => {
    const base = { id: 't', name: 'T', locale: 'de-DE', version: '1', structs: [], functions: [] };
    const field = (canonical: string, localized: string, parent?: string): IdentifierMapping => ({
      canonical, localized, kind: IdentifierKind.FIELD, ...(parent ? { parent } : {}),
    });

    it('不同父类型下的同规范名字段合法，registerCustom 不拒绝', () => {
      const vocab = { ...base, fields: [field('age', 'alter', 'Driver'), field('age', 'alter', 'Car')] };
      const result = validateVocabulary(vocab);
      assert.deepStrictEqual(result.errors, []);
      assert.strictEqual(result.valid, true);
      vocabularyRegistry.registerCustom('tenant-scope', vocab);
      const scopes = vocabularyRegistry.getWithCustom('tenant-scope', 't', 'de-DE');
      assert.deepStrictEqual([...scopes!.fields.keys()].sort(), ['Car', 'Driver']);
    });

    it('同义词（同规范名多写法）与仅大小写不同的写法合法', () => {
      const vocab = {
        ...base,
        structs: [
          { canonical: 'Level', localized: 'Stufe', kind: IdentifierKind.STRUCT },
          { canonical: 'Grade', localized: 'STUFE', kind: IdentifierKind.STRUCT },
        ],
        fields: [field('level', 'stufe', 'Driver'), field('level', 'niveau', 'Driver')],
      };
      assert.deepStrictEqual(validateVocabulary(vocab).errors, []);
    });

    it('同角色同作用域内写法完全相同但规范名不同 → error', () => {
      const vocab = { ...base, fields: [field('age', 'alter', 'Driver'), field('years', 'alter', 'Driver')] };
      const result = validateVocabulary(vocab);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => /写法 "alter" 在 fields\[Driver\] 中对应多个规范名/.test(e)), result.errors.join('\n'));
      assert.throws(() => vocabularyRegistry.registerCustom('tenant-scope', vocab));
    });

    it('NFC 等价写法视为相同写法', () => {
      const vocab = {
        ...base,
        functions: [
          { canonical: 'approve', localized: 'café', kind: IdentifierKind.FUNCTION },
          { canonical: 'reject', localized: 'cafe\u0301', kind: IdentifierKind.FUNCTION },
        ],
        fields: [],
      };
      assert.strictEqual(validateVocabulary(vocab).valid, false);
    });

    it('字段与枚举成员缺 parent → error', () => {
      const vocab = {
        ...base,
        fields: [field('age', 'alter')],
        enumValues: [{ canonical: 'High', localized: 'Hoch', kind: IdentifierKind.ENUM_VALUE }],
      };
      const result = validateVocabulary(vocab);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('字段 "alter" 没有指定父结构体')));
      assert.ok(result.errors.some((e) => e.includes('枚举成员 "Hoch" 没有指定父枚举')));
    });
  });

  describe('索引构建', () => {
    it('构建双向映射：本地化 → 规范化按作用域，规范化 → 本地化走展示索引', () => {
      const index = buildIdentifierIndex(INSURANCE_AUTO_ZH_CN);
      const scopes = buildVocabularyScopes({ ...INSURANCE_AUTO_ZH_CN, enumValues: [] });

      // 测试本地化 → 规范化
      assert.deepStrictEqual(canonicalsOf(scopes, '驾驶员'), ['Driver']);
      assert.deepStrictEqual(canonicalsOf(scopes, '年龄'), ['age']);
      assert.deepStrictEqual(canonicalsOf(scopes, '月保费'), ['monthlyPremium']);

      // 测试规范化 → 本地化
      assert.strictEqual(index.toLocalized.get('driver'), '驾驶员');
      assert.strictEqual(index.toLocalized.get('quoteresult'), '报价结果');
    });

    it('支持别名映射', () => {
      const scopes = scopesOf('insurance.auto');

      // 别名（synonym 候选）也能映射到规范化名称
      assert.deepStrictEqual(canonicalsOf(scopes, '司机'), ['Driver']);
      assert.deepStrictEqual(canonicalsOf(scopes, '驾驶人'), ['Driver']);
      assert.deepStrictEqual(canonicalsOf(scopes, '车牌'), ['plateNo']);
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
      const scopes = scopesOf('insurance.auto');

      assert.deepStrictEqual(canonicalsOf(scopes, '驾驶员'), ['Driver']);
      assert.deepStrictEqual(canonicalsOf(scopes, '报价结果'), ['QuoteResult']);
      assert.deepStrictEqual(canonicalsOf(scopes, '计算保费'), ['calculatePremium']);
    });

    it('规范化到本地化', () => {
      const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN')!;

      assert.strictEqual(localizeIdentifier(index, 'Driver'), '驾驶员');
      assert.strictEqual(localizeIdentifier(index, 'QuoteResult'), '报价结果');
      assert.strictEqual(localizeIdentifier(index, 'monthlyPremium'), '月保费');
    });

    it('未映射的标识符返回原值', () => {
      const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN')!;

      assert.deepStrictEqual(canonicalsOf(scopesOf('insurance.auto'), '未知标识符'), []);
      assert.strictEqual(localizeIdentifier(index, 'UnknownIdentifier'), 'UnknownIdentifier');
    });

    it('大小写不敏感', () => {
      const index = vocabularyRegistry.getIndex('insurance.auto', 'zh-CN')!;

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

      // 使用租户 ID 查询时应返回自定义词汇的作用域
      const custom = scopesOf('insurance.auto', 'tenant-123');
      assert.deepStrictEqual(canonicalsOf(custom, '自定义驾驶员'), ['CustomDriver']);
      assert.deepStrictEqual(canonicalsOf(custom, '驾驶员'), []);

      // 不使用租户 ID 时应返回内置词汇的作用域
      const builtin = scopesOf('insurance.auto');
      assert.deepStrictEqual(canonicalsOf(builtin, '驾驶员'), ['Driver']);
      assert.deepStrictEqual(canonicalsOf(builtin, '自定义驾驶员'), []);
    });
  });

  describe('注册中心的词汇作用域', () => {
    it('没有所属类型的字段 / 枚举成员：registerCustom 拒绝（ADR 0051 §14 第 3 条）', () => {
      assert.throws(
        () => vocabularyRegistry.registerCustom('tenant-scope', {
          id: 'scope.test',
          name: '作用域',
          locale: 'zh-CN',
          version: '1.0.0',
          structs: [{ canonical: 'Level', localized: '等级', kind: IdentifierKind.STRUCT }],
          fields: [
            { canonical: 'score', localized: '分数', kind: IdentifierKind.FIELD, parent: 'Level' },
            { canonical: 'orphan', localized: '孤立', kind: IdentifierKind.FIELD },
          ],
          functions: [],
          enumValues: [
            { canonical: 'High', localized: '高', kind: IdentifierKind.ENUM_VALUE, parent: 'Level' },
            { canonical: 'Low', localized: '低', kind: IdentifierKind.ENUM_VALUE },
          ],
        }),
        /字段 "孤立" 没有指定父结构体[\s\S]*枚举成员 "低" 没有指定父枚举/,
      );
      assert.strictEqual(vocabularyRegistry.getWithCustom('tenant-scope', 'scope.test', 'zh-CN'), undefined);
    });

    it('内置词汇的枚举成员归属到各自的枚举（14 个成员）', () => {
      const members = (domain: string): Record<string, string[]> =>
        Object.fromEntries(
          [...scopesOf(domain).enumMembers.entries()].map(([parent, byKey]) => [
            parent,
            [...new Set([...byKey.values()].flatMap((cs) => cs.map((c) => c.canonical)))].sort(),
          ])
        );
      assert.deepStrictEqual(members('finance.loan'), {
        CreditLevel: ['Excellent', 'Fair', 'Good', 'Poor'],
        LoanType: ['Auto', 'Business', 'Mortgage', 'Personal'],
      });
      assert.deepStrictEqual(members('insurance.auto'), {
        QuoteStatus: ['Approved', 'Pending', 'Rejected'],
        RiskLevel: ['HighRisk', 'LowRisk', 'MediumRisk'],
      });
      assert.deepStrictEqual(canonicalsOf(scopesOf('insurance.auto'), '驾驶员'), ['Driver']);
    });
  });

  describe('贷款金融领域', () => {
    it('贷款领域标识符转换', () => {
      const scopes = scopesOf('finance.loan');

      assert.deepStrictEqual(canonicalsOf(scopes, '申请人'), ['Applicant']);
      assert.deepStrictEqual(canonicalsOf(scopes, '贷款申请'), ['LoanRequest']);
      assert.deepStrictEqual(canonicalsOf(scopes, '信用评分'), ['creditScore']);
      assert.deepStrictEqual(canonicalsOf(scopes, '评估贷款'), ['evaluateLoan']);
    });

    it('支持贷款领域别名', () => {
      const scopes = scopesOf('finance.loan');

      assert.deepStrictEqual(canonicalsOf(scopes, '借款人'), ['Applicant']);
      assert.deepStrictEqual(canonicalsOf(scopes, '征信分'), ['creditScore']);
      assert.deepStrictEqual(canonicalsOf(scopes, '工龄'), ['workYears']);
    });
  });
});
