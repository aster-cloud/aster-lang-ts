// 类型检查工具模块: 收敛常量、类型辅助与路径规范化逻辑，供多个子模块复用.
//
// R15 (codex round 14/15 review): 纯类型助手已迁移到 `./pure.ts` (browser-safe
// leaf module), 这里 re-export 维持源码层向后兼容. 本文件仍含 Node-only
// 路径 (loadPrefixes / require / process.cwd), 仅供 server-side 模块 import.
// 任何 browser/edge 可达的代码应改 import from './pure.js' 或 './alias.js'.

export {
  UNKNOWN_TYPE,
  UNIT_TYPE,
  IO_EFFECT_TYPE,
  CPU_EFFECT_TYPE,
  PURE_EFFECT_TYPE,
  IO_PREFIXES,
  CPU_PREFIXES,
  isUnknown,
  unknownType,
  buildFieldTypeMap,
  normalizeType,
  formatType,
  isWorkflowType,
  unwrapWorkflowResult,
  typesEqual,
  isAssignable,
  originToSpan,
  shouldEnforcePii,
  checkEntryRuleUniqueness,
} from './pure.js';

import { IO_PREFIXES as DEFAULT_IO_PREFIXES, CPU_PREFIXES as DEFAULT_CPU_PREFIXES } from './pure.js';

// Effect prefixes — Node-only path: try loading from config, fallback to
// pure.ts defaults. Browser path goes through pure.ts IO_PREFIXES/CPU_PREFIXES
// directly (re-exported above), bypassing this loader entirely.
let _ioPrefixes: readonly string[] | null = null;
let _cpuPrefixes: readonly string[] | null = null;
let _prefixesLoaded = false;

function loadPrefixes(): void {
  if (_prefixesLoaded) return;
  _prefixesLoaded = true;
  try {
    const { createRequire } = require('node:module') as { createRequire: (url: string) => NodeRequire };
    const require2 = createRequire(import.meta.url);
    const config = require2('../config/effect_config.js');
    _ioPrefixes = config.getIOPrefixes();
    _cpuPrefixes = config.getCPUPrefixes();
  } catch {
    _ioPrefixes = DEFAULT_IO_PREFIXES;
    _cpuPrefixes = DEFAULT_CPU_PREFIXES;
  }
}

/** Get IO prefixes for effect inference (Node-only path, reads from config). */
export function getIOPrefixesCompat(): readonly string[] {
  loadPrefixes();
  return _ioPrefixes!;
}

/** Get CPU prefixes for effect inference (Node-only path, reads from config). */
export function getCPUPrefixesCompat(): readonly string[] {
  loadPrefixes();
  return _cpuPrefixes!;
}

// resolveAlias 仍由 './alias.js' 提供 (P0-R15: 纯 leaf, 无 Node 依赖).
// utils.ts re-export 保持源码层向后兼容; 新代码应直接 import from './alias.js'.
export { resolveAlias } from './alias.js';

/**
 * Get default module search paths.
 * Uses dynamic import to avoid Node.js dependency at module load time.
 */
export function defaultModuleSearchPaths(): string[] {
  try {
    const path = require('node:path') as typeof import('node:path');
    const cwd = process.cwd();
    return [cwd, path.join(cwd, '.aster', 'packages')];
  } catch {
    // In browser environment, return empty array
    return [];
  }
}

/**
 * Normalize module search paths.
 * Uses dynamic import to avoid Node.js dependency at module load time.
 */
export function normalizeModuleSearchPaths(paths?: readonly string[]): readonly string[] {
  const source = paths && paths.length > 0 ? paths : defaultModuleSearchPaths();
  const normalized = new Set<string>();

  try {
    const path = require('node:path') as typeof import('node:path');
    for (const candidate of source) {
      if (!candidate) continue;
      normalized.add(path.resolve(candidate));
    }
  } catch {
    // In browser environment, use paths as-is
    for (const candidate of source) {
      if (!candidate) continue;
      normalized.add(candidate);
    }
  }

  return [...normalized];
}
