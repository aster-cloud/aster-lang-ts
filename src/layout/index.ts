/**
 * @module @aster-cloud/aster-lang-ts/layout
 *
 * LayoutMap（ADR 0058 §7）：同一份 canonical 源码的第二种排版，只给人看。
 * 纯函数、无 Node 依赖，浏览器与 Workers 可用；cloud 保存校验与编辑器共用。
 */
export { LAYOUT_LIMITS, LayoutError } from './types.js';
export type {
  LayoutErrorCode,
  LayoutErrorDetail,
  LayoutLimitName,
  LayoutRange,
  LayoutRule,
  LayoutSpan,
  LayoutValidation,
  PolicyLayout,
} from './types.js';
export { parseLayout, serializeLayout, toCanonical, toDisplay } from './format.js';
export { validatePolicyLayout, verifyContentParity } from './validate.js';
export { canonicalToDisplay, displayToCanonical } from './mapping.js';
export {
  ASCII_OPERATORS,
  checkDerivedLayout,
  checkLayoutLimits,
  checkPackageLayout,
  containsWholeWord,
  irNameStrings,
  layoutRuleOf,
  operatorSequence,
  operatorTable,
  padStructuralSpans,
  parseLayoutStrict,
  sourceMeasures,
  structuralNameHits,
} from './package-rules.js';
export type { CheckPackageLayoutOptions, LayoutRuleContext } from './package-rules.js';
export { reconstructFromDisplay } from './reconstruct.js';
export type { Reconstruction } from './reconstruct.js';
