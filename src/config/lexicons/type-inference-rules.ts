/**
 * 语言特定的类型推断命名规则（overlay 模式）
 *
 * 不修改 @generated 的 lexicon 文件，而是通过 attach 函数
 * 在运行时将规则附加到 Lexicon 对象上。
 *
 * 规则数据来源优先级：
 * 1. 从语言包 JSON overlay 加载（通过 registerOverlayRules）
 * 2. 内联 fallback 常量（当 JSON overlay 尚未接入时使用）
 */

import type { TypeInferenceRule } from '../../types/type-inference.js';
import type { Lexicon } from './types.js';
import type { OverlayData } from './overlay-loader.js';
import { loadTypeInferenceRules } from './overlay-loader.js';

/** 内联 fallback：英文类型推断规则 */
const EN_US_RULES: readonly TypeInferenceRule[] = [
  // ★词边界：前缀必须是**完整的词**，后接驼峰大写、下划线（snake_case）或词尾。
  //   否则 canceledAt / wasteAmount / isbnCode / storage 会因「can」「was」「is」
  //   的裸前缀被误判为 Bool。
  //   `(?:s|es|d|ed)?` 允许常见词形变化，覆盖 snake_case 的 requires_consent /
  //   validated_at 等真实语料写法（corpus hipaa-validation-demo 即用 requires_consent）。
  //   lookahead 内的 [A-Z_] 必须区分大小写，故整条不能加 /i；前缀的大小写变体
  //   显式展开为 [iI][sS] 形式（等价于 Java 侧的内联 (?-i:…)）。
  { pattern: /^(?:[iI][sS]|[hH][aA][sS]|[cC][aA][nN]|[sS][hH][oO][uU][lL][dD]|[wW][aA][sS]|[wW][iI][lL][lL]|[dD][iI][dD]|[dD][oO][eE][sS]|[aA][lL][lL][oO][wW]|[eE][nN][aA][bB][lL][eE]|[dD][iI][sS][aA][bB][lL][eE]|[aA][cC][tT][iI][vV][eE]|[vV][aA][lL][iI][dD]|[rR][eE][qQ][uU][iI][rR][eE])(?:[sS]|[eE][sS]|[dD]|[eE][dD])?(?:[A-Z_]|$)/, type: 'Bool', priority: 11 },
  { pattern: /(?:Flag|Enabled|Disabled|Active|Valid|Approved|Rejected|Completed|Confirmed|Sufficient|Success|Passed|Verified)$/i, type: 'Bool', priority: 8 },
  { pattern: /(?:Date|Time|At|Timestamp|Created|Updated|Modified|Expired|Birthday|Anniversary)$/i, type: 'DateTime', priority: 10 },
  { pattern: /(?:Type|Status|Category|Kind|Mode)$/i, type: 'Text', priority: 8 },
  { pattern: /(?:Make|Model|Brand|Manufacturer)$/i, type: 'Text', priority: 7 },
  { pattern: /(?:Name|Title|Description|Comment|Note|Remark|Address|Email|Phone|Url|Path|Reason|Recommendation|Factors|Purpose)$/i, type: 'Text', priority: 7 },
  { pattern: /(?:Rating|Limit|Premium|Deductible|Multiplier|Deposit|Line|Utilization|Inquiries|Rent|Debt|Cards|Value|Payments)$/i, type: 'Int', priority: 9 },
  { pattern: /(?:Licensed|Employed|Job|Experience)$/i, type: 'Int', priority: 8 },
  { pattern: /(?:Bps|APR|APY)$/i, type: 'Int', priority: 9 },
  { pattern: /(?:Checked)$/i, type: 'Int', priority: 8 },
];

/** 内联 fallback：中文类型推断规则 */
const ZH_CN_RULES: readonly TypeInferenceRule[] = [
  { pattern: /^(?:是否|有无|能否|可否|允许|启用|禁用)/, type: 'Bool', priority: 11 },
  { pattern: /(?:批准|通过|有效|合格|可疑|确认|验证)$/, type: 'Bool', priority: 8 },
  { pattern: /(?:评分|年龄|数量|次数|额度|金额|保费|免赔额|账龄|卡数)$/, type: 'Int', priority: 10 },
  { pattern: /(?:利率|费率|比率|百分比)$/, type: 'Float', priority: 9 },
];

/** 内联 fallback：德语类型推断规则 */
const DE_DE_RULES: readonly TypeInferenceRule[] = [
  { pattern: /(?:genehmigt|berechtigt|verdaechtig|aktiviert|deaktiviert|aktiv|gueltig|erfolgreich|bestanden|bestaetigt|verifiziert|abgelehnt|abgeschlossen|erforderlich)$/i, type: 'Bool', priority: 8 },
];

const RULES_BY_LEXICON: Record<string, readonly TypeInferenceRule[]> = {
  'en-US': EN_US_RULES,
  'zh-CN': ZH_CN_RULES,
  'de-DE': DE_DE_RULES,
};

/**
 * 从 JSON overlay 数据注册类型推断规则（覆盖内联 fallback）。
 */
export function registerOverlayTypeInferenceRules(lexiconId: string, overlay: NonNullable<OverlayData['typeInferenceRules']>): void {
  RULES_BY_LEXICON[lexiconId] = loadTypeInferenceRules(overlay);
}

/** 为 lexicon 附加类型推断规则（不修改原对象） */
export function attachTypeInferenceRules(lexicon: Lexicon): Lexicon {
  if (lexicon.typeInferenceRules) return lexicon;
  const rules = RULES_BY_LEXICON[lexicon.id];
  if (!rules) return lexicon;
  return { ...lexicon, typeInferenceRules: rules };
}
