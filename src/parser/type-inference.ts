/**
 * 未标注形参 / 字段的类型推断（ADR 0056 §3.2）。
 *
 * 规则表是 aster-lang-locales type-inference/naming-rules.json 的内置副本（naming-rules.generated.ts，
 * 由 shared/type-inference-naming-rules.json 生成并由 sibling parity 测试守护），与词法表无关：全部规则对所有
 * 模块生效。算法与 aster-lang-core TypeInference 逐步相同，两侧用 locales 的共用测试向量对照：
 * 1. 分词：名字只含 ASCII 字母、数字与 `_` 时按 `_` 切段，每段按 WORD 切词并做 ASCII 小写；否则词列表为空；
 * 2. 逐条判定规则是否命中（首词 / 末词 / 任一词 / 整名前缀后缀）；
 * 3. 命中规则中 priority 最大者胜，同优先级取表中靠前者，都不命中取缺省类型；
 * 4. 按约束修正（与约束书写顺序无关）。
 *
 * @example
 * ```typescript
 * inferFieldType('applicantId')   // → Text（末词 id，且词数 ≥ 2）
 * inferFieldType('loanAmount')    // → Float
 * inferFieldType('termMonths')    // → Int
 * inferFieldType('isApproved')    // → Bool
 * inferFieldType('score', [{ kind: 'Range', min: 0, max: 100, ... }])  // → Int
 * ```
 */

import { Node } from '../ast/ast.js';
import type { Constraint, ConstraintRange, Type } from '../types.js';
import type { PrimitiveTypeName } from '../types/type-inference.js';
import { canonicalDecimalFromLiteral } from '../core/canonical-decimal.js';
import type { NamingRule } from './naming-rules.js';
import { NAMING_RULES } from './naming-rules.generated.js';

export type { PrimitiveTypeName };

/** 分词式：不带任何标志、只用 ASCII 字符类与先行断言，在 Java 与 JS 中语义相同。 */
const WORD = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;
const ASCII_IDENT = /^[A-Za-z0-9_]*$/;

/** ASCII 小写：只改 A–Z，中文、变音符等字符不变。 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** 第 1 步：分词。名字含 ASCII 字母、数字、`_` 以外的字符时返回空列表。 */
export function tokenize(name: string): string[] {
  if (!ASCII_IDENT.test(name)) return [];
  const words: string[] = [];
  for (const segment of name.split('_')) {
    for (const m of segment.matchAll(WORD)) words.push(asciiLower(m[0]));
  }
  return words;
}

/** 第 2 步：单条规则是否命中。词列表为空时 *Word* 规则一律不命中。 */
function ruleMatches(rule: NamingRule, words: readonly string[], name: string): boolean {
  const items = rule.words ?? rule.strings ?? [];
  switch (rule.match) {
    case 'firstWord':
      return words.length > 0 && items.includes(words[0]!);
    case 'lastWord':
      return words.length > 0 && items.includes(words[words.length - 1]!);
    case 'lastWordMulti':
      return words.length >= 2 && items.includes(words[words.length - 1]!);
    case 'anyWord':
      return words.some((w) => items.includes(w));
    case 'textPrefix':
      return items.some((s) => asciiLower(name).startsWith(s));
    case 'textSuffix':
      return items.some((s) => asciiLower(name).endsWith(s));
  }
}

/** 第 1–3 步：只按名字推断类型名。 */
export function inferTypeNameFromName(name: string): PrimitiveTypeName {
  const words = tokenize(name);
  let best: NamingRule | null = null;
  for (const rule of NAMING_RULES.rules) {
    if (ruleMatches(rule, words, name) && (best === null || rule.priority > best.priority)) best = rule;
  }
  return best === null ? NAMING_RULES.default : best.type;
}

/**
 * 第 5 步的约束类型：存在 Range 时，任一端点的规范十进制串（ADR 0055 §5）含 `.` 得 Float，否则 Int；
 * 不存在 Range 而存在 Pattern 时得 Text；其余为 null。
 */
export function constraintType(constraints: readonly Constraint[]): PrimitiveTypeName | null {
  const ranges = constraints.filter((c): c is ConstraintRange => c.kind === 'Range');
  if (ranges.length > 0) return ranges.some(hasFractionalBound) ? 'Float' : 'Int';
  return constraints.some((c) => c.kind === 'Pattern') ? 'Text' : null;
}

/** 端点按字面量原文求规范十进制串（与 lowering 写进 IR 的值相同），原文 `1.0` 不算小数。 */
function hasFractionalBound(range: ConstraintRange): boolean {
  const literal = (raw: string | undefined, value: number | undefined): string | undefined =>
    raw ?? (value === undefined ? undefined : String(value));
  return [literal(range.minRaw, range.min), literal(range.maxRaw, range.max)].some(
    (b) => b !== undefined && canonicalDecimalFromLiteral(b).includes('.'),
  );
}

/** 第 5 步：名字推断结果 n 与约束类型 c 合并。 */
export function refine(n: PrimitiveTypeName, c: PrimitiveTypeName | null): PrimitiveTypeName {
  if (c === null || c === n) return n;
  if (n === 'Text' && (c === 'Int' || c === 'Float')) return c;
  if (n === 'Int' && c === 'Float') return 'Float';
  return n;
}

/**
 * 推断未标注形参 / 字段的类型：按名字推断，再按约束修正。
 *
 * @param fieldName 字段 / 形参名
 * @param constraints 源码写下的约束
 * @returns 推断的类型 AST 节点（span 由调用方锚定在名字 token，ADR 0056 §3.3）
 */
export function inferFieldType(fieldName: string, constraints: readonly Constraint[] = []): Type {
  return Node.TypeName(refine(inferTypeNameFromName(fieldName), constraintType(constraints)));
}
