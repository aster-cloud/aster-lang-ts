/**
 * @module parser/keyword-display
 *
 * 在**构造**语法诊断时，把关键词槽位显示成作者所用 locale 的拼写。
 *
 * 为什么在构造处而不是事后替换：parseWithLexicon 先把 zh/de 关键词翻译成英文 token
 * 再解析，报错文案若写死英文关键词，作者看到的就是从未写过的 'return'。
 * 但事后对整条消息做文本替换会误伤用户的值——用户类型名 Profile 与规范关键词
 * profile 同形，会被错改成「档案」。因此只在调用方**明确知道是关键词**的位置
 * 调用本模块；插值进来的用户名字、token 文本一律原样输出。
 */

import type { Lexicon } from '../config/lexicons/types.js';
import type { SemanticTokenKind } from '../config/token-kind.js';
import { EN_US } from '../config/lexicons/en-US.js';

/** 只依赖上下文里的 lexicon，便于各子解析器直接传 ctx。 */
interface HasLexicon {
  readonly lexicon?: Lexicon | undefined;
}

const tableCache = new WeakMap<Lexicon, ReadonlyMap<string, string>>();

/** 小写规范拼写 → locale 主拼写；en-US 返回空表。 */
function backTranslation(lexicon: Lexicon): ReadonlyMap<string, string> {
  const cached = tableCache.get(lexicon);
  if (cached) return cached;
  const map = new Map<string, string>();
  if (lexicon.id !== EN_US.id) {
    const local = lexicon.keywords as Readonly<Record<string, string | undefined>>;
    for (const [kind, canonical] of Object.entries(EN_US.keywords)) {
      const spelled = local[kind];
      if (!canonical || !spelled) continue;
      const key = canonical.toLowerCase();
      if (!map.has(key)) map.set(key, spelled);
    }
  }
  tableCache.set(lexicon, map);
  return map;
}

/**
 * 关键词槽位的显示文本。
 *
 * @param canonical 规范拼写（KW 常量）
 * @param enText    英文下的原有写法（如句首大写的 'Rule'），默认等于 canonical，
 *                  保证 en-US 报错文案逐字不变
 */
export function kw(ctx: HasLexicon, canonical: string, enText: string = canonical): string {
  const lexicon = ctx.lexicon;
  if (!lexicon) return enText;
  const local = backTranslation(lexicon).get(canonical.toLowerCase());
  return local ?? enText;
}

/** 带单引号的关键词槽位显示文本。 */
export function kwq(ctx: HasLexicon, canonical: string, enText: string = canonical): string {
  return `'${kw(ctx, canonical, enText)}'`;
}

/**
 * 按语义种类取关键词槽位的显示文本。
 *
 * 用于 KW 常量拼写与 EN_US 规范拼写不一致的槽位：KW.ELSE 是 'else'，
 * 而 EN_US 里同一语义（OTHERWISE）拼作 'Otherwise'，按拼写查表会落空、退回英文。
 */
export function kwKind(ctx: HasLexicon, kind: SemanticTokenKind, enText: string): string {
  const lexicon = ctx.lexicon;
  if (!lexicon || lexicon.id === EN_US.id) return enText;
  const spelled = (lexicon.keywords as Readonly<Record<string, string | undefined>>)[kind];
  return spelled && spelled.length > 0 ? spelled : enText;
}

/** 带单引号的 {@link kwKind}。 */
export function kwKindq(ctx: HasLexicon, kind: SemanticTokenKind, enText: string): string {
  return `'${kwKind(ctx, kind, enText)}'`;
}

/** 当前上下文是否会把关键词显示成非英文拼写（en-US / 无 lexicon 时为 false）。 */
export function isLocalizing(ctx: HasLexicon): boolean {
  return Boolean(ctx.lexicon && ctx.lexicon.id !== EN_US.id);
}
