/**
 * LSP 服务端设置：默认值与客户端推送的合并（纯函数，便于测试）。
 *
 * ★客户端未声明 workspace.configuration 时，服务端只从 didChangeConfiguration
 *   推送的 settings 取值。旧实现整体替换（`pushed || defaults`）：客户端只推
 *   `{ locale }` 就会把其余默认值全部丢掉（如 format.reflow 从 true 变成 undefined）。
 *   这里按顶层字段合并，嵌套对象逐项覆盖。
 */

export interface AsterSettings {
  maxNumberOfProblems: number;
  format?: { mode?: 'lossless' | 'normalize'; reflow?: boolean };
  index?: { persist?: boolean; path?: string };
  rename?: { scope?: 'open' | 'workspace' };
  diagnostics?: { workspace?: boolean };
  streaming?: { referencesChunk?: number; renameChunk?: number; logChunks?: boolean };
  locale?: string; // 'en-US' | 'zh-CN' | 'de-DE'
}

const DEFAULTS: AsterSettings = {
  maxNumberOfProblems: 1000,
  format: { mode: 'lossless', reflow: true },
  index: { persist: true },
  rename: { scope: 'workspace' },
  diagnostics: { workspace: true },
  streaming: { referencesChunk: 200, renameChunk: 200, logChunks: false },
};
export const DEFAULT_SETTINGS: Readonly<AsterSettings> = Object.freeze(DEFAULTS);

const NESTED_KEYS = ['format', 'index', 'rename', 'diagnostics', 'streaming'] as const;

/** 把客户端推送的（可能不完整的）设置合并到默认值上 */
export function resolvePushedSettings(pushed: unknown): AsterSettings {
  const p = (pushed && typeof pushed === 'object' ? pushed : {}) as Partial<AsterSettings>;
  const merged: AsterSettings = { ...DEFAULT_SETTINGS, ...p };
  for (const key of NESTED_KEYS) {
    const base = DEFAULT_SETTINGS[key] as Record<string, unknown> | undefined;
    const over = p[key] as Record<string, unknown> | undefined;
    if (base || over) (merged as unknown as Record<string, unknown>)[key] = { ...base, ...over };
  }
  return merged;
}
