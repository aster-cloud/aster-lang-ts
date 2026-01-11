/**
 * @module effects
 *
 * 效果系统模块。
 *
 * 包含：
 * - 效果推断 (inferEffects)
 * - 效果签名 (EffectSignature)
 * - 能力系统 (Capability, CapabilityManifest)
 */

export {
  inferEffects,
  type EffectConstraint,
  type EffectInferenceOptions,
} from './effect_inference.js';
export type { EffectSignature } from './effect_signature.js';
export {
  type Capability,
  type CapabilityManifest,
  type CapabilityContext,
  isCapabilityKind,
  parseLegacyCapability,
  normalizeManifest,
  isAllowed,
} from './capabilities.js';
