// 简体中文 lexicon (v2)
//
// 设计原则（见 ADR-0008）：
//   1. **不使用与中文常用字冲突的 1 字关键字**。例如砍掉 `或`/`且`/`非`/
//      `真`/`假`/`空`/`无`/`是`/`在`/`为`/`和` 等高频字，改为 2+ 字形式。
//      理由：`或然率` `真客户` `是否成年` 等业务标识符若与 1 字关键字
//      冲突，会让分词必须靠空格强制，违背 CNL "可读" 的核心承诺。
//   2. **`加`/`减`/`乘` 保留单字**：算术上下文强、客户标识符极少撞这三个
//      字。规则保守为多字（`加上`/`减去`/`乘以`）也可，做了多字升级。
//   3. **与英文 lexicon 在语义级 1:1 对齐**：每个 SemanticTokenKind 都
//      有且仅有一个中文映射；不要为"自然"而引入同义词链。

import { SemanticTokenKind } from '../token-kind.js';
import type { Lexicon } from './types.js';

export const ZH_CN: Lexicon = {
  id: 'zh-CN',
  name: '简体中文',
  direction: 'ltr',

  keywords: {
    [SemanticTokenKind.MODULE_DECL]: '模块',
    [SemanticTokenKind.IMPORT]: '引用',
    [SemanticTokenKind.IMPORT_ALIAS]: '作为',
    [SemanticTokenKind.IMPORT_VERSION]: '版本',
    [SemanticTokenKind.TYPE_DEF]: '定义',
    [SemanticTokenKind.TYPE_WITH]: '包含',
    [SemanticTokenKind.TYPE_HAS]: '包含',
    [SemanticTokenKind.TYPE_ONE_OF]: '为以下之一',
    [SemanticTokenKind.FUNC_TO]: '规则',
    [SemanticTokenKind.FUNC_GIVEN]: '给定',
    [SemanticTokenKind.FUNC_PRODUCE]: '产出',
    [SemanticTokenKind.FUNC_PERFORMS]: '执行',
    [SemanticTokenKind.IF]: '如果',
    [SemanticTokenKind.OTHERWISE]: '否则',
    [SemanticTokenKind.MATCH]: '匹配于',
    [SemanticTokenKind.WHEN]: '当',
    [SemanticTokenKind.RETURN]: '返回',
    [SemanticTokenKind.RESULT_IS]: '结果为',
    [SemanticTokenKind.FOR_EACH]: '对每个',
    [SemanticTokenKind.IN]: '属于',
    [SemanticTokenKind.LET]: '令',
    [SemanticTokenKind.BE]: '定义为',
    [SemanticTokenKind.SET]: '将',
    [SemanticTokenKind.TO_WORD]: '设为',
    [SemanticTokenKind.OR]: '或者',
    [SemanticTokenKind.AND]: '并且',
    [SemanticTokenKind.NOT]: '不是',
    [SemanticTokenKind.PLUS]: '加上',
    [SemanticTokenKind.MINUS_WORD]: '减去',
    [SemanticTokenKind.TIMES]: '乘以',
    [SemanticTokenKind.DIVIDED_BY]: '除以',
    [SemanticTokenKind.INTEGER_DIVIDED_BY]: '整除',
    [SemanticTokenKind.MODULO]: '取模',
    [SemanticTokenKind.LESS_THAN]: '小于',
    [SemanticTokenKind.GREATER_THAN]: '大于',
    [SemanticTokenKind.EQUALS_TO]: '等于',
    [SemanticTokenKind.IS]: '等于',
    [SemanticTokenKind.UNDER]: '不足',
    [SemanticTokenKind.OVER]: '超过',
    [SemanticTokenKind.MORE_THAN]: '多于',
    [SemanticTokenKind.MAYBE]: '可选',
    [SemanticTokenKind.OPTION_OF]: '选项',
    [SemanticTokenKind.RESULT_OF]: '结果',
    [SemanticTokenKind.OK_OF]: '成功值',
    [SemanticTokenKind.ERR_OF]: '失败值',
    [SemanticTokenKind.SOME_OF]: '有值',
    [SemanticTokenKind.NONE]: '无值',
    [SemanticTokenKind.TEXT]: '文本',
    [SemanticTokenKind.INT_TYPE]: '整数',
    [SemanticTokenKind.FLOAT_TYPE]: '小数',
    [SemanticTokenKind.BOOL_TYPE]: '布尔',
    [SemanticTokenKind.TRUE]: '真值',
    [SemanticTokenKind.FALSE]: '假值',
    [SemanticTokenKind.NULL]: '空值',
    [SemanticTokenKind.IO]: '输入输出',
    [SemanticTokenKind.CPU]: '计算',
    [SemanticTokenKind.WORKFLOW]: '流程',
    [SemanticTokenKind.STEP]: '步骤',
    [SemanticTokenKind.DEPENDS]: '依赖',
    [SemanticTokenKind.ON]: '基于',
    [SemanticTokenKind.COMPENSATE]: '补偿',
    [SemanticTokenKind.RETRY]: '重试',
    [SemanticTokenKind.TIMEOUT]: '超时',
    [SemanticTokenKind.MAX_ATTEMPTS]: '最多尝试',
    [SemanticTokenKind.BACKOFF]: '退避',
    [SemanticTokenKind.WITHIN]: '范围',
    [SemanticTokenKind.SCOPE]: '域',
    [SemanticTokenKind.START]: '启动',
    [SemanticTokenKind.ASYNC]: '异步',
    [SemanticTokenKind.AWAIT]: '等待',
    [SemanticTokenKind.WAIT_FOR]: '等候',
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
  },

  canonicalization: {
    fullWidthToHalf: true,
    whitespaceMode: 'chinese',
    removeArticles: false,
    // v2 关键字调整后的允许重复：
    //   - TYPE_WITH 与 TYPE_HAS 在中文都是「包含」（en-US 一致：with/has 都用一个词不合理但
    //     en-US 也存在该模糊，先对齐英文 lexicon 的行为）
    //   - IS 与 EQUALS_TO 在中文都是「等于」（消除了原本 IS=「是」与标识符 `是否成年` 的冲突）
    //   - UNDER/LESS_THAN、OVER/GREATER_THAN/MORE_THAN 是同义比较词，与 en-US 一致
    allowedDuplicates: [
      [SemanticTokenKind.TYPE_WITH, SemanticTokenKind.TYPE_HAS],
      [SemanticTokenKind.IS, SemanticTokenKind.EQUALS_TO],
      [SemanticTokenKind.UNDER, SemanticTokenKind.LESS_THAN],
      [SemanticTokenKind.OVER, SemanticTokenKind.GREATER_THAN, SemanticTokenKind.MORE_THAN],
    ],
    compoundPatterns: [
      {
        name: 'match-when',
        opener: SemanticTokenKind.MATCH,
        contextualKeywords: [
          SemanticTokenKind.WHEN,
        ],
        closer: 'DEDENT',
      },
      {
        name: 'let-be',
        opener: SemanticTokenKind.LET,
        contextualKeywords: [
          SemanticTokenKind.BE,
        ],
        closer: 'NEWLINE',
      },
    ],
  },

  messages: {
    unexpectedToken: '意外的符号：{token}',
    expectedKeyword: '期望关键词：{keyword}',
    undefinedVariable: '未定义的变量：{name}',
    typeMismatch: '类型不匹配：期望 {expected}，实际 {actual}',
    unterminatedString: '未终止的字符串字面量',
    invalidIndentation: '无效的缩进：必须是 2 个空格的倍数',
  },
};
