/**
 * 推断命名规则表的类型（ADR 0056 §3.2，格式见 aster-lang-locales type-inference/naming-rules.schema.json）。
 */
import type { PrimitiveTypeName } from '../types/type-inference.js';

export type NamingRuleMatch = 'firstWord' | 'lastWord' | 'lastWordMulti' | 'anyWord' | 'textPrefix' | 'textSuffix';

/** 一条规则：*Word* 规则带 words，text* 规则带 strings。 */
export interface NamingRule {
  readonly type: PrimitiveTypeName;
  readonly priority: number;
  readonly match: NamingRuleMatch;
  readonly words?: readonly string[];
  readonly strings?: readonly string[];
}

export interface NamingRulesTable {
  readonly version: number;
  readonly default: PrimitiveTypeName;
  readonly rules: readonly NamingRule[];
}
