/**
 * @module config/lexicons/template
 *
 * Lexicon 模板文件 - 用于创建新的语言词法表。
 *
 * **使用步骤**：
 * 1. 复制此文件到新文件，如 `ja-JP.ts`（日语）或 `de-DE.ts`（德语）
 * 2. 修改导出名称和 id/name 字段
 * 3. 为所有 SemanticTokenKind 提供翻译
 * 4. 配置标点符号和规范化规则
 * 5. 翻译错误消息
 * 6. 在 index.ts 中注册新词法表
 * 7. 添加单元测试
 *
 * **命名规范**：
 * - 文件名：使用 BCP 47 语言标签，如 `ja-JP.ts`、`de-DE.ts`
 * - 导出名：使用大写下划线格式，如 `JA_JP`、`DE_DE`
 *
 * **参考资源**：
 * - 英语实现：`./en-US.ts`
 * - 中文实现：`./zh-CN.ts`
 * - 类型定义：`./types.ts`
 * - Token 枚举：`../token-kind.ts`
 * - 贡献指南：`docs/guide/add-new-language.md`
 */

import { SemanticTokenKind } from '../token-kind.js';
import type { Lexicon } from './types.js';

/**
 * 语言名称词法表模板。
 *
 * TODO: 修改此注释为目标语言的描述，包括：
 * - 语言名称和代码
 * - 设计策略（正式/口语化/混合）
 * - 标点符号选择理由
 * - 特殊处理说明
 *
 * @example
 * ```aster
 * // 在此添加该语言的示例代码
 * ```
 */
export const TEMPLATE: Lexicon = {
  // ============================================================
  // 基本信息
  // ============================================================

  /**
   * 词法表 ID - 使用 BCP 47 语言标签
   * @see https://www.ietf.org/rfc/bcp/bcp47.txt
   *
   * 常见示例：
   * - 'en-US' - 美式英语
   * - 'zh-CN' - 简体中文
   * - 'zh-TW' - 繁体中文
   * - 'ja-JP' - 日语
   * - 'ko-KR' - 韩语
   * - 'de-DE' - 德语
   * - 'fr-FR' - 法语
   * - 'es-ES' - 西班牙语
   * - 'ar-SA' - 阿拉伯语
   */
  id: 'xx-XX', // TODO: 修改为目标语言标签

  /**
   * 人类可读的语言名称（使用目标语言书写）
   */
  name: 'Language Name', // TODO: 修改为目标语言名称，如 '日本語'、'Deutsch'

  /**
   * 文字方向
   * - 'ltr': 从左到右（英语、中文、日语等）
   * - 'rtl': 从右到左（阿拉伯语、希伯来语等）
   */
  direction: 'ltr', // TODO: 如果是 RTL 语言，改为 'rtl'

  // ============================================================
  // 关键词映射
  // ============================================================

  keywords: {
    // ----------------------------------------------------------
    // 模块声明
    // ----------------------------------------------------------

    /** 模块声明 - 英语 "this module is" / 中文 "【模块】" */
    [SemanticTokenKind.MODULE_DECL]: '', // TODO: 翻译

    /** 导入声明 - 英语 "use" / 中文 "引用" */
    [SemanticTokenKind.IMPORT]: '', // TODO: 翻译

    /** 导入别名 - 英语 "as" / 中文 "作为" */
    [SemanticTokenKind.IMPORT_ALIAS]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 类型定义
    // ----------------------------------------------------------

    /** 类型定义 - 英语 "define" / 中文 "【定义】" */
    [SemanticTokenKind.TYPE_DEF]: '', // TODO: 翻译

    /** 类型字段 - 英语 "with" / 中文 "包含" */
    [SemanticTokenKind.TYPE_WITH]: '', // TODO: 翻译

    /** 枚举类型 - 英语 "as one of" / 中文 "为以下之一" */
    [SemanticTokenKind.TYPE_ONE_OF]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 函数定义
    // ----------------------------------------------------------

    /** 函数入参 - 英语 "to" / 中文 "入参" */
    [SemanticTokenKind.FUNC_TO]: '', // TODO: 翻译

    /** 函数产出 - 英语 "produce" / 中文 "产出" */
    [SemanticTokenKind.FUNC_PRODUCE]: '', // TODO: 翻译

    /** 函数效果声明 - 英语 "it performs" / 中文 "执行" */
    [SemanticTokenKind.FUNC_PERFORMS]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 控制流
    // ----------------------------------------------------------

    /** 条件判断 - 英语 "if" / 中文 "若" */
    [SemanticTokenKind.IF]: '', // TODO: 翻译

    /** 否则分支 - 英语 "otherwise" / 中文 "否则" */
    [SemanticTokenKind.OTHERWISE]: '', // TODO: 翻译

    /** 模式匹配 - 英语 "match" / 中文 "把" */
    [SemanticTokenKind.MATCH]: '', // TODO: 翻译

    /** 匹配分支 - 英语 "when" / 中文 "当" */
    [SemanticTokenKind.WHEN]: '', // TODO: 翻译

    /** 返回语句 - 英语 "return" / 中文 "返回" */
    [SemanticTokenKind.RETURN]: '', // TODO: 翻译

    /** 循环遍历 - 英语 "for each" / 中文 "对每个" */
    [SemanticTokenKind.FOR_EACH]: '', // TODO: 翻译

    /** 集合成员 - 英语 "in" / 中文 "在" */
    [SemanticTokenKind.IN]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 变量操作
    // ----------------------------------------------------------

    /** 变量声明 - 英语 "let" / 中文 "令" */
    [SemanticTokenKind.LET]: '', // TODO: 翻译

    /** 变量初始化 - 英语 "be" / 中文 "为" */
    [SemanticTokenKind.BE]: '', // TODO: 翻译

    /** 变量赋值 - 英语 "set" / 中文 "将" */
    [SemanticTokenKind.SET]: '', // TODO: 翻译

    /** 赋值目标 - 英语 "to" (set ... to) / 中文 "设为" */
    [SemanticTokenKind.TO_WORD]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 布尔运算
    // ----------------------------------------------------------

    /** 逻辑或 - 英语 "or" / 中文 "或" */
    [SemanticTokenKind.OR]: '', // TODO: 翻译

    /** 逻辑与 - 英语 "and" / 中文 "且" */
    [SemanticTokenKind.AND]: '', // TODO: 翻译

    /** 逻辑非 - 英语 "not" / 中文 "非" */
    [SemanticTokenKind.NOT]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 算术运算
    // ----------------------------------------------------------

    /** 加法 - 英语 "plus" / 中文 "加" */
    [SemanticTokenKind.PLUS]: '', // TODO: 翻译

    /** 减法 - 英语 "minus" / 中文 "减" */
    [SemanticTokenKind.MINUS_WORD]: '', // TODO: 翻译

    /** 乘法 - 英语 "times" / 中文 "乘" */
    [SemanticTokenKind.TIMES]: '', // TODO: 翻译

    /** 除法 - 英语 "divided by" / 中文 "除以" */
    [SemanticTokenKind.DIVIDED_BY]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 比较运算
    // ----------------------------------------------------------

    /** 小于 - 英语 "less than" / 中文 "小于" */
    [SemanticTokenKind.LESS_THAN]: '', // TODO: 翻译

    /** 大于 - 英语 "greater than" / 中文 "大于" */
    [SemanticTokenKind.GREATER_THAN]: '', // TODO: 翻译

    /** 等于 - 英语 "equals to" / 中文 "等于" */
    [SemanticTokenKind.EQUALS_TO]: '', // TODO: 翻译

    /** 判断 - 英语 "is" / 中文 "是" */
    [SemanticTokenKind.IS]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 类型构造
    // ----------------------------------------------------------

    /** 可选类型 - 英语 "maybe" / 中文 "可选" */
    [SemanticTokenKind.MAYBE]: '', // TODO: 翻译

    /** Option 类型 - 英语 "option of" / 中文 "选项" */
    [SemanticTokenKind.OPTION_OF]: '', // TODO: 翻译

    /** Result 类型 - 英语 "result of" / 中文 "结果" */
    [SemanticTokenKind.RESULT_OF]: '', // TODO: 翻译

    /** 成功值 - 英语 "ok of" / 中文 "成功" */
    [SemanticTokenKind.OK_OF]: '', // TODO: 翻译

    /** 错误值 - 英语 "err of" / 中文 "失败" */
    [SemanticTokenKind.ERR_OF]: '', // TODO: 翻译

    /** 有值 - 英语 "some of" / 中文 "有值" */
    [SemanticTokenKind.SOME_OF]: '', // TODO: 翻译

    /** 空值 - 英语 "none" / 中文 "无" */
    [SemanticTokenKind.NONE]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 字面量
    // ----------------------------------------------------------

    /** 布尔真 - 英语 "true" / 中文 "真" */
    [SemanticTokenKind.TRUE]: '', // TODO: 翻译

    /** 布尔假 - 英语 "false" / 中文 "假" */
    [SemanticTokenKind.FALSE]: '', // TODO: 翻译

    /** 空值 - 英语 "null" / 中文 "空" */
    [SemanticTokenKind.NULL]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 基础类型
    // ----------------------------------------------------------

    /** 文本类型 - 英语 "text" / 中文 "文本" */
    [SemanticTokenKind.TEXT]: '', // TODO: 翻译

    /** 整数类型 - 英语 "int" / 中文 "整数" */
    [SemanticTokenKind.INT_TYPE]: '', // TODO: 翻译

    /** 浮点类型 - 英语 "float" / 中文 "小数" */
    [SemanticTokenKind.FLOAT_TYPE]: '', // TODO: 翻译

    /** 布尔类型 - 英语 "bool" / 中文 "布尔" */
    [SemanticTokenKind.BOOL_TYPE]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 效果声明
    // ----------------------------------------------------------

    /** IO 效果 - 英语 "io" / 中文 "输入输出" */
    [SemanticTokenKind.IO]: '', // TODO: 翻译

    /** CPU 效果 - 英语 "cpu" / 中文 "计算" */
    [SemanticTokenKind.CPU]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 工作流
    // ----------------------------------------------------------

    /** 工作流定义 - 英语 "workflow" / 中文 "【流程】" */
    [SemanticTokenKind.WORKFLOW]: '', // TODO: 翻译

    /** 步骤定义 - 英语 "step" / 中文 "【步骤】" */
    [SemanticTokenKind.STEP]: '', // TODO: 翻译

    /** 依赖声明 - 英语 "depends" / 中文 "依赖" */
    [SemanticTokenKind.DEPENDS]: '', // TODO: 翻译

    /** 依赖目标 - 英语 "on" / 中文 "于" */
    [SemanticTokenKind.ON]: '', // TODO: 翻译

    /** 补偿操作 - 英语 "compensate" / 中文 "补偿" */
    [SemanticTokenKind.COMPENSATE]: '', // TODO: 翻译

    /** 重试策略 - 英语 "retry" / 中文 "重试" */
    [SemanticTokenKind.RETRY]: '', // TODO: 翻译

    /** 超时设置 - 英语 "timeout" / 中文 "超时" */
    [SemanticTokenKind.TIMEOUT]: '', // TODO: 翻译

    /** 最大尝试次数 - 英语 "max attempts" / 中文 "最多尝试" */
    [SemanticTokenKind.MAX_ATTEMPTS]: '', // TODO: 翻译

    /** 退避策略 - 英语 "backoff" / 中文 "退避" */
    [SemanticTokenKind.BACKOFF]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 异步操作
    // ----------------------------------------------------------

    /** 作用域 - 英语 "within" / 中文 "范围" */
    [SemanticTokenKind.WITHIN]: '', // TODO: 翻译

    /** 作用域块 - 英语 "scope" / 中文 "域" */
    [SemanticTokenKind.SCOPE]: '', // TODO: 翻译

    /** 启动异步 - 英语 "start" / 中文 "启动" */
    [SemanticTokenKind.START]: '', // TODO: 翻译

    /** 异步标记 - 英语 "async" / 中文 "异步" */
    [SemanticTokenKind.ASYNC]: '', // TODO: 翻译

    /** 等待结果 - 英语 "await" / 中文 "等待" */
    [SemanticTokenKind.AWAIT]: '', // TODO: 翻译

    /** 等待完成 - 英语 "wait for" / 中文 "等候" */
    [SemanticTokenKind.WAIT_FOR]: '', // TODO: 翻译

    // ----------------------------------------------------------
    // 约束声明
    // ----------------------------------------------------------

    /** 必填约束 - 英语 "required" / 中文 "必填" */
    [SemanticTokenKind.REQUIRED]: '', // TODO: 翻译

    /** 范围约束 - 英语 "between" / 中文 "在" */
    [SemanticTokenKind.BETWEEN]: '', // TODO: 翻译

    /** 最小值约束 - 英语 "at least" / 中文 "至少" */
    [SemanticTokenKind.AT_LEAST]: '', // TODO: 翻译

    /** 最大值约束 - 英语 "at most" / 中文 "至多" */
    [SemanticTokenKind.AT_MOST]: '', // TODO: 翻译

    /** 匹配约束 - 英语 "matching" / 中文 "匹配" */
    [SemanticTokenKind.MATCHING]: '', // TODO: 翻译

    /** 模式关键字 - 英语 "pattern" / 中文 "模式" */
    [SemanticTokenKind.PATTERN]: '', // TODO: 翻译
  },

  // ============================================================
  // 标点符号配置
  // ============================================================

  punctuation: {
    /**
     * 语句结束符
     * - 英语: '.'
     * - 中文: '。'
     * - 日语: '。'
     */
    statementEnd: '.', // TODO: 根据目标语言修改

    /**
     * 列表分隔符（用于参数列表、数组元素等）
     * - 英语: ','
     * - 中文: '，'
     * - 日语: '、'
     */
    listSeparator: ',', // TODO: 根据目标语言修改

    /**
     * 枚举分隔符（用于枚举值列表）
     * - 英语: ','
     * - 中文: '、'
     * - 日语: '、'
     */
    enumSeparator: ',', // TODO: 根据目标语言修改

    /**
     * 块引导符（引导代码块）
     * - 英语: ':'
     * - 中文: '：'
     * - 日语: '：'
     */
    blockStart: ':', // TODO: 根据目标语言修改

    /**
     * 字符串引号
     * - 英语: '"' / '"'
     * - 中文: '「' / '」'
     * - 日语: '「' / '」'
     */
    stringQuotes: {
      open: '"', // TODO: 根据目标语言修改
      close: '"', // TODO: 根据目标语言修改
    },

    /**
     * 标记符号（可选，用于 【模块】【定义】 等醒目标记）
     * - 英语: 不使用
     * - 中文: '【' / '】'
     * - 日语: '【' / '】' 或 '「' / '」'
     *
     * 如果不需要标记符号，可以删除此字段或注释掉
     */
    // markers: {
    //   open: '【',
    //   close: '】',
    // },
  },

  // ============================================================
  // 规范化配置
  // ============================================================

  canonicalization: {
    /**
     * 是否将全角字符转换为半角（数字和运算符）
     * - 英语: false（不需要）
     * - 中文: true（需要，因为输入法可能输入全角数字）
     * - 日语: true（同上）
     */
    fullWidthToHalf: false, // TODO: 根据目标语言修改

    /**
     * 空格处理模式
     * - 'english': 英语等使用空格分隔单词的语言
     * - 'chinese': 中文、日语等不使用空格分隔的语言
     * - 'mixed': 混合模式
     */
    whitespaceMode: 'english', // TODO: 根据目标语言修改

    /**
     * 是否移除冠词
     * - 英语: true（移除 a, an, the）
     * - 中文: false（没有冠词）
     * - 日语: false（没有冠词）
     * - 德语: true（移除 der, die, das, ein, eine）
     */
    removeArticles: false, // TODO: 根据目标语言修改

    /**
     * 冠词列表（如果 removeArticles 为 true）
     * - 英语: ['a', 'an', 'the']
     * - 德语: ['der', 'die', 'das', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines']
     * - 法语: ['le', 'la', 'les', 'un', 'une', 'des']
     *
     * 如果不需要移除冠词，可以删除此字段或注释掉
     */
    // articles: ['a', 'an', 'the'],

    /**
     * 允许重复的关键词组（可选）
     *
     * 如果某个词在不同语法上下文中使用（如英语的 "to" 同时用于函数定义和赋值），
     * 需要在此声明允许重复，否则验证会警告。
     *
     * @example
     * ```typescript
     * // 英语中 "to" 同时用于 FUNC_TO 和 TO_WORD
     * allowedDuplicates: [
     *   [SemanticTokenKind.FUNC_TO, SemanticTokenKind.TO_WORD],
     * ],
     * ```
     */
    // allowedDuplicates: [],

    /**
     * 自定义规范化规则（可选）
     *
     * 用于处理特定语言的特殊字符转换或规范化需求。
     *
     * @example
     * ```typescript
     * customRules: [
     *   {
     *     name: 'normalize-arrows',
     *     pattern: '→',
     *     replacement: '->',
     *   },
     * ],
     * ```
     */
    // customRules: [],
  },

  // ============================================================
  // 错误消息
  // ============================================================

  messages: {
    /**
     * 意外的符号
     * 占位符: {token} - 遇到的符号
     */
    unexpectedToken: 'Unexpected token: {token}', // TODO: 翻译

    /**
     * 期望的关键词
     * 占位符: {keyword} - 期望的关键词
     */
    expectedKeyword: "Expected keyword '{keyword}'", // TODO: 翻译

    /**
     * 未定义的变量
     * 占位符: {name} - 变量名
     */
    undefinedVariable: 'Undefined variable: {name}', // TODO: 翻译

    /**
     * 类型不匹配
     * 占位符: {expected} - 期望的类型, {actual} - 实际的类型
     */
    typeMismatch: 'Type mismatch: expected {expected}, got {actual}', // TODO: 翻译

    /**
     * 未终止的字符串
     */
    unterminatedString: 'Unterminated string literal', // TODO: 翻译

    /**
     * 无效的缩进
     */
    invalidIndentation: 'Invalid indentation: must be a multiple of 2 spaces', // TODO: 翻译
  },
};

// ============================================================
// 注册说明（完成翻译后，按以下步骤注册）
// ============================================================

/**
 * 完成翻译后，需要在 `src/config/lexicons/index.ts` 中注册：
 *
 * 1. 导入新词法表：
 *    ```typescript
 *    import { XX_XX } from './xx-XX.js';
 *    ```
 *
 * 2. 在 initializeDefaultLexicons() 中注册：
 *    ```typescript
 *    export function initializeDefaultLexicons(): void {
 *      if (!initialized) {
 *        LexiconRegistry.register(EN_US);
 *        LexiconRegistry.register(ZH_CN);
 *        LexiconRegistry.register(XX_XX);  // 添加这行
 *        initialized = true;
 *      }
 *    }
 *    ```
 *
 * 3. 导出新词法表：
 *    ```typescript
 *    export { XX_XX };
 *    ```
 */
