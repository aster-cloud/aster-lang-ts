/**
 * Pure alias-resolution helpers — **browser-safe leaf module**.
 *
 * Why this module exists (P0-R14 codex round 14 review):
 * `typecheck/utils.ts` was previously the "leaf" home for `resolveAlias`,
 * but it carries `loadPrefixes()` at module-load that calls `require('node:module')`,
 * plus other helpers that `require('node:path')`. Even though Next.js webpack
 * handles `node:` scheme via `nodejs_compat`, taking that as a guarantee is
 * fragile — any consumer with stricter bundler rules (browser-only, strict
 * edge runtime) would break.
 *
 * This module contains **only** pure string/map operations with no runtime
 * dependencies. `typecheck-pii.ts` imports from here so the cross-runtime
 * PII flow analysis path never touches Node-specific globals.
 */

/**
 * 解析导入别名到真实模块前缀.
 *
 * @param name 原始名称（如 "H.get"）
 * @param imports 别名映射（如 {H: "Http"}）
 * @returns 解析后的名称（如 "Http.get"）
 */
export function resolveAlias(name: string, imports: ReadonlyMap<string, string>): string {
  if (!name.includes('.')) return name;
  const [prefix, ...rest] = name.split('.');
  const resolved = imports.get(prefix!);
  return resolved ? `${resolved}.${rest.join('.')}` : name;
}
