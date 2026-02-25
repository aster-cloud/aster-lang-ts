/**
 * @module config/semantic
 *
 * 集中管理 Aster 语言的所有语义配置。
 *
 * **功能**：
 * - 效果（Effect）类型定义和验证
 * - 能力（Capability）前缀映射和推断
 * - 关键字（Keyword）定义和检查
 * - 内置语义标记（如 'await'）
 *
 * **设计原则**：
 * - 单一真源：所有语义配置集中在此文件
 * - 类型安全：提供验证函数，拒绝未知值
 * - 易于扩展：新增 effect/capability 只需修改此文件
 */

// ============================================================
// Effect 配置
// ============================================================

/**
 * 效果类型枚举。
 *
 * Aster 支持三种效果：
 * - **PURE**: 纯函数，无副作用
 * - **CPU**: CPU密集型计算，无IO
 * - **IO**: 执行IO操作（网络、文件、数据库等）
 */
export enum Effect {
  IO = 'IO',
  CPU = 'CPU',
  PURE = 'PURE',
}

/**
 * effect 字符串（CNL语法）→枚举的映射表。
 *
 * CNL 中使用小写（'io', 'cpu', 'pure'），
 * 内部枚举使用大写（IO, CPU, PURE）。
 */
const EFFECT_MAP: Record<string, Effect> = {
  io: Effect.IO,
  cpu: Effect.CPU,
  pure: Effect.PURE,
};

/**
 * 验证 effect 字符串是否合法。
 *
 * @param effect - CNL 中的 effect 字符串（小写）
 * @returns 如果是合法的 effect，返回 true
 *
 * @example
 * ```typescript
 * isValidEffect('io')   // true
 * isValidEffect('cpuu') // false
 * ```
 */
export function isValidEffect(effect: string): effect is keyof typeof EFFECT_MAP {
  return effect in EFFECT_MAP;
}

/**
 * 转换 effect 字符串为枚举。
 *
 * @param effect - CNL 中的 effect 字符串（小写）
 * @returns 对应的 Effect 枚举，如果非法则返回 null
 *
 * @example
 * ```typescript
 * parseEffect('io')   // Effect.IO
 * parseEffect('cpuu') // null
 * ```
 */
export function parseEffect(effect: string): Effect | null {
  return EFFECT_MAP[effect] ?? null;
}

/**
 * 获取所有合法的 effect 字符串（用于错误提示）。
 *
 * @returns 合法的 effect 字符串数组
 *
 * @example
 * ```typescript
 * getAllEffects() // ['io', 'cpu', 'pure']
 * ```
 */
export function getAllEffects(): string[] {
  return Object.keys(EFFECT_MAP);
}

/**
 * 已知的 IO 操作前缀（用于 effect 推断）。
 *
 * 当函数调用以这些前缀开头时，推断为 `@io` effect。
 * 例如：`Http.get()`, `Db.query()`
 */
export const IO_PREFIXES: readonly string[] = [
  'IO.',
  'AuthRepo.',
  'ProfileSvc.',
  'FeedSvc.',
  'UUID.randomUUID',
  'Http.',
  'Db.',
];

/**
 * 已知的 CPU 密集型操作前缀（用于 effect 推断）。
 *
 * 当函数调用以这些前缀开头时，推断为 `@cpu` effect。
 */
export const CPU_PREFIXES: readonly string[] = [
  // 可以在此添加 CPU 密集型调用前缀
];

// ============================================================
// Capability 配置
// ============================================================

/**
 * Capability 类型枚举。
 *
 * Capability 定义了函数可以访问的资源和权限。
 */
export enum CapabilityKind {
  HTTP = 'Http',
  SQL = 'Sql',
  TIME = 'Time',
  FILES = 'Files',
  SECRETS = 'Secrets',
  AI_MODEL = 'AiModel',
  CPU = 'Cpu',
  PAYMENT = 'Payment',
  INVENTORY = 'Inventory',
}

/**
 * Capability 到调用前缀的映射表。
 *
 * 用于在 ASTER_CAP_EFFECTS_ENFORCE=1 模式下检查 capability 子集规则。
 * 例如：声明了 [Http] capability 的函数只能调用以 'Http.' 开头的函数。
 */
export const CAPABILITY_PREFIXES: Record<string, readonly string[]> = {
  Http: ['Http.'],
  Sql: ['Db.', 'Sql.'],
  Time: ['Time.', 'Clock.'],
  Files: ['Files.', 'Fs.'],
  Secrets: ['Secrets.'],
  AiModel: ['Ai.'],
  Payment: ['Payment.'],
  Inventory: ['Inventory.'],
};

/**
 * 根据函数名前缀推断 capability。
 *
 * @param name - 函数名或调用目标
 * @returns 推断的 CapabilityKind，如果无法推断则返回 null
 *
 * @example
 * ```typescript
 * inferCapabilityFromName('Http.get')  // CapabilityKind.HTTP
 * inferCapabilityFromName('Db.query')  // CapabilityKind.SQL
 * inferCapabilityFromName('myFunc')    // null
 * ```
 */
export function inferCapabilityFromName(name: string): CapabilityKind | null {
  for (const [cap, prefixes] of Object.entries(CAPABILITY_PREFIXES)) {
    if (prefixes.some(prefix => name.startsWith(prefix))) {
      return cap as CapabilityKind;
    }
  }
  return null;
}

/**
 * 获取所有 capability 前缀（用于调试）。
 *
 * @returns 所有 capability 前缀的扁平数组
 */
export function getAllCapabilityPrefixes(): string[] {
  return Object.values(CAPABILITY_PREFIXES).flat();
}

// ============================================================
// Keyword 配置
// ============================================================

import type { Lexicon } from './lexicons/types.js';

/**
 * Aster CNL 关键字定义（v1 lexicon, en-US）。
 *
 * 多词关键字使用空格连接的规范形式（canonical form）。
 * 例如：'as one of', 'wait for'
 */
export const KW = {
  MODULE_IS: 'module',
  USE: 'use',
  AS: 'as',
  DEFINE: 'define',
  WITH: 'with',
  HAS: 'has',
  ONE_OF: 'as one of',
  RULE: 'rule',
  GIVEN: 'given',
  PRODUCE: 'produce',
  PERFORMS: 'it performs',
  IO: 'io',
  CPU: 'cpu',
  LET: 'let',
  BE: 'be',
  SET: 'set',
  TO_WORD: 'to',
  IF: 'if',
  OTHERWISE: 'otherwise',
  MATCH: 'match',
  WHEN: 'when',
  WORKFLOW: 'workflow',
  STEP: 'step',
  DEPENDS: 'depends',
  ON: 'on',
  COMPENSATE: 'compensate',
  RETRY: 'retry',
  TIMEOUT: 'timeout',
  MAX_ATTEMPTS: 'max attempts',
  BACKOFF: 'backoff',
  RETURN: 'return',
  WITHIN: 'within',
  SCOPE: 'scope',
  START: 'start',
  ASYNC: 'async',
  AWAIT: 'await',
  WAIT_FOR: 'wait for',
  IN: 'in',
  MAYBE: 'maybe',
  OPTION_OF: 'option of',
  RESULT_OF: 'result of',
  OR: 'or',
  AND: 'and',
  NULL: 'null',
  TEXT: 'text',
  INT: 'int',
  FLOAT: 'float',
  BOOL_TYPE: 'bool',
  OK_OF: 'ok of',
  ERR_OF: 'err of',
  SOME_OF: 'some of',
  NONE: 'none',
  NOT: 'not',
  PLUS: 'plus',
  MINUS: 'minus',
  TIMES: 'times',
  DIVIDED_BY: 'divided by',
  LESS_THAN: 'less than',
  GREATER_THAN: 'greater than',
  EQUALS_TO: 'equals to',
  // 约束关键词
  REQUIRED: 'required',
  BETWEEN: 'between',
  AT_LEAST: 'at least',
  AT_MOST: 'at most',
  MATCHING: 'matching',
  PATTERN: 'pattern',
} as const;

/**
 * 验证字符串是否为关键字。
 *
 * @param word - 要检查的字符串（应为小写）
 * @param lexicon - 可选的词法表，默认使用 EN_US 关键字
 * @returns 如果是关键字，返回 true
 *
 * @example
 * ```typescript
 * isKeyword('return')     // true
 * isKeyword('myVariable') // false
 * isKeyword('若', ZH_CN)  // true
 * ```
 */
export function isKeyword(word: string, lexicon?: Lexicon): boolean {
  if (lexicon) {
    const lower = word.toLowerCase();
    return Object.values(lexicon.keywords).some(kw => kw.toLowerCase() === lower);
  }
  return (Object.values(KW) as string[]).includes(word.toLowerCase());
}

// ============================================================
// 特殊语义标记
// ============================================================

/**
 * 内置异步函数名。
 *
 * Core IR 中使用 `Call(Name('await'))` 表示异步操作。
 */
export const BUILTIN_AWAIT = 'await';

/**
 * 验证是否为内置异步函数。
 *
 * @param name - 函数名
 * @returns 如果是内置 await，返回 true
 */
export function isBuiltinAwait(name: string): boolean {
  return name === BUILTIN_AWAIT;
}
