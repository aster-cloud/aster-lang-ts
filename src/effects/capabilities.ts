import { CAPABILITY_EFFECT_CLASS, CapabilityKind, type CapabilityEffectClass } from '../config/semantic.js';

export type Capability = CapabilityKind;

export interface CapabilityManifest {
  readonly allow: { readonly [K in CapabilityKind]?: readonly string[] };
  readonly deny?: { readonly [K in CapabilityKind]?: readonly string[] };
}

export interface CapabilityContext {
  readonly moduleName: string; // e.g., demo.login
}

export function isCapabilityKind(value: unknown): value is CapabilityKind {
  return (
    typeof value === 'string' &&
    Object.values(CapabilityKind).includes(value as CapabilityKind)
  );
}

/**
 * 效果类别（manifest 的 `io` / `cpu` 键、裸 `io` / `cpu`）展开成的能力：按单一真相源 shared/capabilities.json 的
 * `class` 字段（CAPABILITY_EFFECT_CLASS）取，与 core CapabilityKind.effectClass 一致（ADR 0056 §4.1、aster-lang-ts#320）。
 * 此前 io 用硬编码的 6 项（漏了 Network / Process / Payment / Inventory），cpu 只有 Cpu（漏了 Crypto）。
 */
export function capabilitiesOfEffectClass(effectClass: CapabilityEffectClass): CapabilityKind[] {
  return (Object.keys(CAPABILITY_EFFECT_CLASS) as CapabilityKind[]).filter((cap) => CAPABILITY_EFFECT_CLASS[cap] === effectClass);
}

function isEffectClassKey(key: string): key is CapabilityEffectClass {
  return key === 'io' || key === 'cpu';
}

/** manifest 键 → 能力：`io` / `cpu` 按类别展开，能力名原样，其余键忽略。 */
function capabilitiesOfManifestKey(key: string): CapabilityKind[] {
  if (isEffectClassKey(key)) return capabilitiesOfEffectClass(key);
  return isCapabilityKind(key) ? [key] : [];
}

/**
 * 规范化 manifest：`io` / `cpu` 类别键先按类别展开，再由同一表里的具体能力键覆盖（具体键比类别键更具体，
 * 结果不依赖键在 JSON 里的顺序）。
 */
export function normalizeManifest(raw: any): CapabilityManifest {
  const section = (table: Record<string, readonly string[]> | undefined): { [K in CapabilityKind]?: readonly string[] } => {
    const out: { [K in CapabilityKind]?: readonly string[] } = {};
    if (!table) return out;
    const keys = Object.keys(table);
    for (const key of [...keys.filter(isEffectClassKey), ...keys.filter((k) => !isEffectClassKey(k))]) {
      for (const cap of capabilitiesOfManifestKey(key)) out[cap] = table[key]!;
    }
    return out;
  };
  return raw?.deny
    ? { allow: section(raw?.allow), deny: section(raw.deny) }
    : { allow: section(raw?.allow) };
}

export function isAllowed(
  cap: CapabilityKind | 'io' | 'cpu',
  funcName: string,
  ctx: CapabilityContext,
  man: CapabilityManifest | null
): boolean {
  if (!man) return true; // no manifest -> permissive
  const capsToCheck =
    cap === 'io' || cap === 'cpu' ? capabilitiesOfEffectClass(cap) : [cap];
  const fqn = `${ctx.moduleName}.${funcName}`;

  for (const c of capsToCheck) {
    const deny = man.deny?.[c] ?? [];
    for (const pat of deny) if (matches(pat, ctx.moduleName, fqn)) return false;
  }

  let allowed = false;
  for (const c of capsToCheck) {
    const patterns = man.allow[c];
    if (!patterns || patterns.length === 0) continue;
    for (const pat of patterns) {
      if (matches(pat, ctx.moduleName, fqn)) {
        allowed = true;
        break;
      }
    }
    if (allowed) break;
  }
  return allowed;
}

function matches(pat: string, moduleName: string, fqn: string): boolean {
  if (pat === '*') return true;
  // Simple suffix wildcard: 'module.func*' → startsWith on fqn
  if (pat.endsWith('*')) {
    const base = pat.slice(0, -1);
    return fqn.startsWith(base) || moduleName.startsWith(base);
  }
  if (pat.endsWith('.*')) {
    const pref = pat.slice(0, -2);
    return fqn.startsWith(pref + '.') || moduleName === pref;
  }
  return fqn === pat || moduleName === pat;
}
