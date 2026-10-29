/**
 * LSP 用户界面文本注册表（overlay 模式）
 *
 * 集中管理 LSP handler 中的用户可见文本。
 *
 * 规则数据来源优先级：
 * 1. 从语言包 JSON overlay 加载（通过 registerOverlayLspUiTexts）
 * 2. 内联 fallback 常量（当 JSON overlay 尚未接入时使用）
 */

import type { Lexicon } from './types.js';
import type { OverlayData } from './overlay-loader.js';
import { loadLspUiTexts } from './overlay-loader.js';

/** LSP 用户界面文本 */
export interface LspUiTexts {
  readonly effectsLabel: string;
  readonly moduleDeclaration: string;
  readonly moduleDeclarationDoc: string;
  readonly typeDefinition: string;
  readonly typeDefinitionDoc: string;
  readonly functionDefinition: string;
  readonly functionDefinitionDoc: string;

  readonly functionLabel: string;
  readonly typeLabel: string;
  readonly enumLabel: string;
  readonly localLabel: string;
  readonly parameterLabel: string;
  readonly patternBindingLabel: string;

  readonly piiWarningHeader: string;
  readonly piiL3Hint: string;
  readonly piiL2Hint: string;
  readonly piiL1Hint: string;
  readonly piiRedactHint: string;

  readonly hintPrefix: string;
  readonly fixPrefix: string;

  readonly missingModuleHeader: string;

  /** 名称解析悬停（ADR 0051）：`写法 → 规范名（角色 · 父名）` 的角色名与括号 */
  readonly resolutionRoleType: string;
  readonly resolutionRoleField: string;
  readonly resolutionRoleMember: string;
  readonly resolutionRoleFunction: string;
  readonly resolutionOpen: string;
  readonly resolutionClose: string;
}

/** 内联 fallback：英文 UI 文本 */
const EN_US_UI: Readonly<LspUiTexts> = {
  effectsLabel: 'Effects:',
  moduleDeclaration: 'Module declaration',
  moduleDeclarationDoc: 'Declares the module name for this file',
  typeDefinition: 'Type definition',
  typeDefinitionDoc: 'Define a new data type or enum',
  functionDefinition: 'Function definition',
  functionDefinitionDoc: 'Define a new function',

  functionLabel: 'Function',
  typeLabel: 'type',
  enumLabel: 'enum',
  localLabel: 'Local',
  parameterLabel: 'Parameter',
  patternBindingLabel: 'Pattern binding',

  piiWarningHeader: 'PII Data',
  piiL3Hint: '🔴 High sensitivity: SSN, passport, biometric\nGDPR: Requires explicit consent (Art. 9)\nHIPAA: PHI - encryption required',
  piiL2Hint: '🟠 Medium sensitivity: email, phone, address\nGDPR: Lawful basis required (Art. 6)\nConsider encryption at rest',
  piiL1Hint: '🟡 Low sensitivity: name, preferences\nGDPR: Document processing purpose',
  piiRedactHint: 'Use `redact()` or `tokenize()` before external transmission',

  hintPrefix: 'Hint:',
  fixPrefix: 'Fix:',

  missingModuleHeader: 'Missing module header. Add "Module <name>."',

  resolutionRoleType: 'type',
  resolutionRoleField: 'field',
  resolutionRoleMember: 'enum member',
  resolutionRoleFunction: 'function',
  resolutionOpen: ' (',
  resolutionClose: ')',
};

/** 内联 fallback：中文 UI 文本 */
const ZH_CN_UI: Readonly<LspUiTexts> = {
  effectsLabel: '效果：',
  moduleDeclaration: '模块声明',
  moduleDeclarationDoc: '声明此文件的模块名称',
  typeDefinition: '类型定义',
  typeDefinitionDoc: '定义数据类型或枚举',
  functionDefinition: '函数定义',
  functionDefinitionDoc: '定义函数',

  functionLabel: '函数',
  typeLabel: '类型',
  enumLabel: '枚举',
  localLabel: '局部变量',
  parameterLabel: '参数',
  patternBindingLabel: '模式绑定',

  piiWarningHeader: 'PII 数据',
  piiL3Hint: '🔴 高敏感: 身份证号、护照、生物识别\nGDPR: 需要明确同意 (Art. 9)\nHIPAA: PHI - 必须加密',
  piiL2Hint: '🟠 中等敏感: 邮箱、电话、地址\nGDPR: 需要合法依据 (Art. 6)\n建议静态加密',
  piiL1Hint: '🟡 低敏感: 姓名、偏好\nGDPR: 需记录处理目的',
  piiRedactHint: '在外部传输前使用 `redact()` 或 `tokenize()`',

  hintPrefix: '提示：',
  fixPrefix: '修复：',

  missingModuleHeader: '缺少模块头。请添加 "模块 <名称>。"',

  resolutionRoleType: '类型',
  resolutionRoleField: '字段',
  resolutionRoleMember: '枚举成员',
  resolutionRoleFunction: '函数',
  resolutionOpen: '（',
  resolutionClose: '）',
};

const UI_BY_LEXICON: Record<string, Readonly<LspUiTexts>> = {
  'en-US': EN_US_UI,
  'zh-CN': ZH_CN_UI,
};

/**
 * 从 JSON overlay 数据注册 LSP UI 文本（覆盖内联 fallback）。
 */
export function registerOverlayLspUiTexts(lexiconId: string, overlay: NonNullable<OverlayData['lspUiTexts']>): void {
  UI_BY_LEXICON[lexiconId] = loadLspUiTexts(overlay);
}

/** 获取指定 lexicon 的 UI 文本，回退到英文 */
export function getLspUiTexts(lexicon?: Lexicon): Readonly<LspUiTexts> {
  if (!lexicon) return EN_US_UI;
  return UI_BY_LEXICON[lexicon.id] ?? EN_US_UI;
}
