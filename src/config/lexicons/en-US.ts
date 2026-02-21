/**
 * @module config/lexicons/en-US
 *
 * 英语（美式）词法表 - Aster CNL 的英语皮肤。
 *
 * **重要说明**：
 * 英语不是"基准"或"默认"语言，而是与中文、日语等完全平等的词法表皮肤。
 * 编译器核心不包含任何英语关键词，所有关键词都通过此 Lexicon 接口映射。
 */

import { SemanticTokenKind } from '../token-kind.js';
import type { Lexicon } from './types.js';

/**
 * 英语（美式）词法表。
 */
export const EN_US: Lexicon = {
  id: 'en-US',
  name: 'English (US)',
  direction: 'ltr',

  keywords: {
    // 模块声明
    [SemanticTokenKind.MODULE_DECL]: 'Module',
    [SemanticTokenKind.IMPORT]: 'use',
    [SemanticTokenKind.IMPORT_ALIAS]: 'as',

    // 类型定义
    [SemanticTokenKind.TYPE_DEF]: 'define',
    [SemanticTokenKind.TYPE_WITH]: 'with',
    [SemanticTokenKind.TYPE_HAS]: 'has',
    [SemanticTokenKind.TYPE_ONE_OF]: 'as one of',

    // 函数定义
    [SemanticTokenKind.FUNC_TO]: 'Rule',
    [SemanticTokenKind.FUNC_GIVEN]: 'given',
    [SemanticTokenKind.FUNC_PRODUCE]: 'produce',
    [SemanticTokenKind.FUNC_PERFORMS]: 'it performs',

    // 控制流
    [SemanticTokenKind.IF]: 'if',
    [SemanticTokenKind.OTHERWISE]: 'otherwise',
    [SemanticTokenKind.MATCH]: 'match',
    [SemanticTokenKind.WHEN]: 'when',
    [SemanticTokenKind.RETURN]: 'return',
    [SemanticTokenKind.RESULT_IS]: 'the result is',
    [SemanticTokenKind.FOR_EACH]: 'for each',
    [SemanticTokenKind.IN]: 'in',

    // 变量操作
    [SemanticTokenKind.LET]: 'let',
    [SemanticTokenKind.BE]: 'be',
    [SemanticTokenKind.SET]: 'set',
    [SemanticTokenKind.TO_WORD]: 'to',

    // 布尔运算
    [SemanticTokenKind.OR]: 'or',
    [SemanticTokenKind.AND]: 'and',
    [SemanticTokenKind.NOT]: 'not',

    // 算术运算
    [SemanticTokenKind.PLUS]: 'plus',
    [SemanticTokenKind.MINUS_WORD]: 'minus',
    [SemanticTokenKind.TIMES]: 'times',
    [SemanticTokenKind.DIVIDED_BY]: 'divided by',

    // 比较运算
    [SemanticTokenKind.LESS_THAN]: 'less than',
    [SemanticTokenKind.GREATER_THAN]: 'greater than',
    [SemanticTokenKind.EQUALS_TO]: 'equals to',
    [SemanticTokenKind.IS]: 'is',
    [SemanticTokenKind.UNDER]: 'under',
    [SemanticTokenKind.OVER]: 'over',
    [SemanticTokenKind.MORE_THAN]: 'more than',

    // 类型构造
    [SemanticTokenKind.MAYBE]: 'maybe',
    [SemanticTokenKind.OPTION_OF]: 'option of',
    [SemanticTokenKind.RESULT_OF]: 'result of',
    [SemanticTokenKind.OK_OF]: 'ok of',
    [SemanticTokenKind.ERR_OF]: 'err of',
    [SemanticTokenKind.SOME_OF]: 'some of',
    [SemanticTokenKind.NONE]: 'none',

    // 字面量
    [SemanticTokenKind.TRUE]: 'true',
    [SemanticTokenKind.FALSE]: 'false',
    [SemanticTokenKind.NULL]: 'null',

    // 基础类型
    [SemanticTokenKind.TEXT]: 'text',
    [SemanticTokenKind.INT_TYPE]: 'int',
    [SemanticTokenKind.FLOAT_TYPE]: 'float',
    [SemanticTokenKind.BOOL_TYPE]: 'bool',

    // 效果声明
    [SemanticTokenKind.IO]: 'io',
    [SemanticTokenKind.CPU]: 'cpu',

    // 工作流
    [SemanticTokenKind.WORKFLOW]: 'workflow',
    [SemanticTokenKind.STEP]: 'step',
    [SemanticTokenKind.DEPENDS]: 'depends',
    [SemanticTokenKind.ON]: 'on',
    [SemanticTokenKind.COMPENSATE]: 'compensate',
    [SemanticTokenKind.RETRY]: 'retry',
    [SemanticTokenKind.TIMEOUT]: 'timeout',
    [SemanticTokenKind.MAX_ATTEMPTS]: 'max attempts',
    [SemanticTokenKind.BACKOFF]: 'backoff',

    // 异步操作
    [SemanticTokenKind.WITHIN]: 'within',
    [SemanticTokenKind.SCOPE]: 'scope',
    [SemanticTokenKind.START]: 'start',
    [SemanticTokenKind.ASYNC]: 'async',
    [SemanticTokenKind.AWAIT]: 'await',
    [SemanticTokenKind.WAIT_FOR]: 'wait for',

    // 约束声明
    [SemanticTokenKind.REQUIRED]: 'required',
    [SemanticTokenKind.BETWEEN]: 'between',
    [SemanticTokenKind.AT_LEAST]: 'at least',
    [SemanticTokenKind.AT_MOST]: 'at most',
    [SemanticTokenKind.MATCHING]: 'matching',
    [SemanticTokenKind.PATTERN]: 'pattern',
  },

  punctuation: {
    statementEnd: '.',
    listSeparator: ',',
    enumSeparator: ',',
    blockStart: ':',
    stringQuotes: {
      open: '"',
      close: '"',
    },
    // 英语不使用标记符号
  },

  canonicalization: {
    fullWidthToHalf: false, // 英语不需要全角转半角
    whitespaceMode: 'english', // 英语使用空格分隔单词
    removeArticles: true, // 移除 a, an, the
    articles: ['a', 'an', 'the'],
    allowedDuplicates: [
      [SemanticTokenKind.UNDER, SemanticTokenKind.LESS_THAN],
      [SemanticTokenKind.OVER, SemanticTokenKind.GREATER_THAN, SemanticTokenKind.MORE_THAN],
    ],
  },

  messages: {
    unexpectedToken: 'Unexpected token: {token}',
    expectedKeyword: "Expected keyword '{keyword}'",
    undefinedVariable: 'Undefined variable: {name}',
    typeMismatch: 'Type mismatch: expected {expected}, got {actual}',
    unterminatedString: 'Unterminated string literal',
    invalidIndentation: 'Invalid indentation: must be a multiple of 2 spaces',
  },
};
