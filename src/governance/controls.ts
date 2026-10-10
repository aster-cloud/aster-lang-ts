import { CONTROLS_REGISTRY, type ControlsRegistryData } from './controls-registry.data.js';

/** 档案定义（ADR 0046 §3）：规则须有 @id、控制点须已登记、须至少引用所列框架之一的已登记控制点。 */
export interface ProfileDef {
  readonly id: string;
  readonly ruleId: boolean;
  readonly registeredControls: boolean;
  readonly frameworks: readonly string[];
}

/**
 * 编译期只需「版本 + 是否登记」（ADR 0045 §3），以及键所属框架与档案（ADR 0046 §3）。
 * frameworkOf / profile 可缺省：只含控制点的手写注册表视为无框架归属、无档案（与 Java 两参构造器一致）。
 */
export interface ControlRegistry {
  readonly version: string;
  has(key: string): boolean;
  frameworkOf?(key: string): string | undefined;
  profile?(id: string): ProfileDef | undefined;
}

const KEY_PATTERN = /^[A-Z0-9_]+:[A-Z0-9_().]+$/;
const MAX_KEY_LENGTH = 64;

/** 与审计写入的 64 字符截断上限一致：超长或形态不符的键不可能被登记。 */
export function isWellFormedControlKey(key: string): boolean {
  return key.length <= MAX_KEY_LENGTH && KEY_PATTERN.test(key);
}

/** 缺 profiles 视为无档案，以兼容只含控制点的输入。 */
function profilesOf(data: ControlsRegistryData): Map<string, ProfileDef> {
  const profiles = new Map<string, ProfileDef>();
  for (const p of data.profiles ?? []) {
    profiles.set(p.id, {
      id: p.id,
      ruleId: p.requires.ruleId,
      registeredControls: p.requires.registeredControls,
      frameworks: [...p.requires.frameworks],
    });
  }
  return profiles;
}

export function controlRegistryFrom(data: ControlsRegistryData): ControlRegistry {
  const frameworks = new Map(data.controls.map((c) => [c.key, c.framework] as const));
  const profiles = profilesOf(data);
  return {
    version: data.version,
    has: (key) => isWellFormedControlKey(key) && frameworks.has(key),
    frameworkOf: (key) => frameworks.get(key),
    profile: (id) => profiles.get(id),
  };
}

export const defaultControlRegistry: ControlRegistry = controlRegistryFrom(CONTROLS_REGISTRY);
