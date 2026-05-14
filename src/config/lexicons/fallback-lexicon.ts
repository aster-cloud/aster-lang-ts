/**
 * @module config/lexicons/fallback-lexicon
 *
 * Lexicon 装饰器：把 target lexicon（如 zh-CN）与 fallback lexicon（始终 en-US）合并。
 *
 * 语义：
 * - keywords：预合并 Record（en-US 全集 + target 覆盖）。零运行时开销。
 * - punctuation / canonicalization / messages：透传 target（语言强相关，fallback 无意义）
 * - id / name / direction：透传 target（FallbackLexicon 对外仍是 target 身份）
 * - overlay 字段（typeInferenceRules / diagnosticMessages 等）：仅在 target 提供时
 *   通过 Object.defineProperty 挂载，满足 exactOptionalPropertyTypes 严格语义
 *
 * 与 Java 侧 FallbackLexicon 对齐（aster-lang-core/.../FallbackLexicon.java）。
 *
 * en-US 自身不应被 wrap —— registry.get() 通过 id 判断跳过此装饰。
 */

import type { Lexicon } from './types.js';
import { SemanticTokenKind } from '../token-kind.js';

/**
 * 内部品牌符号 —— 用于 isFallbackLexicon() 类型守卫，
 * 在 exactOptionalPropertyTypes 下取代 `instanceof FallbackLexicon`。
 *
 * 跨包/跨 realm 的 instanceof 不可靠，且品牌符号比 class 更轻量。
 */
const FALLBACK_BRAND = Symbol.for('aster-lang/fallback-lexicon');

interface BrandedLexicon extends Lexicon {
  readonly [FALLBACK_BRAND]: true;
  readonly target: Lexicon;
  readonly fallback: Lexicon;
}

/**
 * 创建一个 FallbackLexicon 装饰器对象。
 *
 * 返回的对象满足 Lexicon 接口，并额外暴露 target / fallback 供测试 / 调试。
 */
export function createFallbackLexicon(target: Lexicon, fallback: Lexicon): Lexicon {
  if (!target) throw new Error('FallbackLexicon: target required');
  if (!fallback) throw new Error('FallbackLexicon: fallback required');

  const merged: Record<SemanticTokenKind, string> = { ...fallback.keywords };
  for (const k of Object.keys(target.keywords) as SemanticTokenKind[]) {
    const v = target.keywords[k];
    if (v && v.length > 0) {
      merged[k] = v;
    }
  }

  const base = {
    [FALLBACK_BRAND]: true as const,
    id: target.id,
    name: target.name,
    direction: target.direction,
    keywords: Object.freeze(merged) as Readonly<Record<SemanticTokenKind, string>>,
    punctuation: target.punctuation,
    canonicalization: target.canonicalization,
    messages: target.messages,
    target,
    fallback,
  };

  // overlay 字段：仅在 target 显式提供时附加。条件展开避免 undefined 污染。
  const overlayFields = {
    ...(target.typeInferenceRules !== undefined && {
      typeInferenceRules: target.typeInferenceRules,
    }),
    ...(target.inputGenerationRules !== undefined && {
      inputGenerationRules: target.inputGenerationRules,
    }),
    ...(target.diagnosticMessages !== undefined && {
      diagnosticMessages: target.diagnosticMessages,
    }),
    ...(target.diagnosticHelp !== undefined && {
      diagnosticHelp: target.diagnosticHelp,
    }),
  };

  return Object.freeze({ ...base, ...overlayFields }) as BrandedLexicon;
}

/**
 * 类型守卫：判断一个 Lexicon 是否已被 FallbackLexicon 装饰。
 *
 * 用于 registry.get() 防御性检查，避免重复装饰。
 */
export function isFallbackLexicon(lex: Lexicon): boolean {
  return (lex as Partial<BrandedLexicon>)[FALLBACK_BRAND] === true;
}

/**
 * 历史兼容导出 —— 旧代码可能用 `new FallbackLexicon(target, fallback)`
 * 或 `instanceof FallbackLexicon`。这里用 callable + constructable 的桥接
 * 保持源码兼容，内部转发到 createFallbackLexicon。
 *
 * @deprecated 推荐改用 createFallbackLexicon + isFallbackLexicon。
 */
export const FallbackLexicon = function FallbackLexicon(
  this: unknown,
  target: Lexicon,
  fallback: Lexicon,
): Lexicon {
  return createFallbackLexicon(target, fallback);
} as unknown as {
  new (target: Lexicon, fallback: Lexicon): Lexicon;
  (target: Lexicon, fallback: Lexicon): Lexicon;
};
