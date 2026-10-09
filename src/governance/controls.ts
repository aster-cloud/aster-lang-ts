import { CONTROLS_REGISTRY, type ControlsRegistryData } from './controls-registry.data.js';

/** 编译期只需「版本 + 是否登记」（ADR 0045 §3）。 */
export interface ControlRegistry {
  readonly version: string;
  has(key: string): boolean;
}

const KEY_PATTERN = /^[A-Z0-9_]+:[A-Z0-9_().]+$/;
const MAX_KEY_LENGTH = 64;

/** 与审计写入的 64 字符截断上限一致：超长或形态不符的键不可能被登记。 */
export function isWellFormedControlKey(key: string): boolean {
  return key.length <= MAX_KEY_LENGTH && KEY_PATTERN.test(key);
}

export function controlRegistryFrom(data: ControlsRegistryData): ControlRegistry {
  const keys = new Set(data.controls.map((c) => c.key));
  return { version: data.version, has: (key) => isWellFormedControlKey(key) && keys.has(key) };
}

export const defaultControlRegistry: ControlRegistry = controlRegistryFrom(CONTROLS_REGISTRY);
