/**
 * manifest.json 的 JSON Schema（内联常量）
 *
 * 为什么内联而不是运行时读文件：npm 包只发布 dist/，仓库根的
 * manifest.schema.json 不在产物里；运行时按相对路径回溯读取在本地开发
 * 恰好命中仓库根，到了消费者的 node_modules 里文件就不存在，schema 校验
 * 被静默跳过，非法 manifest 全量放行。内联后校验函数与代码同包同版本，
 * 不再依赖任何文件布局。
 *
 * 仓库根的 manifest.schema.json 仍保留给编辑器 / 外部工具引用，
 * 由 test/unit/manifest-schema.test.ts 断言两者逐字段一致。
 */

import type { SchemaObject } from 'ajv';

/** 与 shared/capabilities.json displayName 单源对齐的能力枚举 */
const CAPABILITY_ENUM = [
  'Http',
  'Network',
  'Sql',
  'Time',
  'Files',
  'Secrets',
  'Crypto',
  'Process',
  'AiModel',
  'Cpu',
  'Payment',
  'Inventory',
];

/** 依赖版本约束：^1.0.0 / ~1.0.0 / 1.0.0 */
const VERSION_CONSTRAINT_PATTERN = '^(\\^|~)?\\d+\\.\\d+\\.\\d+$';

export const MANIFEST_SCHEMA: SchemaObject = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '包名称，使用点号分隔的标识符（如 aster.finance.loan）',
      pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$',
    },
    version: {
      type: 'string',
      description: '包版本，遵循 SemVer 规范',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
    },
    description: {
      type: 'string',
      description: '包的一句话描述，供 aster search 结果展示',
    },
    dependencies: {
      type: 'object',
      description: '生产依赖包及其版本约束',
      additionalProperties: {
        type: 'string',
        pattern: VERSION_CONSTRAINT_PATTERN,
      },
      default: {},
    },
    devDependencies: {
      type: 'object',
      description: '开发依赖包及其版本约束',
      additionalProperties: {
        type: 'string',
        pattern: VERSION_CONSTRAINT_PATTERN,
      },
      default: {},
    },
    effects: {
      type: 'array',
      description: '该包导出的自定义效果类型',
      items: {
        type: 'string',
        pattern: '^[A-Z][a-zA-Z0-9]*$',
      },
      default: [],
    },
    capabilities: {
      type: 'object',
      description: '包需要的系统能力（可选，向后兼容）',
      properties: {
        allow: {
          type: 'array',
          items: { enum: CAPABILITY_ENUM },
        },
        deny: {
          type: 'array',
          items: { enum: CAPABILITY_ENUM },
        },
      },
    },
  },
  additionalProperties: false,
  examples: [
    {
      name: 'aster.finance.loan',
      version: '1.0.0',
      description: '贷款审批规则包',
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
    },
    {
      capabilities: {
        allow: ['Files'],
      },
    },
  ],
};
