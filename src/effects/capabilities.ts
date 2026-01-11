import { CapabilityKind } from '../config/semantic.js';

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

export function parseLegacyCapability(cap: 'io' | 'cpu'): CapabilityKind[] {
  if (cap === 'io') {
    return [
      CapabilityKind.HTTP,
      CapabilityKind.SQL,
      CapabilityKind.TIME,
      CapabilityKind.FILES,
      CapabilityKind.SECRETS,
      CapabilityKind.AI_MODEL,
    ];
  }
  return [CapabilityKind.CPU];
}

export function normalizeManifest(raw: any): CapabilityManifest {
  const normalized: {
    allow: { [K in CapabilityKind]?: readonly string[] };
    deny?: { [K in CapabilityKind]?: readonly string[] };
  } = { allow: {} };
  const allow = normalized.allow;

  if (raw?.allow) {
    for (const key of Object.keys(raw.allow)) {
      if (key === 'io') {
        const patterns = raw.allow.io;
        allow[CapabilityKind.HTTP] = patterns;
        allow[CapabilityKind.SQL] = patterns;
        allow[CapabilityKind.TIME] = patterns;
        allow[CapabilityKind.FILES] = patterns;
        allow[CapabilityKind.SECRETS] = patterns;
        allow[CapabilityKind.AI_MODEL] = patterns;
      } else if (key === 'cpu') {
        allow[CapabilityKind.CPU] = raw.allow.cpu;
      } else if (isCapabilityKind(key)) {
        allow[key] = raw.allow[key];
      }
    }
  }

  if (raw?.deny) {
    normalized.deny = {};
    const deny = normalized.deny;
    for (const key of Object.keys(raw.deny)) {
      if (key === 'io') {
        for (const cap of parseLegacyCapability('io')) {
          deny[cap] = raw.deny.io;
        }
      } else if (key === 'cpu') {
        deny[CapabilityKind.CPU] = raw.deny.cpu;
      } else if (isCapabilityKind(key)) {
        deny[key] = raw.deny[key];
      }
    }
  }

  return normalized as CapabilityManifest;
}

export function isAllowed(
  cap: CapabilityKind | 'io' | 'cpu',
  funcName: string,
  ctx: CapabilityContext,
  man: CapabilityManifest | null
): boolean {
  if (!man) return true; // no manifest -> permissive
  const capsToCheck =
    cap === 'io' || cap === 'cpu' ? parseLegacyCapability(cap) : [cap];
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
