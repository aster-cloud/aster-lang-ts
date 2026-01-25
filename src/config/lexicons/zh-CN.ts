/**
 * @module config/lexicons/zh-CN
 *
 * 简体中文词法表 - Aster CNL 的中文皮肤。
 *
 * **设计策略**：混合策略
 * - 法律文书风格：声明类关键词使用【】标记，如【模块】【定义】
 * - 把字句结构：模式匹配使用"把 X 分为"结构
 * - 直觉自然：控制流关键词使用日常中文，如"若"、"否则"、"返回"
 *
 * **标点符号**：
 * - 使用中文标点：。，、：
 * - 字符串使用直角引号：「」
 * - 标记使用方括号：【】
 */

import { SemanticTokenKind } from '../token-kind.js';
import type { Lexicon } from './types.js';

/**
 * 简体中文词法表。
 */
export const ZH_CN: Lexicon = {
  id: 'zh-CN',
  name: '简体中文',
  direction: 'ltr',

  keywords: {
    // 模块声明（使用【】标记增强辨识度）
    [SemanticTokenKind.MODULE_DECL]: '【模块】',
    [SemanticTokenKind.IMPORT]: '引用',
    [SemanticTokenKind.IMPORT_ALIAS]: '作为',

    // 类型定义（使用【】标记）
    [SemanticTokenKind.TYPE_DEF]: '【定义】',
    [SemanticTokenKind.TYPE_WITH]: '包含',
    [SemanticTokenKind.TYPE_ONE_OF]: '为以下之一',

    // 函数定义
    // FUNC_TO is the function definition start keyword (like English "To...")
    // Chinese uses "【函数】" as a marker for clarity
    [SemanticTokenKind.FUNC_TO]: '【函数】',
    // TYPE_WITH will handle "入参" for parameters
    [SemanticTokenKind.FUNC_PRODUCE]: '产出',
    [SemanticTokenKind.FUNC_PERFORMS]: '执行',

    // 控制流
    [SemanticTokenKind.IF]: '若',
    [SemanticTokenKind.OTHERWISE]: '否则',
    [SemanticTokenKind.MATCH]: '把',
    [SemanticTokenKind.WHEN]: '当',
    [SemanticTokenKind.RETURN]: '返回',
    [SemanticTokenKind.FOR_EACH]: '对每个',
    [SemanticTokenKind.IN]: '在',

    // 变量操作
    [SemanticTokenKind.LET]: '令',
    [SemanticTokenKind.BE]: '为',
    [SemanticTokenKind.SET]: '将',
    [SemanticTokenKind.TO_WORD]: '设为',

    // 布尔运算
    [SemanticTokenKind.OR]: '或',
    [SemanticTokenKind.AND]: '且',
    [SemanticTokenKind.NOT]: '非',

    // 算术运算
    [SemanticTokenKind.PLUS]: '加',
    [SemanticTokenKind.MINUS_WORD]: '减',
    [SemanticTokenKind.TIMES]: '乘',
    [SemanticTokenKind.DIVIDED_BY]: '除以',

    // 比较运算
    [SemanticTokenKind.LESS_THAN]: '小于',
    [SemanticTokenKind.GREATER_THAN]: '大于',
    [SemanticTokenKind.EQUALS_TO]: '等于',
    [SemanticTokenKind.IS]: '是',

    // 类型构造
    [SemanticTokenKind.MAYBE]: '可选',
    [SemanticTokenKind.OPTION_OF]: '选项',
    [SemanticTokenKind.RESULT_OF]: '结果',
    [SemanticTokenKind.OK_OF]: '成功',
    [SemanticTokenKind.ERR_OF]: '失败',
    [SemanticTokenKind.SOME_OF]: '有值',
    [SemanticTokenKind.NONE]: '无',

    // 字面量
    [SemanticTokenKind.TRUE]: '真',
    [SemanticTokenKind.FALSE]: '假',
    [SemanticTokenKind.NULL]: '空',

    // 基础类型
    [SemanticTokenKind.TEXT]: '文本',
    [SemanticTokenKind.INT_TYPE]: '整数',
    [SemanticTokenKind.FLOAT_TYPE]: '小数',
    [SemanticTokenKind.BOOL_TYPE]: '布尔',

    // 效果声明
    [SemanticTokenKind.IO]: '输入输出',
    [SemanticTokenKind.CPU]: '计算',

    // 工作流（使用【】标记）
    [SemanticTokenKind.WORKFLOW]: '【流程】',
    [SemanticTokenKind.STEP]: '【步骤】',
    [SemanticTokenKind.DEPENDS]: '依赖',
    [SemanticTokenKind.ON]: '于',
    [SemanticTokenKind.COMPENSATE]: '补偿',
    [SemanticTokenKind.RETRY]: '重试',
    [SemanticTokenKind.TIMEOUT]: '超时',
    [SemanticTokenKind.MAX_ATTEMPTS]: '最多尝试',
    [SemanticTokenKind.BACKOFF]: '退避',

    // 异步操作
    [SemanticTokenKind.WITHIN]: '范围',
    [SemanticTokenKind.SCOPE]: '域',
    [SemanticTokenKind.START]: '启动',
    [SemanticTokenKind.ASYNC]: '异步',
    [SemanticTokenKind.AWAIT]: '等待',
    [SemanticTokenKind.WAIT_FOR]: '等候',

    // 约束声明
    [SemanticTokenKind.REQUIRED]: '必填',
    [SemanticTokenKind.BETWEEN]: '介于',
    [SemanticTokenKind.AT_LEAST]: '至少',
    [SemanticTokenKind.AT_MOST]: '至多',
    [SemanticTokenKind.MATCHING]: '匹配',
    [SemanticTokenKind.PATTERN]: '模式',
  },

  punctuation: {
    statementEnd: '。',
    listSeparator: '，',
    enumSeparator: '、',
    blockStart: '：',
    stringQuotes: {
      open: '「',
      close: '」',
    },
    markers: {
      open: '【',
      close: '】',
    },
  },

  canonicalization: {
    fullWidthToHalf: true, // 全角数字和运算符转半角
    whitespaceMode: 'chinese', // 中文不使用空格分隔
    removeArticles: false, // 中文没有冠词
    // 引号规范化已在 canonicalizer 中统一处理（支持智能引号和直引号）
    // 不再需要自定义规则
  },

  messages: {
    unexpectedToken: '意外的符号：{token}',
    expectedKeyword: '期望关键词「{keyword}」',
    undefinedVariable: '未定义的变量：{name}',
    typeMismatch: '类型不匹配：期望 {expected}，实际 {actual}',
    unterminatedString: '未终止的字符串',
    invalidIndentation: '无效的缩进：必须是2个空格的倍数',
  },
};
