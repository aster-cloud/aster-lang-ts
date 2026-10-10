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

// 档案 id 形态（与 locales 校验、Java ControlRegistry 及 Profile 声明一致）
const PROFILE_ID = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * 缺 profiles（或为 null）视为无档案，以兼容只含控制点的输入；profiles 存在但不是数组属结构错误，抛出。
 * 注入的数据可能来自运行时 JSON：单条档案按 locales 校验口径判定，不合法即不登记，声明它的模块因此得到 E705；
 * 重复 id 的各条一律不登记，避免静默择一（与 Java ControlRegistry.readProfiles 一致）。
 */
function profilesOf(data: ControlsRegistryData): Map<string, ProfileDef> {
  const profiles = new Map<string, ProfileDef>();
  const raw: unknown = data.profiles ?? [];
  if (!Array.isArray(raw)) throw new Error('控制注册表 profiles 须为数组');
  const frameworkIds = frameworkIdsOf(data.frameworks);
  const seen = new Set<unknown>();
  const duplicated = new Set<unknown>();
  for (const p of raw as unknown[]) {
    const id = (p as { id?: unknown } | null)?.id;
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
    const profile = readProfile(p, frameworkIds);
    if (profile !== undefined) profiles.set(profile.id, profile);
  }
  for (const id of duplicated) profiles.delete(id as string);
  return profiles;
}

// 空白 = 只由 ASCII 空白（空格 \t \n \v \f \r）组成，含空串
const BLANK = /^[ \t\n\v\f\r]*$/;

/**
 * 根 frameworks 中已登记的框架 id。只认数组；只认 id 为字符串且非空白的对象条目，原样取用；
 * 其余条目（null、非对象、缺 id、id 非字符串、空白 id）一律跳过，不转成字符串。
 */
function frameworkIdsOf(frameworks: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(frameworks)) return ids;
  for (const f of frameworks as unknown[]) {
    const id = f !== null && typeof f === 'object' ? (f as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && !BLANK.test(id)) ids.add(id);
  }
  return ids;
}

/** id 合乎形态、两个开关为布尔、frameworks 为只含已登记框架 id 的数组，否则为 undefined。 */
function readProfile(p: unknown, frameworkIds: ReadonlySet<string>): ProfileDef | undefined {
  const { id, requires } = (p ?? {}) as { id?: unknown; requires?: unknown };
  const { ruleId, registeredControls, frameworks } = (requires ?? {}) as Record<string, unknown>;
  const shapeOk = typeof id === 'string' && PROFILE_ID.test(id)
    && typeof ruleId === 'boolean' && typeof registeredControls === 'boolean' && Array.isArray(frameworks);
  if (!shapeOk) return undefined;
  const known = (frameworks as unknown[]).every((f) => typeof f === 'string' && frameworkIds.has(f));
  if (!known) return undefined;
  return { id, ruleId, registeredControls, frameworks: [...(frameworks as string[])] };
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
