/**
 * @module config/token-kind
 *
 * 语义化 TokenKind 枚举 - Aster 多语言词法架构的单一真源。
 *
 * **设计原则**：
 * - 语言无关：所有枚举值代表抽象语义概念，不含任何自然语言
 * - 单一真源：所有 Lexicon 实现必须映射到此枚举
 * - 类型安全：使用 TypeScript enum 提供编译时检查
 *
 * **使用方式**：
 * - Lexicon 定义：`keywords: { [SemanticTokenKind.IF]: '若' }`
 * - Lexer 输出：`{ kind: TokenKind.KEYWORD, semanticKind: SemanticTokenKind.IF }`
 * - Parser 匹配：`expectKeyword(SemanticTokenKind.IF)`
 */

/**
 * 语义化 Token 类型枚举。
 *
 * 定义 Aster CNL 中所有具有语义意义的关键词类型。
 * 每个枚举值对应一个抽象语义概念，由各语言的 Lexicon 映射到具体关键词。
 */
export enum SemanticTokenKind {
  // ============================================================
  // 模块声明
  // ============================================================

  /** 模块声明 - "Module" / "模块" */
  MODULE_DECL = 'MODULE_DECL',

  /** 导入声明 - "use" / "引用" */
  IMPORT = 'IMPORT',

  /** 导入别名 - "as" / "作为" */
  IMPORT_ALIAS = 'IMPORT_ALIAS',

  // ============================================================
  // 类型定义
  // ============================================================

  /** 类型定义 - "define" / "定义" */
  TYPE_DEF = 'TYPE_DEF',

  /** 类型字段 - "with" / "包含" */
  TYPE_WITH = 'TYPE_WITH',

  /** 类型字段 - "has" / "包含" */
  TYPE_HAS = 'TYPE_HAS',

  /** 枚举类型 - "as one of" / "为以下之一" */
  TYPE_ONE_OF = 'TYPE_ONE_OF',

  // ============================================================
  // 函数定义
  // ============================================================

  /** 函数声明（新语法） - "Rule" / "规则" */
  FUNC_TO = 'FUNC_TO',

  /** 函数参数（新语法） - "given" / "给定" */
  FUNC_GIVEN = 'FUNC_GIVEN',

  /** 函数产出 - "produce" / "产出" */
  FUNC_PRODUCE = 'FUNC_PRODUCE',

  /** 函数效果声明 - "it performs" / "执行" */
  FUNC_PERFORMS = 'FUNC_PERFORMS',

  // ============================================================
  // 控制流
  // ============================================================

  /** 条件判断 - "if" / "若" */
  IF = 'IF',

  /** 否则分支 - "otherwise" / "否则" */
  OTHERWISE = 'OTHERWISE',

  /** 模式匹配 - "match" / "把" */
  MATCH = 'MATCH',

  /** 匹配分支 - "when" / "当" */
  WHEN = 'WHEN',

  /** 返回语句 - "return" / "返回" */
  RETURN = 'RETURN',

  /** 结果表达式 - "the result is" / "结果为" */
  RESULT_IS = 'RESULT_IS',

  /** 循环遍历 - "for each" / "对每个" */
  FOR_EACH = 'FOR_EACH',

  /** 集合成员 - "in" / "在" */
  IN = 'IN',

  // ============================================================
  // 变量操作
  // ============================================================

  /** 变量声明 - "let" / "令" */
  LET = 'LET',

  /** 变量初始化 - "be" / "为" */
  BE = 'BE',

  /** 变量赋值 - "set" / "将" */
  SET = 'SET',

  /** 赋值目标 - "to" (set ... to) / "设为" */
  TO_WORD = 'TO_WORD',

  // ============================================================
  // 布尔运算
  // ============================================================

  /** 逻辑或 - "or" / "或" */
  OR = 'OR',

  /** 逻辑与 - "and" / "且" */
  AND = 'AND',

  /** 逻辑非 - "not" / "非" */
  NOT = 'NOT',

  // ============================================================
  // 算术运算
  // ============================================================

  /** 加法 - "plus" / "加" */
  PLUS = 'PLUS',

  /** 减法 - "minus" / "减" */
  MINUS_WORD = 'MINUS_WORD',

  /** 乘法 - "times" / "乘" */
  TIMES = 'TIMES',

  /** 除法 - "divided by" / "除以" */
  DIVIDED_BY = 'DIVIDED_BY',

  // ============================================================
  // 比较运算
  // ============================================================

  /** 小于 - "less than" / "小于" */
  LESS_THAN = 'LESS_THAN',

  /** 大于 - "greater than" / "大于" */
  GREATER_THAN = 'GREATER_THAN',

  /** 等于 - "equals to" / "等于" */
  EQUALS_TO = 'EQUALS_TO',

  /** 判断 - "is" / "是" */
  IS = 'IS',

  /** 低于（比较同义词） - "under" / "不足" */
  UNDER = 'UNDER',

  /** 超过（比较同义词） - "over" / "超过" */
  OVER = 'OVER',

  /** 多于（比较同义词） - "more than" / "多于" */
  MORE_THAN = 'MORE_THAN',

  // ============================================================
  // 类型构造
  // ============================================================

  /** 可选类型 - "maybe" / "可选" */
  MAYBE = 'MAYBE',

  /** Option 类型 - "option of" */
  OPTION_OF = 'OPTION_OF',

  /** Result 类型 - "result of" */
  RESULT_OF = 'RESULT_OF',

  /** 成功值 - "ok of" / "成功" */
  OK_OF = 'OK_OF',

  /** 错误值 - "err of" / "失败" */
  ERR_OF = 'ERR_OF',

  /** 有值 - "some of" / "有值" */
  SOME_OF = 'SOME_OF',

  /** 空值 - "none" / "无" */
  NONE = 'NONE',

  // ============================================================
  // 字面量
  // ============================================================

  /** 布尔真 - "true" / "真" */
  TRUE = 'TRUE',

  /** 布尔假 - "false" / "假" */
  FALSE = 'FALSE',

  /** 空值 - "null" / "空" */
  NULL = 'NULL',

  // ============================================================
  // 基础类型
  // ============================================================

  /** 文本类型 - "text" / "文本" */
  TEXT = 'TEXT',

  /** 整数类型 - "int" / "整数" */
  INT_TYPE = 'INT_TYPE',

  /** 浮点类型 - "float" / "小数" */
  FLOAT_TYPE = 'FLOAT_TYPE',

  /** 布尔类型 - "bool" / "布尔" */
  BOOL_TYPE = 'BOOL_TYPE',

  // ============================================================
  // 效果声明
  // ============================================================

  /** IO 效果 - "io" / "输入输出" */
  IO = 'IO',

  /** CPU 效果 - "cpu" / "计算" */
  CPU = 'CPU',

  // ============================================================
  // 工作流
  // ============================================================

  /** 工作流定义 - "workflow" / "流程" */
  WORKFLOW = 'WORKFLOW',

  /** 步骤定义 - "step" / "步骤" */
  STEP = 'STEP',

  /** 依赖声明 - "depends" / "依赖" */
  DEPENDS = 'DEPENDS',

  /** 依赖目标 - "on" / "于" */
  ON = 'ON',

  /** 补偿操作 - "compensate" / "补偿" */
  COMPENSATE = 'COMPENSATE',

  /** 重试策略 - "retry" / "重试" */
  RETRY = 'RETRY',

  /** 超时设置 - "timeout" / "超时" */
  TIMEOUT = 'TIMEOUT',

  /** 最大尝试次数 - "max attempts" / "最多尝试" */
  MAX_ATTEMPTS = 'MAX_ATTEMPTS',

  /** 退避策略 - "backoff" / "退避" */
  BACKOFF = 'BACKOFF',

  // ============================================================
  // 异步操作
  // ============================================================

  /** 作用域 - "within" / "范围" */
  WITHIN = 'WITHIN',

  /** 作用域块 - "scope" / "域" */
  SCOPE = 'SCOPE',

  /** 启动异步 - "start" / "启动" */
  START = 'START',

  /** 异步标记 - "async" / "异步" */
  ASYNC = 'ASYNC',

  /** 等待结果 - "await" / "等待" */
  AWAIT = 'AWAIT',

  /** 等待完成 - "wait for" / "等候" */
  WAIT_FOR = 'WAIT_FOR',

  // ============================================================
  // 约束声明
  // ============================================================

  /** 必填约束 - "required" / "必填" */
  REQUIRED = 'REQUIRED',

  /** 范围约束 - "between" / "在...之间" */
  BETWEEN = 'BETWEEN',

  /** 最小值约束 - "at least" / "至少" */
  AT_LEAST = 'AT_LEAST',

  /** 最大值约束 - "at most" / "至多" */
  AT_MOST = 'AT_MOST',

  /** 匹配约束 - "matching" / "匹配" */
  MATCHING = 'MATCHING',

  /** 模式关键字 - "pattern" / "模式" */
  PATTERN = 'PATTERN',
}

/**
 * 获取所有语义 Token 类型。
 *
 * @returns 所有 SemanticTokenKind 值的数组
 */
export function getAllSemanticTokenKinds(): SemanticTokenKind[] {
  return Object.values(SemanticTokenKind);
}

/**
 * 检查字符串是否为有效的 SemanticTokenKind。
 *
 * @param value - 要检查的字符串
 * @returns 如果是有效的 SemanticTokenKind，返回 true
 */
export function isSemanticTokenKind(value: string): value is SemanticTokenKind {
  return Object.values(SemanticTokenKind).includes(value as SemanticTokenKind);
}

/**
 * SemanticTokenKind 到分类的映射，用于文档和验证。
 */
export const SEMANTIC_TOKEN_CATEGORIES: Record<string, SemanticTokenKind[]> = {
  module: [SemanticTokenKind.MODULE_DECL, SemanticTokenKind.IMPORT, SemanticTokenKind.IMPORT_ALIAS],
  type: [SemanticTokenKind.TYPE_DEF, SemanticTokenKind.TYPE_WITH, SemanticTokenKind.TYPE_HAS, SemanticTokenKind.TYPE_ONE_OF],
  function: [SemanticTokenKind.FUNC_TO, SemanticTokenKind.FUNC_GIVEN, SemanticTokenKind.FUNC_PRODUCE, SemanticTokenKind.FUNC_PERFORMS],
  control: [
    SemanticTokenKind.IF,
    SemanticTokenKind.OTHERWISE,
    SemanticTokenKind.MATCH,
    SemanticTokenKind.WHEN,
    SemanticTokenKind.RETURN,
    SemanticTokenKind.RESULT_IS,
    SemanticTokenKind.FOR_EACH,
    SemanticTokenKind.IN,
  ],
  variable: [SemanticTokenKind.LET, SemanticTokenKind.BE, SemanticTokenKind.SET, SemanticTokenKind.TO_WORD],
  boolean: [SemanticTokenKind.OR, SemanticTokenKind.AND, SemanticTokenKind.NOT],
  arithmetic: [
    SemanticTokenKind.PLUS,
    SemanticTokenKind.MINUS_WORD,
    SemanticTokenKind.TIMES,
    SemanticTokenKind.DIVIDED_BY,
  ],
  comparison: [
    SemanticTokenKind.LESS_THAN,
    SemanticTokenKind.GREATER_THAN,
    SemanticTokenKind.EQUALS_TO,
    SemanticTokenKind.IS,
    SemanticTokenKind.UNDER,
    SemanticTokenKind.OVER,
    SemanticTokenKind.MORE_THAN,
  ],
  typeConstruct: [
    SemanticTokenKind.MAYBE,
    SemanticTokenKind.OPTION_OF,
    SemanticTokenKind.RESULT_OF,
    SemanticTokenKind.OK_OF,
    SemanticTokenKind.ERR_OF,
    SemanticTokenKind.SOME_OF,
    SemanticTokenKind.NONE,
  ],
  literal: [SemanticTokenKind.TRUE, SemanticTokenKind.FALSE, SemanticTokenKind.NULL],
  primitiveType: [
    SemanticTokenKind.TEXT,
    SemanticTokenKind.INT_TYPE,
    SemanticTokenKind.FLOAT_TYPE,
    SemanticTokenKind.BOOL_TYPE,
  ],
  effect: [SemanticTokenKind.IO, SemanticTokenKind.CPU],
  workflow: [
    SemanticTokenKind.WORKFLOW,
    SemanticTokenKind.STEP,
    SemanticTokenKind.DEPENDS,
    SemanticTokenKind.ON,
    SemanticTokenKind.COMPENSATE,
    SemanticTokenKind.RETRY,
    SemanticTokenKind.TIMEOUT,
    SemanticTokenKind.MAX_ATTEMPTS,
    SemanticTokenKind.BACKOFF,
  ],
  async: [
    SemanticTokenKind.WITHIN,
    SemanticTokenKind.SCOPE,
    SemanticTokenKind.START,
    SemanticTokenKind.ASYNC,
    SemanticTokenKind.AWAIT,
    SemanticTokenKind.WAIT_FOR,
  ],
  constraint: [
    SemanticTokenKind.REQUIRED,
    SemanticTokenKind.BETWEEN,
    SemanticTokenKind.AT_LEAST,
    SemanticTokenKind.AT_MOST,
    SemanticTokenKind.MATCHING,
    SemanticTokenKind.PATTERN,
  ],
};
